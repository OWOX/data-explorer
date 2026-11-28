import { buildReportPayload } from '../api/exports';
import type { ColumnFilter } from '../filters/build';
import type { Field, Schema } from '../model/types';
import type { GridState } from '../state/store';
import { PAGE_SIZE } from '../config';
import { defaultColumns } from '../model/columns';
import { fromTraverseFilter, reportSkippedMessage, reportToGrid, type ReportSkipped } from './report-load';

const f = (name: string, type: string, category: Field['category'], extra: Partial<Field> = {}): Field => ({ name, alias: null, type, category, description: null, isPrimaryKey: false, ...extra });
const name = f('name', 'STRING', 'string');
const amount = f('amount', 'NUMERIC', 'number');
const day = f('day', 'DATE', 'date');
const stamp = f('stamp', 'TIMESTAMP', 'date');
const clock = f('clock', 'TIME', 'time');
const paid = f('paid', 'BOOLEAN', 'boolean');
const country = f('customers__country_code', 'STRING', 'string', { joined: { martId: 'customers', label: 'Customers', aliasPath: 'customers' } });
const joinedDay = f('allowed_day', 'DATE', 'date', { allowedAggregations: ['STRING_AGG'] });
const schema: Schema = [name, amount, day, stamp, clock, paid, country, joinedDay];

