import { ChartSpline, Hash } from 'lucide-react';
import { vi } from 'vitest';
import type { ChartFields } from './fields';
import { KINDS } from './kinds';
import { dropPicksOf, hideCard, listItems, setCardDate, setCardMetric, tailItems } from './listMenu';
import { cardsOf, martMeasures } from './Scorecards';
import type { ChartSettings } from './settings';

// A mart with a key, a date, a number and a string: every kind but spread is eligible once registered.
const date = { name: 'created_at', category: 'date', type: 'TIMESTAMP' } as never;
const dim = { name: 'status', category: 'string', type: 'STRING' } as never;
const amount = { name: 'amount', category: 'number', type: 'NUMERIC' } as never;
const cf: ChartFields = { marts: [{ aliasPath: '', recordsId: 'records:orders', title: '', hasPk: true, metrics: [{ field: amount, fn: 'SUM' }], dates: [date], dimensions: [dim] }], dates: [date], dimensions: [dim], counter: null };

test('the header list has the cards, Sparklines, one tick per chart and Add chart with the eligible kinds', () => {
  const change = vi.fn();
  const items = listItems({ cf, settings: {}, resolved: [{ spec: { id: 'time-series', kind: 'timeSeries' }, title: 'amount · Sum by date' }, { spec: { id: 'pie', kind: 'pie' }, title: null }], change });
  // Card labels come from metricLabel: the field label (no alias here) and AGG_LABELS.SUM.
  expect(items.map((i) => i.label)).toEqual(['Count Unique', 'amount · Sum', 'Sparklines', 'amount · Sum by date', 'Pie (columns hidden)', 'Add chart']);
  const add = items.at(-1)!;
  // Later tasks register more kinds: only the two that exist now are pinned; spread is never eligible (no percentiles).
  expect(add.kind === 'radio' && add.options.map((o) => o.label)).toEqual(expect.arrayContaining(['Time series', 'Pie']));
  expect(add.kind === 'radio' && add.options.map((o) => o.label)).not.toContain('Spread');
});

test('unticking a chart hides it and keeps its setup; Add chart appends a new chart', () => {
  let s: ChartSettings = { charts: [{ id: 'a', kind: 'pie', dimension: 'status' }] };
  const change = (edit: (c: ChartSettings) => ChartSettings) => { s = edit(s); };
  const items = () => listItems({ cf, settings: s, resolved: (s.charts ?? []).map((spec) => ({ spec, title: 'P' })), change });
  const tick = items().find((i) => i.label === 'P')!;
  if (tick.kind === 'check') tick.onToggle();
  expect(s.charts).toEqual([{ id: 'a', kind: 'pie', dimension: 'status', hidden: true }]);
  const add = items().at(-1)!;
  if (add.kind === 'radio') add.onPick('timeSeries');
  expect(s.charts!.map((c) => c.kind)).toEqual(['pie', 'timeSeries']);
  expect(s.charts![1]!.id).toMatch(/^c-/);
});

test('Chart type keeps the usable fields and the id; Remove deletes; removing the last chart saves an empty list', () => {
  let s: ChartSettings = { charts: [{ id: 'a', kind: 'pie', measure: 'amount', dimension: 'status', hidden: false }] };
  const change = (edit: (c: ChartSettings) => ChartSettings) => { s = edit(s); };
  const [type, remove] = tailItems({ cf, spec: s.charts![0]!, change });
  expect(type!.label).toBe('Chart type');
  if (type!.kind === 'radio') type!.onPick('timeSeries');
  expect(s.charts).toEqual([{ id: 'a', kind: 'timeSeries', measure: 'amount', hidden: false }]);
  if (remove!.kind === 'action') remove!.onPick();
  expect(s).toEqual({ charts: [] });
});

test('each chart row, and each Add chart and Chart type option, carries its kind icon; cards and Sparklines carry their own', () => {
  const change = vi.fn();
  const items = listItems({ cf, settings: {}, resolved: [{ spec: { id: 'a', kind: 'timeSeries' }, title: 'T' }, { spec: { id: 'b', kind: 'pie' }, title: null }], change });
  const icon = (label: string) => (items.find((i) => i.label === label) as { icon?: unknown }).icon;
  expect(icon('T')).toBe(KINDS.timeSeries.icon);
  expect(icon('Pie (columns hidden)')).toBe(KINDS.pie.icon);
  expect(icon('Count Unique')).toBe(Hash);
  expect(icon('Sparklines')).toBe(ChartSpline);
  const add = items.at(-1)!;
  expect(add.kind === 'radio' && add.options.every((o) => o.icon === KINDS[o.value as keyof typeof KINDS].icon)).toBe(true);
  const type = tailItems({ cf, spec: { id: 'a', kind: 'pie' }, change })[0]!;
  expect(type.kind === 'radio' && type.options.every((o) => !!o.icon)).toBe(true);
  expect(new Set(Object.values(KINDS).map((k) => k.icon)).size).toBe(Object.keys(KINDS).length);
});

