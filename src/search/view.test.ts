import { describe, expect, test } from 'vitest';
import type { Field, Schema } from '../model/types';
import { parseAiView } from './view';

const f = (name: string, type: string, category: Field['category'], extra: Partial<Field> = {}): Field => ({ name, alias: null, type, category, description: null, isPrimaryKey: false, ...extra });
const schema: Schema = [
  f('id', 'INT64', 'number', { isPrimaryKey: true }),
  f('status', 'STRING', 'string'),
  f('amount', 'NUMERIC', 'number'),
  f('created_at', 'TIMESTAMP', 'date'),
  f('is_gift', 'BOOL', 'boolean'),
  f('tags', 'ARRAY<STRING>', 'other'),
  f('calc', 'NUMERIC', 'number', { isCalculated: true }),
];

describe('parseAiView', () => {
  test('a good view becomes a grid: columns, a relative date filter, a sort, an aggregation', () => {
    const grid = parseAiView({
      columns: ['status', 'amount', 'created_at'],
      filters: [{ field: 'created_at', op: 'relative', value: { kind: 'last_month' } }, { field: 'status', op: 'eq', value: 'paid' }],
      sorts: [{ field: 'amount', direction: 'desc' }],
      aggregations: [{ column: 'amount', function: 'SUM' }],
    }, schema)!;
    expect(grid.columns).toEqual(['status', 'amount', 'created_at']);
    expect(grid.filters).toEqual({
      created_at: { field: 'created_at', op: 'relative', value: { kind: 'last_month' } },
      status: { field: 'status', op: 'eq', value: 'paid' },
    });
    expect(grid.sorts).toEqual([{ field: 'amount', direction: 'desc' }]);
    expect(grid.aggregations).toEqual([{ column: 'amount', function: 'SUM' }]);
    expect(grid.limit).toBe(200);
  });

  test('relative presets: yesterday, last N days with a bounded N; a made-up kind or a bad N is dropped', () => {
    const rel = (value: unknown) => parseAiView({ columns: ['created_at'], filters: [{ field: 'created_at', op: 'relative', value }] }, schema)!.filters.created_at?.value;
    expect(rel({ kind: 'yesterday' })).toEqual({ kind: 'yesterday' });
    expect(rel({ kind: 'last_n_days', n: 30 })).toEqual({ kind: 'last_n_days', n: 30 });
    expect(rel({ kind: 'yesterday', n: 5, extra: 1 })).toEqual({ kind: 'yesterday' });
    expect(rel({ kind: 'last_n_days', n: 0 })).toBeUndefined();
    expect(rel({ kind: 'last_n_days', n: 99999 })).toBeUndefined();
    expect(rel({ kind: 'last_n_days' })).toBeUndefined();
    expect(rel({ kind: 'next_year' })).toBeUndefined();
    expect(rel('yesterday')).toBeUndefined();
  });

  test('unknown fields, hidden-calculated-free columns, unknown operators and operators the field does not take are dropped', () => {
    const grid = parseAiView({
      columns: ['status', 'nope', 'status', 'amount'],
      filters: [
        { field: 'nope', op: 'eq', value: 1 },
        { field: 'status', op: 'gt', value: 'x' },
        { field: 'status', op: 'DROP TABLE', value: 'x' },
        { field: 'amount', op: 'contains', value: '1' },
        { field: 'amount', op: 'gte', value: '100' },
        { field: 'is_gift', op: 'is_true' },
      ],
      sorts: [{ field: 'ghost', direction: 'asc' }, { field: 'amount', direction: 'sideways' }, { field: 'status', direction: 'asc' }],
    }, schema)!;
    expect(grid.columns).toEqual(['status', 'amount']);
    expect(grid.filters).toEqual({ amount: { field: 'amount', op: 'gte', value: 100 }, is_gift: { field: 'is_gift', op: 'is_true' } });
    expect(grid.sorts).toEqual([{ field: 'status', direction: 'asc' }]);
  });

  test('values are checked against the operator: a number must be numeric, a date a date, a range needs both ends, an empty text is nothing', () => {
    const one = (flt: unknown) => parseAiView({ columns: ['status', 'amount', 'created_at'], filters: [flt] }, schema)!.filters;
    expect(one({ field: 'amount', op: 'gt', value: 'lots' })).toEqual({});
    expect(one({ field: 'amount', op: 'between', value: { from: 1, to: '5' } })).toEqual({ amount: { field: 'amount', op: 'between', value: { from: 1, to: 5 } } });
    expect(one({ field: 'amount', op: 'between', value: { from: 1 } })).toEqual({});
    expect(one({ field: 'created_at', op: 'after', value: '2026-01-02' })).toEqual({ created_at: { field: 'created_at', op: 'after', value: '2026-01-02' } });
    expect(one({ field: 'created_at', op: 'after', value: 'last tuesday' })).toEqual({});
    expect(one({ field: 'status', op: 'contains', value: '   ' })).toEqual({});
    expect(one({ field: 'status', op: 'is_blank', value: 'ignored' })).toEqual({ status: { field: 'status', op: 'is_blank' } });
    expect(one({ field: 'status', op: 'eq', value: { a: 1 } })).toEqual({});
  });

  test('a calculated field cannot be aggregated and a function the field does not allow is dropped (the view-link rules)', () => {
    const grid = parseAiView({
      columns: ['status', 'amount', 'calc'],
      aggregations: [{ column: 'amount', function: 'SUM' }, { column: 'amount', function: 'NOPE' }, { column: 'calc', function: 'SUM' }, { column: 'status', function: 'SUM' }],
    }, schema)!;
    expect(grid.aggregations).toEqual([{ column: 'amount', function: 'SUM' }]);
  });

  test('no valid column falls back to the default columns; a sort on a column that is not shown is left out', () => {
    const grid = parseAiView({ columns: ['nope'], filters: [{ field: 'status', op: 'eq', value: 'paid' }], sorts: [{ field: 'tags', direction: 'asc' }] }, schema)!;
    expect(grid.columns).toEqual(['id', 'status', 'amount', 'created_at', 'is_gift']);
    expect(grid.sorts).toBeNull();
  });

  test('nothing usable, or not an object, is no view', () => {
    expect(parseAiView({ columns: ['nope'], filters: [{ field: 'nope', op: 'eq', value: 1 }] }, schema)).toBeNull();
    expect(parseAiView({}, schema)).toBeNull();
    for (const bad of [null, undefined, 'x', 3, [], [{ columns: ['status'] }]]) expect(parseAiView(bad, schema)).toBeNull();
  });

  test('lists are capped and a prototype-polluting key does nothing', () => {
    const many = Array.from({ length: 200 }, () => 'status');
    expect(parseAiView({ columns: many }, schema)!.columns).toEqual(['status']);
    const grid = parseAiView(JSON.parse('{"columns":["status"],"__proto__":{"x":1},"filters":[{"field":"__proto__","op":"eq","value":"a"},{"field":"constructor","op":"eq","value":"a"}]}'), schema)!;
    expect(Object.keys(grid.filters)).toEqual([]);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});
