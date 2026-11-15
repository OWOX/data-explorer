import { martAppUrl, PAGE_SIZE } from './config';

test('martAppUrl builds the OWOX overview link', () => {
  expect(martAppUrl('p1', 'dm 1')).toBe('https://app.owox.com/ui/p1/data-marts/dm%201/overview');
});

test('the page size matches the spec', () => {
  expect(PAGE_SIZE).toBe(200);
});