test('a card shows its picked measure under its own id; a saved measure that is gone falls back to the default', () => {
  const mart = cf.marts[0]!;
  expect(cardsOf(mart).map((c) => [c.id, c.label])).toEqual([['records:orders', 'Count Unique'], ['amount', 'amount · Sum']]);
  const picked = cardsOf(mart, { amount: 'records' });
  expect(picked.map((c) => [c.id, c.label, c.key])).toEqual([['records:orders', 'Count Unique', 'Unique Count'], ['amount', 'Count Unique', 'Unique Count']]);
  expect(cardsOf(mart, { amount: 'gone' })).toEqual(cardsOf(mart));
  expect(martMeasures(mart)).toHaveLength(2);
});

test('the header tick of a card is named by the measure it shows', () => {
  const items = listItems({ cf, settings: { scorecards: { metrics: { amount: 'records' } } }, resolved: [], change: vi.fn() });
  expect(items.slice(0, 2).map((i) => i.label)).toEqual(['Count Unique', 'Count Unique']);
});

test('setCardMetric saves the pick, clears it for the card’s own measure and keeps other settings; hideCard adds the id once', () => {
  const mart = cf.marts[0]!;
  const a = setCardMetric({ scorecards: { hidden: ['x'], sparklines: false } }, 'amount', 'records', mart);
  expect(a.scorecards).toEqual({ hidden: ['x'], sparklines: false, metrics: { amount: 'records' } });
  expect(setCardMetric(a, 'amount', 'amount', mart).scorecards?.metrics).toEqual({});
  const h = hideCard(hideCard({}, 'amount'), 'amount');
  expect(h.scorecards?.hidden).toEqual(['amount']);
});

test('setCardDate saves the date per card, clears it for the mart date, and keeps the other picks', () => {
  const mart = cf.marts[0]!;
  const d2 = { name: 'paid_at', category: 'date', type: 'TIMESTAMP' } as never;
  const spark = { hidden: new Set<string>(), sparklines: true, metrics: {}, dates: {}, date };
  const m2 = { ...mart, dates: [date, d2] };
  const a = setCardDate({ scorecards: { metrics: { amount: 'records' } } }, 'amount', 'paid_at', m2, spark);
  expect(a.scorecards).toEqual({ metrics: { amount: 'records' }, dates: { amount: 'paid_at' } });
  expect(setCardDate(a, 'amount', 'created_at', m2, spark).scorecards?.dates).toEqual({});
});

test('a metric a card shows through its pick has no card of its own', () => {
  const qty = { name: 'qty', category: 'number', type: 'INT64' } as never;
  const mart = { ...cf.marts[0]!, metrics: [{ field: amount, fn: 'SUM' as const }, { field: qty, fn: 'SUM' as const }] };
  expect(cardsOf(mart, { amount: 'qty' }).map((c) => [c.id, c.measure.kind === 'metric' ? c.measure.metric.field.name : 'records'])).toEqual([['records:orders', 'records'], ['amount', 'qty']]);
  expect(cardsOf(mart, { amount: 'records' }).map((c) => c.id)).toEqual(['records:orders', 'amount', 'qty']);
});

test('dropPicksOf drops the metric and date picks that name a hidden column, and returns the same object when none do', () => {
  const cur: ChartSettings = { scorecards: { hidden: ['x'], metrics: { id: 'amount', a: 'other' }, dates: { id: 'created_at', b: 'paid_at' } } };
  expect(dropPicksOf(cur, new Set(['amount', 'paid_at']))).toEqual({ scorecards: { hidden: ['x'], metrics: { a: 'other' }, dates: { id: 'created_at' } } });
  expect(dropPicksOf(cur, new Set(['status']))).toBe(cur);
  const bare: ChartSettings = { scorecards: { hidden: ['x'] } };
  expect(dropPicksOf(bare, new Set(['amount']))).toBe(bare);
  expect(dropPicksOf({}, new Set(['amount']))).toEqual({});
});
