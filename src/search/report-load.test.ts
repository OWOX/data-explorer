import { buildReportPayload } from '../api/exports';
import type { ColumnFilter } from '../filters/build';
import type { Field, Schema } from '../model/types';
import type { GridState } from '../state/store';
import { PAGE_SIZE } from '../config';
import { defaultColumns } from '../ui/explorer/useMartRows';
import { fromTraverseFilter, reportSkippedMessage, reportToGrid, type ReportSkipped } from './report-load';

const f = (name: string, type: string, category: Field['category'], extra: Partial<Field> = {}): Field => ({ name, alias: null, type, category, description: null, isPrimaryKey: false, ...extra });
const name = f('name', 'STRING', 'string');
const amount = f('amount', 'NUMERIC', 'number');
const day = f('day', 'DATE', 'date');
const stamp = f('stamp', 'TIMESTAMP', 'date');
const paid = f('paid', 'BOOLEAN', 'boolean');
const country = f('customers__country_code', 'STRING', 'string', { joined: { martId: 'customers', label: 'Customers', aliasPath: 'customers' } });
const schema: Schema = [name, amount, day, stamp, paid, country];

const none: ReportSkipped = { columns: 0, filters: 0, sorts: 0, aggregations: 0, slices: 0, having: 0, uniqueCount: false };
const grid = (columns: string[], filters: ColumnFilter[], extra: Partial<GridState> = {}): GridState => ({ columns, filters: Object.fromEntries(filters.map((x) => [x.field, x])), sorts: null, limit: PAGE_SIZE, ...extra });
const roundTrip = (g: GridState) => {
  const { payload } = buildReportPayload(schema, g.columns, Object.values(g.filters), g.sorts ?? [], { aggregations: g.aggregations ?? [], dateTrunc: g.dateTrunc ?? [] });
  return reportToGrid({ id: 'r', ...payload }, schema, schema).grid;
};

describe('round trip with buildReportPayload', () => {
  test('text, number range and boolean filters', () => {
    const g = grid(['name', 'amount', 'paid'], [
      { field: 'name', op: 'contains', value: 'ab' },
      { field: 'amount', op: 'between', value: { from: 1, to: 5 } },
      { field: 'paid', op: 'is_true' },
    ], { sorts: [{ field: 'amount', direction: 'desc' }] });
    expect(roundTrip(g)).toEqual(g);
  });

  test('date, timestamp and relative filters', () => {
    const g = grid(['day', 'stamp'], [
      { field: 'day', op: 'on', value: '2026-01-02' },
      { field: 'stamp', op: 'before', value: '2026-03-01 10:00:00' },
    ]);
    expect(roundTrip(g)).toEqual(g);
    const between = grid(['stamp'], [{ field: 'stamp', op: 'between', value: { from: '2026-01-01', to: '2026-01-31' } }]);
    expect(roundTrip(between)).toEqual(between);
    const rel = grid(['stamp'], [{ field: 'stamp', op: 'relative', value: { kind: 'last_n_days', n: 7 } }]);
    expect(roundTrip(rel)).toEqual(rel);
  });

  test('a grouped grid with an aggregation and a month bucket', () => {
    const g = grid(['stamp', 'amount'], [], { aggregations: [{ column: 'amount', function: 'SUM' }], dateTrunc: [{ column: 'stamp', unit: 'MONTH' }] });
    expect(roundTrip(g)).toEqual(g);
  });

  test('a time zone on a bucket is kept', () => {
    const g = grid(['stamp', 'amount'], [], { aggregations: [{ column: 'amount', function: 'SUM' }], dateTrunc: [{ column: 'stamp', unit: 'MONTH', timeZone: 'Europe/Kyiv' }] });
    expect(roundTrip(g)).toEqual(g);
  });
});

describe('fromTraverseFilter', () => {
  test('returns null for in, regex, a type mismatch and a wrong value shape', () => {
    expect(fromTraverseFilter({ column: 'name', operator: 'in', value: ['a'] }, name)).toBeNull();
    expect(fromTraverseFilter({ column: 'name', operator: 'regex', value: 'a' }, name)).toBeNull();
    expect(fromTraverseFilter({ column: 'amount', operator: 'contains', value: 'a' }, amount)).toBeNull();
    expect(fromTraverseFilter({ column: 'amount', operator: 'gt', value: 'many' }, amount)).toBeNull();
    expect(fromTraverseFilter({ column: 'amount', operator: 'between', value: { from: 1 } }, amount)).toBeNull();
    expect(fromTraverseFilter({ column: 'name', operator: 'contains', value: '' }, name)).toBeNull();
    expect(fromTraverseFilter({ column: 'stamp', operator: 'eq', value: '2026-01-01' }, stamp)).toBeNull();
    expect(fromTraverseFilter({ column: 'stamp', operator: 'relative_date', value: { kind: 'nope' } }, stamp)).toBeNull();
    expect(fromTraverseFilter('x', name)).toBeNull();
  });

  test('slices and HAVING rules are not read here', () => {
    expect(fromTraverseFilter({ column: 'name', operator: 'contains', value: 'a', placement: 'pre-join' }, name)).toBeNull();
    expect(fromTraverseFilter({ column: 'amount', operator: 'gt', value: 1, function: 'SUM' }, amount)).toBeNull();
  });

  test('maps eq, lt, gt and relative_date on date fields', () => {
    expect(fromTraverseFilter({ column: 'day', operator: 'eq', value: '2026-01-02' }, day)).toEqual({ field: 'day', op: 'on', value: '2026-01-02' });
    expect(fromTraverseFilter({ column: 'stamp', operator: 'gt', value: '2026-01-02 10:00:00' }, stamp)).toEqual({ field: 'stamp', op: 'after', value: '2026-01-02 10:00:00' });
    expect(fromTraverseFilter({ column: 'amount', operator: 'eq', value: 3 }, amount)).toEqual({ field: 'amount', op: 'eq', value: 3 });
    expect(fromTraverseFilter({ column: 'name', operator: 'eq', value: 3 }, name)).toEqual({ field: 'name', op: 'eq', value: '3' });
  });

  test('a timestamp range that is not whole days keeps its bounds', () => {
    const v = { from: '2026-01-01 08:00:00', to: '2026-01-31 23:59:59' };
    expect(fromTraverseFilter({ column: 'stamp', operator: 'between', value: v }, stamp)).toEqual({ field: 'stamp', op: 'between', value: v });
  });
});

