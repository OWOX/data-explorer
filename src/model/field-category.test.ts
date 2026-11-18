import { categorizeFieldType, isDayType, normalizeType } from './field-category';

test.each([
  ['STRING', 'string'], ['varchar', 'string'], ['INT64', 'number'], ['NUMERIC', 'number'],
  ['FLOAT64', 'number'], ['TIMESTAMP', 'date'], ['DATE', 'date'], ['TIME', 'time'],
  ['BOOL', 'boolean'], ['RECORD', 'other'], ['JSON', 'other'],
  // parameters and spacing
  ['NUMERIC(10,2)', 'number'], ['DECIMAL(38, 9)', 'number'], ['decimal (38,9)', 'number'], ['VARCHAR(255)', 'string'], ['CHAR(10)', 'string'],
  ['CHARACTER VARYING', 'string'], ['CHARACTER  VARYING(20)', 'string'], ['NUMBER', 'number'], ['NUMBER(38,0)', 'number'],
  ['FLOAT4', 'number'], ['FLOAT8', 'number'], ['INT2', 'number'], ['INT4', 'number'], ['INT8', 'number'], ['HUGEINT', 'number'],
  ['INTEGER', 'number'], ['LONG', 'number'], ['SHORT', 'number'], ['BYTE', 'number'], ['  string ', 'string'],
  ['TIMESTAMP_LTZ', 'date'], ['TIMESTAMP_TZ(9)', 'date'], ['TIMESTAMP(3)', 'date'], ['TIMESTAMP WITHOUT TIME ZONE', 'date'],
  ['TIME WITHOUT TIME ZONE', 'time'], ['TIME(3)', 'time'], ['BOOLEAN', 'boolean'],
  // mid-name parameters (Trino, Athena, Postgres format_type)
  ['timestamp(3) with time zone', 'date'], ['TIMESTAMP(6) WITHOUT TIME ZONE', 'date'], ['time(6) with time zone', 'time'], ['TIME(3) WITHOUT TIME ZONE', 'time'],
  // complex types stay other
  ['MAP(VARCHAR, ARRAY(INTEGER))', 'other'], ['STRUCT<a TIMESTAMP(3), b INT64>', 'other'],
  ['ARRAY<INT64>', 'other'], ['ARRAY(INTEGER)', 'other'], ['STRUCT<a INT64>', 'other'], ['ROW(a INTEGER)', 'other'], ['MAP<STRING,INT>', 'other'],
  ['VARIANT', 'other'], ['OBJECT', 'other'], ['GEOGRAPHY', 'other'], ['BYTES', 'other'], ['BINARY', 'other'], ['VARBINARY', 'other'], ['', 'other'],
])('%s is %s', (type, category) => {
  expect(categorizeFieldType(type)).toBe(category);
});

test('normalizeType and isDayType ignore case, spacing and parameters', () => {
  expect(normalizeType(' timestamp   with time zone ')).toBe('TIMESTAMP WITH TIME ZONE');
  expect(normalizeType('Numeric(10, 2)')).toBe('NUMERIC');
  expect(isDayType('date')).toBe(true);
  expect(isDayType('DATE ')).toBe(true);
  expect(isDayType('TIMESTAMP_LTZ')).toBe(false);
});
