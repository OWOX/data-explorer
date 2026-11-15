import { martAppUrl, VISIBLE_BUDGET, PAGE_SIZE } from './config';

test('martAppUrl builds the OWOX overview link', () => {
  expect(martAppUrl('p1', 'dm 1')).toBe('https://app.owox.com/ui/p1/data-marts/dm%201/overview');
});

test('budgets match the spec', () => {
  expect(VISIBLE_BUDGET).toBe(12);
  expect(PAGE_SIZE).toBe(200);
});
