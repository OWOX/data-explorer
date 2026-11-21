import { describe, expect, it } from 'vitest';
import { NO_AGGREGATION } from '../model/aggregation';
import type { Field } from '../model/types';
import { chartFields, measuresOf, pieMeasures } from './fields';
import { sharesWhole } from './kinds/pie';
import { cardsOf, measureOptions } from './Scorecards';
import { measureId, pickMeasure, scorecardsOf } from './settings';

const f = (name: string, category: Field['category'], extra: Partial<Field> = {}): Field => ({ name, alias: null, type: category === 'number' ? 'FLOAT' : 'STRING', category, description: null, isPrimaryKey: false, ...extra });
const at = (martId: string, aliasPath: string, label: string) => ({ joined: { martId, label, aliasPath } });
// Orders (main, M), Customers joined at a and b, Orders joined to itself at s.
const schema = [
  f('id', 'string', { isPrimaryKey: true }), f('amount', 'number'), f('channel', 'string'),
  f('a__city', 'string', at('C', 'a', 'Customers')), f('a__ltv', 'number', at('C', 'a', 'Customers')),
  f('b__city', 'string', at('C', 'b', 'Customers')), f('b__ltv', 'number', at('C', 'b', 'Customers')),
  f('s__channel', 'string', at('M', 's', 'Orders')), f('s__amount', 'number', at('M', 's', 'Orders')),
];
const shown = schema.map((x) => x.name);
const build = () => chartFields(schema, shown, NO_AGGREGATION, 'M', ['', 'a', 'b', 's'], new Set(['a', 'b', 's']), { a: 'Customers (a)', b: 'Customers (b)', s: 'Orders (s)' });

describe('a mart joined twice and a self-join', () => {
  it('gives each path its own records id', () => {
    expect(build().marts.map((m) => m.recordsId)).toEqual(['records:M', 'records:C', 'records:C@b', 'records:M@s']);
  });
  it('has distinct Metric option values and labels', () => {
    const cf = build();
    const opts = measureOptions(cf, measuresOf(cf)).filter((o) => o.value.startsWith('records'));
    expect(opts.map((o) => o.value)).toEqual(['records', 'records:C', 'records:C@b', 'records:M@s']);
    expect(opts.map((o) => o.label)).toEqual(['Count Unique', 'Customers (a) · Count Unique', 'Customers (b) · Count Unique', 'Orders (s) · Count Unique']);
  });
  it('resolves a saved copy to its own path, on the series and on the pie', () => {
    const cf = build();
    expect(pickMeasure(measuresOf(cf), 'records:C@b')).toMatchObject({ kind: 'records', aliasPath: 'b', recordsId: 'records:C@b' });
    expect(pickMeasure(pieMeasures(cf), 'records:M@s')).toMatchObject({ kind: 'records', aliasPath: 's' });
    expect(pieMeasures(cf).filter((m) => m.kind === 'records').map((m) => measureId(m))).toEqual(['records', 'records:C', 'records:C@b', 'records:M@s']);
  });
  it('keeps a saved records:<martId> on the first path and "records" on main', () => {
    const cf = build();
    expect(pickMeasure(measuresOf(cf), 'records:C')).toMatchObject({ kind: 'records', aliasPath: 'a' });
    expect(pickMeasure(measuresOf(cf), 'records')).toMatchObject({ kind: 'records', aliasPath: '' });
  });
  it('has distinct card ids, and hiding one keeps the others', () => {
    const cf = build();
    const ids = cf.marts.map((m) => cardsOf(m).find((c) => c.label === 'Count Unique')!.id);
    expect(ids).toEqual(['records:M', 'records:C', 'records:C@b', 'records:M@s']);
    const all = cf.marts.flatMap((m) => cardsOf(m).map((c) => c.id));
    expect(new Set(all).size).toBe(all.length);
    const r = scorecardsOf({ scorecards: { hidden: ['records:C@b'] } });
    expect(cf.marts.map((m) => cardsOf(m).filter((c) => !r.hidden.has(c.id)).some((c) => c.id.startsWith('records'))))
      .toEqual([true, true, false, true]);
  });
  it('shows a share only for a measure and a dimension of one path', () => {
    const cf = build();
    const rec = (p: string) => measuresOf(cf).find((m) => m.kind === 'records' && m.aliasPath === p)!;
    const dim = (n: string) => schema.find((x) => x.name === n)!;
    expect(sharesWhole(rec('a'), dim('a__city'))).toBe(true);
    expect(sharesWhole(rec('a'), dim('b__city'))).toBe(false);
    expect(sharesWhole(rec(''), dim('s__channel'))).toBe(false);
    expect(sharesWhole(rec(''), dim('channel'))).toBe(true);
    const ltvB = measuresOf(cf).find((m) => m.kind === 'metric' && m.metric.field.name === 'b__ltv')!;
    expect(sharesWhole(ltvB, dim('a__city'))).toBe(false);
    expect(sharesWhole(ltvB, dim('b__city'))).toBe(true);
  });
});
