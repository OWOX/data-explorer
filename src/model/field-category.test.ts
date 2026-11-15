import { categorizeFieldType } from './field-category';

test.each([
  ['STRING', 'string'], ['varchar', 'string'], ['INT64', 'number'], ['NUMERIC', 'number'],
  ['FLOAT64', 'number'], ['TIMESTAMP', 'date'], ['DATE', 'date'], ['TIME', 'time'],
  ['BOOL', 'boolean'], ['RECORD', 'other'], ['JSON', 'other'],
])('%s is %s', (type, category) => {
  expect(categorizeFieldType(type)).toBe(category);
});
