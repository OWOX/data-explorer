import { isRecord, strings } from './guards';

test('isRecord accepts plain objects only', () => {
  expect(isRecord({})).toBe(true);
  expect(isRecord([])).toBe(false);
  expect(isRecord(null)).toBe(false);
  expect(isRecord('x')).toBe(false);
});

test('strings keeps the strings of a list and is empty for anything else', () => {
  expect(strings(['a', 1, 'b', null])).toEqual(['a', 'b']);
  expect(strings('a')).toEqual([]);
  expect(strings(undefined)).toEqual([]);
});

test('errorMessage reads an Error message and stringifies anything else', async () => {
  const { errorMessage } = await import('./guards');
  expect(errorMessage(new Error('boom'))).toBe('boom');
  expect(errorMessage('plain')).toBe('plain');
  expect(errorMessage(42)).toBe('42');
});
