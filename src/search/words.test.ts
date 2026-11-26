import { expect, it } from 'vitest';
import { overlap, words } from './words';
it('splits into lower-case words of two or more characters', () => {
  expect(words('Ad Spend, by Country — 2024 Ü')).toEqual(['ad', 'spend', 'by', 'country', '2024']);
});
it('counts distinct shared words', () => {
  expect(overlap('users users signups', 'Users who signed up: signups')).toBe(2);
});
it('matches a plural with its singular in both directions', () => {
  expect(overlap('topics', 'Problem Topic')).toBe(1);
  expect(overlap('problem topic', 'Topics')).toBe(1);
  expect(overlap('bus', 'bu')).toBe(0);
});
