import { matchesFilter } from './evaluate';

const row = { name: 'Alice', age: 30, active: true, joined: '2026-11-10', note: '  ' };
const now = new Date('2026-11-14T12:00:00Z');

test.each([
  [{ column: 'name', operator: 'contains', value: 'lic' }, true],
  [{ column: 'name', operator: 'not_contains', value: 'lic' }, false],
  [{ column: 'name', operator: 'starts_with', value: 'Al' }, true],
  [{ column: 'name', operator: 'ends_with', value: 'ce' }, true],
  [{ column: 'name', operator: 'eq', value: 'Alice' }, true],
  [{ column: 'age', operator: 'gt', value: 29 }, true],
  [{ column: 'age', operator: 'lte', value: 29 }, false],
  [{ column: 'age', operator: 'between', value: { from: 30, to: 40 } }, true],
  [{ column: 'age', operator: 'in', value: [1, 30] }, true],
  [{ column: 'name', operator: 'not_in', value: ['Alice'] }, false],
  [{ column: 'note', operator: 'is_blank' }, true],
  [{ column: 'name', operator: 'is_not_blank' }, true],
  [{ column: 'active', operator: 'is_true' }, true],
  [{ column: 'active', operator: 'is_false' }, false],
  [{ column: 'joined', operator: 'lt', value: '2026-11-11' }, true],
  [{ column: 'joined', operator: 'relative_date', value: { kind: 'last_n_days', n: 7 } }, true],
  [{ column: 'joined', operator: 'relative_date', value: { kind: 'today' } }, false],
] as const)('%o → %s', (f, expected) => {
  expect(matchesFilter(row, f as never, now)).toBe(expected);
});

test('regex matches the text and never a NULL; not_regex keeps a NULL', () => {
  const r = { name: 'Alice', gone: null };
  expect(matchesFilter(r, { column: 'name', operator: 'regex', value: '^Al' } as never)).toBe(true);
  expect(matchesFilter(r, { column: 'name', operator: 'not_regex', value: '^Al' } as never)).toBe(false);
  expect(matchesFilter(r, { column: 'gone', operator: 'regex', value: '.*' } as never)).toBe(false);
  expect(matchesFilter(r, { column: 'gone', operator: 'not_regex', value: '.*' } as never)).toBe(true);
});