describe('reportToGrid', () => {
  const rep = (extra: object) => ({ id: 'r', columnConfig: ['name', 'amount'], ...extra });

  test('counts slices, HAVING rules and unique count', () => {
    const r = reportToGrid(rep({ filterConfig: [
      { column: 'customers__country_code', operator: 'eq', value: 'UA', placement: 'pre-join' },
      { column: 'amount', operator: 'gt', value: 5, function: 'SUM' },
      { column: 'name', operator: 'contains', value: 'a' },
    ], uniqueCountConfig: [''] }), schema, schema);
    expect(r.skipped).toEqual({ ...none, slices: 1, having: 1, uniqueCount: true });
    expect(r.grid?.filters).toEqual({ name: { field: 'name', op: 'contains', value: 'a' } });
  });

  test('unique count flags', () => {
    const run = (u: unknown) => reportToGrid(rep({ uniqueCountConfig: u }), schema, schema).skipped.uniqueCount;
    expect(run(true)).toBe(true);
    expect(run([])).toBe(false);
    expect(run(false)).toBe(false);
    expect(run(null)).toBe(false);
  });

  test('a second filter on a column is skipped', () => {
    const r = reportToGrid(rep({ filterConfig: [
      { column: 'name', operator: 'contains', value: 'a' },
      { column: 'name', operator: 'contains', value: 'b' },
    ] }), schema, schema);
    expect(r.grid?.filters.name).toEqual({ field: 'name', op: 'contains', value: 'a' });
    expect(r.skipped.filters).toBe(1);
  });

  test('a filter that cannot be read or sits on a missing field counts', () => {
    const r = reportToGrid(rep({ filterConfig: [{ column: 'name', operator: 'in', value: ['a'] }, { column: 'gone', operator: 'is_blank' }] }), schema, schema);
    expect(r.skipped.filters).toBe(2);
  });

  test('null columnConfig gives the default columns; non-array configs are empty', () => {
    const r = reportToGrid({ id: 'r', columnConfig: null, filterConfig: {} as never, sortConfig: 'x' as never }, schema, schema);
    expect(r.grid?.columns).toEqual(defaultColumns(schema));
    expect(r.grid?.sorts).toBeNull();
    expect(r.skipped).toEqual(none);
  });

  test('a column, sort or aggregation on a missing field is counted', () => {
    const r = reportToGrid(rep({
      columnConfig: ['name', 'gone', 'amount'],
      sortConfig: [{ column: 'gone', direction: 'asc' }, { column: 'name', direction: 'asc' }],
      aggregationConfig: [{ column: 'gone', function: 'SUM' }, { column: 'amount', function: 'NOPE' }],
    }), schema, schema);
    expect(r.skipped).toEqual({ ...none, columns: 1, sorts: 1, aggregations: 2 });
    expect(r.grid?.sorts).toEqual([{ field: 'name', direction: 'asc' }]);
  });

  test('every column gone gives no grid', () => {
    expect(reportToGrid(rep({ columnConfig: ['gone'] }), schema, schema).grid).toBeNull();
  });
});

describe('reportSkippedMessage', () => {
  test('null when nothing was skipped', () => expect(reportSkippedMessage(none)).toBeNull());
  test('lists the parts in order', () => {
    expect(reportSkippedMessage({ ...none, filters: 2, slices: 1, uniqueCount: true })).toBe("Some parts of this report aren't shown: 2 filters, 1 slice, unique count.");
  });
  test('plurals', () => {
    expect(reportSkippedMessage({ ...none, columns: 1, having: 1 })).toBe("Some parts of this report aren't shown: 1 column, 1 HAVING filter.");
    expect(reportSkippedMessage({ ...none, columns: 2, sorts: 2, aggregations: 2, having: 2 })).toBe("Some parts of this report aren't shown: 2 columns, 2 sorts, 2 aggregations, 2 HAVING filters.");
  });
});
