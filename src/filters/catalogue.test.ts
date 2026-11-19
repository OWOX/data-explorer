import { describeFilter, operatorsFor } from './catalogue';
import type { Field } from '../model/types';

const f = (type: string, category: Field['category']): Field => ({ name: 'x', alias: null, type, category, description: null, isPrimaryKey: false });
const ids = (field: Field) => operatorsFor(field).map((o) => o.id);

test('string operators', () => {
  expect(ids(f('STRING', 'string'))).toEqual(['contains', 'not_contains', 'eq', 'neq', 'starts_with', 'ends_with', 'is_blank', 'is_not_blank']);
});
test('number operators', () => {
  expect(ids(f('INT64', 'number'))).toEqual(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_blank', 'is_not_blank']);
});
test('DATE offers "on"; TIMESTAMP does not', () => {
  expect(ids(f('DATE', 'date'))).toEqual(['on', 'before', 'after', 'between', 'relative', 'is_blank', 'is_not_blank']);
  expect(ids(f('TIMESTAMP', 'date'))).toEqual(['before', 'after', 'between', 'relative', 'is_blank', 'is_not_blank']);
});
test('time, boolean and other', () => {
  expect(ids(f('TIME', 'time'))).toEqual(['before', 'after', 'between', 'is_blank', 'is_not_blank']);
  expect(ids(f('BOOL', 'boolean'))).toEqual(['is_true', 'is_false', 'is_blank']);
  expect(ids(f('JSON', 'other'))).toEqual(['is_blank', 'is_not_blank']);
});

import { DATE_PRESETS, fromRule, isPreset, presetName, toRule } from './catalogue';
import { isComplete, toTraverseFilters } from './build';

describe('date presets', () => {
  const ts: Field = { name: 'created_at', alias: null, type: 'TIMESTAMP', category: 'date', description: null, isPrimaryKey: false };

  test('the fourteen presets, in order, with the API names for each', () => {
    expect(DATE_PRESETS.map((p) => p.label)).toEqual(['Today', 'Yesterday', 'Last 7 days', 'Last 14 days', 'Last 30 days', 'Last 90 days', 'This week', 'Last week', 'This month', 'Last month', 'This quarter', 'Last quarter', 'This year', 'Last 12 months']);
    expect(DATE_PRESETS.map((p) => p.rule)).toEqual([
      { kind: 'today' }, { kind: 'yesterday' },
      { kind: 'last_n_days', n: 7 }, { kind: 'last_n_days', n: 14 }, { kind: 'last_n_days', n: 30 }, { kind: 'last_n_days', n: 90 },
      { kind: 'this_week' }, { kind: 'last_week' }, { kind: 'this_month' }, { kind: 'last_month' },
      { kind: 'this_quarter' }, { kind: 'last_quarter' }, { kind: 'this_year' }, { kind: 'last_n_months', n: 12 },
    ]);
  });

  test('every preset is a complete relative filter and travels as a relative_date rule', () => {
    for (const p of DATE_PRESETS) {
      const f = { field: 'created_at', op: 'relative' as const, value: p.rule };
      expect(isComplete(f, ts)).toBe(true);
      expect(toTraverseFilters([ts], [f])).toEqual([{ column: 'created_at', operator: 'relative_date', value: p.rule }]);
    }
  });

  test('presetName names a rule, also one the presets do not cover', () => {
    expect(presetName({ kind: 'last_n_days', n: 30 })).toBe('Last 30 days');
    expect(presetName({ kind: 'last_n_days', n: 45 })).toBe('Last 45 days');
    expect(presetName({ kind: 'last_n_days', n: 1 })).toBe('Last 1 day');
    expect(presetName({ kind: 'last_n_months', n: 5 })).toBe('Last 5 months');
    expect(presetName({ kind: 'last_n_days', n: 21 })).toBe('Last 3 weeks');
    expect(presetName({ kind: 'last_n_days', n: 28 })).toBe('Last 4 weeks');
    expect(presetName({ kind: 'last_n_days', n: 35 })).toBe('Last 5 weeks');
    expect(presetName({ kind: 'last_n_months', n: 3 })).toBe('Last 3 months');
    expect(presetName({ kind: 'last_n_days', n: 7 })).toBe('Last 7 days');
    expect(presetName({ kind: 'last_n_months', n: 12 })).toBe('Last 12 months');
    expect(presetName({ kind: 'last_n_months', n: 24 })).toBe('Last 2 years');
    expect(presetName({ kind: 'this_week' })).toBe('This week');
  });

  test('toRule maps a unit onto the two rules the API has', () => {
    expect(toRule(5, 'days')).toEqual({ kind: 'last_n_days', n: 5 });
    expect(toRule(3, 'weeks')).toEqual({ kind: 'last_n_days', n: 21 });
    expect(toRule(5, 'months')).toEqual({ kind: 'last_n_months', n: 5 });
    expect(toRule(2, 'quarters')).toEqual({ kind: 'last_n_months', n: 6 });
    expect(toRule(2, 'years')).toEqual({ kind: 'last_n_months', n: 24 });
  });

  test('fromRule reopens a rule on the largest unit that divides it', () => {
    expect(fromRule({ kind: 'last_n_days', n: 5 })).toEqual({ n: 5, unit: 'days' });
    expect(fromRule({ kind: 'last_n_days', n: 21 })).toEqual({ n: 3, unit: 'weeks' });
    expect(fromRule({ kind: 'last_n_months', n: 5 })).toEqual({ n: 5, unit: 'months' });
    expect(fromRule({ kind: 'last_n_months', n: 6 })).toEqual({ n: 2, unit: 'quarters' });
    expect(fromRule({ kind: 'last_n_months', n: 24 })).toEqual({ n: 2, unit: 'years' });
    expect(fromRule({ kind: 'this_week' })).toBeUndefined();
    expect(fromRule(undefined)).toBeUndefined();
  });

  test('every unit round-trips through the rule', () => {
    for (const unit of ['days', 'weeks', 'months', 'quarters', 'years'] as const) {
      for (const n of [1, 2, 5]) expect(toRule(n, unit)).toBeDefined();
    }
    expect(fromRule(toRule(2, 'quarters'))).toEqual({ n: 2, unit: 'quarters' });
    expect(fromRule(toRule(2, 'years'))).toEqual({ n: 2, unit: 'years' });
    expect(fromRule(toRule(3, 'weeks'))).toEqual({ n: 3, unit: 'weeks' });
  });

  test('presetName tolerates a malformed rule', () => {
    expect(presetName(undefined as never)).toBe('');
    expect(presetName({ kind: { a: 1 } } as never)).toBe('');
  });

  test('isPreset matches the exact rule only', () => {
    expect(isPreset({ kind: 'last_n_days', n: 7 }, DATE_PRESETS[2]!.rule)).toBe(true);
    expect(isPreset({ kind: 'last_n_days', n: 8 }, DATE_PRESETS[2]!.rule)).toBe(false);
    expect(isPreset('2026-01-01', DATE_PRESETS[0]!.rule)).toBe(false);
  });
});

test('describeFilter labels a zoned chart range on a TIMESTAMP as UTC, and only that', () => {
  const value = { from: '2024-01-15 05:00:00', to: '2024-01-16 04:59:59' };
  expect(describeFilter(f('TIMESTAMP', 'date'), { op: 'between', value })).toMatch(/ \(UTC\)$/);
  expect(describeFilter(f('DATETIME', 'date'), { op: 'between', value })).not.toMatch(/UTC/);
  expect(describeFilter(f('TIMESTAMP', 'date'), { op: 'between', value: { from: '2024-01-15', to: '2024-01-16' } })).not.toMatch(/UTC/);
  expect(describeFilter(f('DATE', 'date'), { op: 'between', value })).not.toMatch(/UTC/);
  // Every instant type the charts zone gets the label, not only BigQuery's TIMESTAMP.
  expect(describeFilter(f('TIMESTAMPTZ', 'date'), { op: 'between', value })).toMatch(/ \(UTC\)$/);
  expect(describeFilter(f('TIMESTAMP_LTZ', 'date'), { op: 'between', value })).toMatch(/ \(UTC\)$/);
});
