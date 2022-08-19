import { isProduction } from "metabase/env";
import Question from "metabase-lib/lib/Question";
import StructuredQuery from "metabase-lib/lib/queries/StructuredQuery";
import Dimension from "metabase-lib/lib/Dimension";
import Field from "metabase-lib/lib/metadata/Field";
import { Aggregation, ConcreteField } from "metabase-types/types/Query";
import { Metric } from "metabase-types/api/newmetric";

function findDateField(question: Question) {
  const query = question.query() as StructuredQuery;

  // note: `query.dimension()` excludes join dimensions, which I think we want to include
  const dimensionOptions = query.dimensionOptions();
  const dateDimension = dimensionOptions.find(dimension => {
    const field = dimension.field();
    return field.isDate();
  });

  return dateDimension?.field();
}

function hasDateField(question: Question): boolean {
  if (!question.isStructured()) {
    return false;
  }

  const dateField = findDateField(question);

  return !!dateField;
}

export function canBeUsedAsMetric(
  question: Question | null | undefined,
): question is Question {
  return (
    !!question &&
    question.isStructured() &&
    (question.query() as StructuredQuery).aggregations().length === 1 &&
    hasDateField(question)
  );
}

export function generateFakeMetricFromQuestion(
  question: Question,
): Partial<Metric> | null {
  // guaranteeing the below type assertions are valid
  if (!canBeUsedAsMetric(question)) {
    return null;
  }

  const query = question.query() as StructuredQuery;
  const aggregation = query.aggregations()[0].raw() as Aggregation;
  const dateField = findDateField(question) as Field;
  const columnName = dateField.name;
  const ref = dateField.reference();
  if (ref[0] === "aggregation") {
    return null;
  }

  return {
    name: `${question.id()}_metric`,
    display_name: `${question.displayName()} Metric`,
    description: "",
    archived: false,
    card_id: question.id(),
    measure: aggregation,
    dimensions: [[columnName, ref]],
    granularities: [],
    default_granularity: "month",
    collection_id: null,
  };
}

export function applyMetricToQuestion(
  question: Question,
  metric: Metric,
): Question | null {
  const query = question.query() as StructuredQuery;
  const { dimensions } = metric;
  const [, dateFieldRef] = dimensions[0];
  // convert the fieldRef to a dimension so that we can set a temporal-unit
  // in the fieldRef's option arg
  const dateDimension = Dimension.parseMBQL(
    dateFieldRef,
    query.metadata(),
    query,
  );

  if (!dateDimension) {
    return null;
  }

  const dateDimensionWithTemporalUnit = dateDimension.withTemporalUnit(
    isProduction ? "day" : "month",
  );
  const newFieldRef = dateDimensionWithTemporalUnit.mbql() as ConcreteField;
  let metricQuery = query.addBreakout(newFieldRef);

  if (isProduction) {
    metricQuery = metricQuery.addFilter([
      "time-interval",
      dateFieldRef,
      -30,
      "day",
    ]);
  }

  return metricQuery.question();
}