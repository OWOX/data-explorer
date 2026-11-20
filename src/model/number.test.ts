import { toNumber } from './number';

test.each([
  [5, 5], ['5', 5], [' 1.5 ', 1.5], ['1e3', 1000],
  ['', null], ['  ', null], ['abc', null], [NaN, null], [Infinity, null], [true, null], [null, null], [undefined, null], [[5], null], [{}, null],
])('toNumber(%j) is %j', (input, expected) => {
  expect(toNumber(input)).toBe(expected);
});