const none: ReportSkipped = { columns: 0, filters: 0, sorts: 0, aggregations: 0, slices: 0, having: 0, uniqueCount: false };
const grid = (columns: string[], filters: ColumnFilter[], extra: Partial<GridState> = {}): GridState => ({ columns, filters: Object.fromEntries(filters.map((x) => [x.field, x])), sorts: null, limit: PAGE_SIZE, ...extra });
const roundTrip = (g: GridState) => {
  const { payload } = buildReportPayload(schema, g.columns, Object.values(g.filters), g.sorts ?? [], { aggregations: g.aggregations ?? [], dateTrunc: g.dateTrunc ?? [] }, Object.values(g.slices ?? {}));
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

  test('a TIME field keeps before and after', () => {
    const g = grid(['clock'], [{ field: 'clock', op: 'before', value: '10:00:00' }]);
    expect(roundTrip(g)).toEqual(g);
    const a = grid(['clock'], [{ field: 'clock', op: 'after', value: '10:00:00' }]);
    expect(roundTrip(a)).toEqual(a);
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
  test('in and not_in stay in / not_in; a text value with a comma is unsupported', () => {
    expect(fromTraverseFilter({ column: 'name', operator: 'in', value: ['a', 'b'] }, name)).toEqual({ field: 'name', op: 'in', value: 'a, b' });
    expect(fromTraverseFilter({ column: 'name', operator: 'not_in', value: ['a', 'b'] }, name)).toEqual({ field: 'name', op: 'not_in', value: 'a, b' });
    expect(fromTraverseFilter({ column: 'name', operator: 'in', value: ['a,b', 'c'] }, name)).toBeNull();
  });
  test('in on a number and on a date reads back as a list; numbers must be numbers', () => {
    expect(fromTraverseFilter({ column: 'amount', operator: 'in', value: [1, 2] }, amount)).toEqual({ field: 'amount', op: 'in', value: '1, 2' });
    expect(fromTraverseFilter({ column: 'amount', operator: 'in', value: ['1'] }, amount)).toBeNull();
    expect(fromTraverseFilter({ column: 'day', operator: 'not_in', value: ['2026-01-01', '2026-01-02'] }, day)).toEqual({ field: 'day', op: 'not_in', value: '2026-01-01, 2026-01-02' });
  });
  test('regex and not_regex map on text; a regex on a number is unsupported', () => {
    expect(fromTraverseFilter({ column: 'name', operator: 'regex', value: '^a' }, name)).toEqual({ field: 'name', op: 'regex', value: '^a' });
    expect(fromTraverseFilter({ column: 'name', operator: 'not_regex', value: 'a' }, name)).toEqual({ field: 'name', op: 'not_regex', value: 'a' });
    expect(fromTraverseFilter({ column: 'amount', operator: 'regex', value: 'a' }, amount)).toBeNull();
  });
  test('returns null for a type mismatch and a wrong value shape', () => {
    expect(fromTraverseFilter({ column: 'amount', operator: 'contains', value: 'a' }, amount)).toBeNull();
    expect(fromTraverseFilter({ column: 'amount', operator: 'gt', value: 'many' }, amount)).toBeNull();
    expect(fromTraverseFilter({ column: 'amount', operator: 'between', value: { from: 1 } }, amount)).toBeNull();
    expect(fromTraverseFilter({ column: 'name', operator: 'contains', value: '' }, name)).toBeNull();
    expect(fromTraverseFilter({ column: 'stamp', operator: 'relative_date', value: { kind: 'nope' } }, stamp)).toBeNull();
    expect(fromTraverseFilter('x', name)).toBeNull();
  });

  test('maps eq, lt, gt and relative_date on date fields', () => {
    expect(fromTraverseFilter({ column: 'day', operator: 'eq', value: '2026-01-02' }, day)).toEqual({ field: 'day', op: 'on', value: '2026-01-02' });
    expect(fromTraverseFilter({ column: 'stamp', operator: 'eq', value: '2026-01-02 10:00:00' }, stamp)).toEqual({ field: 'stamp', op: 'on', value: '2026-01-02 10:00:00' });
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

  test('a slice on a joined field and a HAVING rule with its aggregation load', () => {
    const r = reportToGrid(rep({
      columnConfig: ['name', 'amount', 'customers__country_code'],
      filterConfig: [
        { column: 'customers__country_code', operator: 'eq', value: 'UA', placement: 'pre-join' },
        { column: 'amount', operator: 'gt', value: 5, function: 'SUM' },
        { column: 'name', operator: 'contains', value: 'a' },
      ],
      aggregationConfig: [{ column: 'amount', function: 'SUM' }],
      uniqueCountConfig: [''],
    }), schema, schema);
    expect(r.skipped).toEqual({ ...none, uniqueCount: true });
    expect(r.grid?.filters).toEqual({ name: { field: 'name', op: 'contains', value: 'a' }, amount: { field: 'amount', op: 'gt', value: 5, fn: 'SUM' } });
    expect(r.grid?.slices).toEqual({ customers__country_code: { field: 'customers__country_code', op: 'eq', value: 'UA' } });
  });

  test('a slice on a main field is skipped and counted', () => {
    const r = reportToGrid(rep({ filterConfig: [{ column: 'name', operator: 'eq', value: 'a', placement: 'pre-join' }] }), schema, schema);
    expect(r.skipped).toEqual({ ...none, slices: 1 });
    expect(r.grid?.slices).toBeUndefined();
  });

  test('a HAVING rule without a matching aggregation or with an unknown function is skipped and counted', () => {
    const r = reportToGrid(rep({
      filterConfig: [
        { column: 'amount', operator: 'gt', value: 5, function: 'SUM' },
        { column: 'amount', operator: 'gt', value: 5, function: 'NOPE' },
      ],
      aggregationConfig: [{ column: 'amount', function: 'AVG' }],
    }), schema, schema);
    expect(r.skipped).toEqual({ ...none, having: 2 });
    expect(r.grid?.filters).toEqual({});
  });

  test('slices and HAVING filters survive a round trip with buildReportPayload', () => {
    const g = grid(['name', 'amount', 'customers__country_code'], [{ field: 'amount', op: 'gt', value: 5, fn: 'SUM' }], {
      aggregations: [{ column: 'amount', function: 'SUM' }],
      slices: { customers__country_code: { field: 'customers__country_code', op: 'eq', value: 'UA' } },
    });
    expect(roundTrip(g)).toEqual(g);
  });

  test('a STRING_AGG HAVING filter on a date column round-trips with a string operator', () => {
    const g = grid(['name', 'allowed_day'], [{ field: 'allowed_day', op: 'contains', value: '2026-01', fn: 'STRING_AGG' }], { aggregations: [{ column: 'allowed_day', function: 'STRING_AGG' }] });
    expect(roundTrip(g)).toEqual(g);
  });

  test('unique count flags', () => {
    const run = (u: unknown) => reportToGrid(rep({ uniqueCountConfig: u }), schema, schema).skipped.uniqueCount;
    expect(run(true)).toBe(true);
    expect(run([])).toBe(false);
    expect(run(false)).toBe(false);
    expect(run(null)).toBe(false);
  });

  describe('Unique Count', () => {
    const keyed: Schema = Object.assign([name, amount, country], { primaryKey: ['id'], joinedUniqueCount: ['customers'] });
    const load = (u: unknown, extra: object = {}) => reportToGrid(rep({ columnConfig: ['name', 'amount', 'customers__country_code'], uniqueCountConfig: u, ...extra }), keyed, keyed);

    test('true is the main mart, an array lists alias paths, and nothing is left out', () => {
      expect(load(true).grid?.uniqueCount).toEqual(['']);
      expect(load(true).skipped).toEqual(none);
      expect(load(['', 'customers']).grid?.uniqueCount).toEqual(['', 'customers']);
      expect(load(['', 'customers']).skipped).toEqual(none);
      expect(load(null).grid?.uniqueCount).toBeUndefined();
      expect(load([]).grid?.uniqueCount).toBeUndefined();
    });

    test('a path the grid cannot offer is reported and the rest is kept', () => {
      const r = load(['', 'campaigns']);
      expect(r.grid?.uniqueCount).toEqual(['']);
      expect(r.skipped).toEqual({ ...none, uniqueCount: true });
      // The main mart with no primary key offers none either.
      const unkeyed = reportToGrid(rep({ uniqueCountConfig: true }), schema, schema);
      expect(unkeyed.grid?.uniqueCount).toBeUndefined();
      expect(unkeyed.skipped.uniqueCount).toBe(true);
    });

    test('a sort on the count column is kept with the count', () => {
      expect(load(true, { sortConfig: [{ column: 'Unique Count', direction: 'desc' }] }).grid?.sorts).toEqual([{ field: 'Unique Count', direction: 'desc' }]);
    });

    test('survives a round trip with buildReportPayload', () => {
      const g = grid(['name', 'customers__country_code'], [], { uniqueCount: ['', 'customers'], sorts: [{ field: 'customers__unique_count', direction: 'asc' }] });
      const { payload } = buildReportPayload(keyed, g.columns, [], g.sorts ?? [], undefined, [], g.uniqueCount);
      expect(payload.uniqueCountConfig).toEqual(['', 'customers']);
      expect(reportToGrid({ id: 'r', ...payload }, keyed, keyed).grid).toEqual(g);
    });
  });

  test('an invalid bucket time zone is dropped and the rule kept', () => {
    const r = reportToGrid(rep({ columnConfig: ['stamp', 'amount'], dateTruncConfig: [{ column: 'stamp', unit: 'MONTH', timeZone: 'not a zone!' }] }), schema, schema);
    expect(r.grid?.dateTrunc).toEqual([{ column: 'stamp', unit: 'MONTH' }]);
  });

  test('a relative preset is rebuilt from its kind and n only', () => {
    const r = reportToGrid(rep({ filterConfig: [{ column: 'stamp', operator: 'relative_date', value: { kind: 'last_n_days', n: 7, extra: 'x' } }] }), schema, schema);
    expect(r.grid?.filters.stamp?.value).toEqual({ kind: 'last_n_days', n: 7 });
  });

  test('a repeated sort on one field keeps the first', () => {
    const r = reportToGrid(rep({ sortConfig: [{ column: 'amount', direction: 'desc' }, { column: 'amount', direction: 'asc' }] }), schema, schema);
    expect(r.grid?.sorts).toEqual([{ field: 'amount', direction: 'desc' }]);
    expect(r.skipped.sorts).toBe(1);
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
    const r = reportToGrid(rep({ filterConfig: [{ column: 'amount', operator: 'regex', value: 'a' }, { column: 'gone', operator: 'is_blank' }] }), schema, schema);
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
