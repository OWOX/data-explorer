import { ChartSpline, Hash } from 'lucide-react';
import { vi } from 'vitest';
import type { ChartFields } from './fields';
import { KINDS } from './kinds';
import { addChartItem, chartListItem, dropPicksOf, hideCard, setCardDate, setCardMetric, tailItems as tail } from './listMenu';
import type { MenuItem } from './MenuItems';
import { cardsOf, martMeasures } from './Scorecards';
import type { ChartSettings } from './settings';

/** The rows of the Charts group: the cards, Sparklines and a tick per chart. */
const listItems = (args: Parameters<typeof chartListItem>[0]): MenuItem[] => {
  const group = chartListItem(args);
  if (group.kind !== 'group') throw new Error('Charts is a group');
  return group.items;
};

// A mart with a key, a date, a number and a string: every kind but spread is eligible once registered.
const date = { name: 'created_at', category: 'date', type: 'TIMESTAMP' } as never;
const dim = { name: 'status', category: 'string', type: 'STRING' } as never;
const amount = { name: 'amount', category: 'number', type: 'NUMERIC' } as never;
const cf: ChartFields = { marts: [{ aliasPath: '', recordsId: 'records:orders', title: '', hasPk: true, metrics: [{ field: amount, fn: 'SUM' }], dates: [date], dimensions: [dim] }], dates: [date], dimensions: [dim], counter: null };

/** The tail with resize mode off, unless a test says otherwise. */
const tailItems = (p: Omit<Parameters<typeof tail>[0], 'resizing' | 'onResizing'> & Partial<Parameters<typeof tail>[0]>) => tail({ resizing: false, onResizing: () => {}, ...p });
const row = (items: ReturnType<typeof tail>, label: string) => items.find((i) => i.label === label)!;

test('the Charts group has the cards, Sparklines and one tick per chart; Add chart is a row of its own with the eligible kinds', () => {
  const change = vi.fn();
  const items = listItems({ cf, settings: {}, resolved: [{ spec: { id: 'time-series', kind: 'timeSeries' }, title: 'amount · Sum by date' }, { spec: { id: 'pie', kind: 'pie' }, title: null }], change });
  // Card labels come from metricLabel: the field label (no alias here) and AGG_LABELS.SUM.
  expect(items.map((i) => i.label)).toEqual(['Count Unique', 'amount · Sum', 'Sparklines', 'amount · Sum by date', 'Pie (columns hidden)']);
  const group = chartListItem({ cf, settings: {}, resolved: [], change });
  expect(group).toMatchObject({ kind: 'group', label: 'Charts' });
  const add = addChartItem({ cf, change });
  expect(add.label).toBe('Add chart');
  // Later tasks register more kinds: only the two that exist now are pinned; spread is never eligible (no percentiles).
  expect(add.kind === 'radio' && add.options.map((o) => o.label)).toEqual(expect.arrayContaining(['Time series', 'Pie']));
  expect(add.kind === 'radio' && add.options.map((o) => o.label)).not.toContain('Spread');
});

test('unticking a chart hides it and keeps its setup; Add chart appends a new chart', () => {
  let s: ChartSettings = { version: 2, charts: [{ id: 'a', kind: 'pie', dimension: 'status' }] };
  const change = (edit: (c: ChartSettings) => ChartSettings) => { s = edit(s); };
  const items = () => listItems({ cf, settings: s, resolved: (s.charts ?? []).map((spec) => ({ spec, title: 'P' })), change });
  const tick = items().find((i) => i.label === 'P')!;
  if (tick.kind === 'check') tick.onToggle();
  expect(s.charts).toEqual([{ id: 'a', kind: 'pie', dimension: 'status', hidden: true }]);
  const add = addChartItem({ cf, change });
  if (add.kind === 'radio') add.onPick('timeSeries');
  expect(s.charts!.map((c) => c.kind)).toEqual(['pie', 'timeSeries']);
  expect(s.charts![1]!.id).toMatch(/^c-/);
});

test('the Charts group lists every chart, hidden ones ticked off, so any of them can be shown again', () => {
  const specs: ChartSettings['charts'] = [{ id: 'a', kind: 'pie', dimension: 'status', hidden: true }, { id: 'b', kind: 'timeSeries' }];
  const items = listItems({ cf, settings: { scorecards: { hidden: ['amount'] } }, resolved: specs!.map((spec) => ({ spec, title: spec.id })), change: vi.fn() });
  const ticks = Object.fromEntries(items.map((i) => [i.label, i.kind === 'check' && i.checked]));
  expect(ticks).toEqual({ 'Count Unique': true, 'amount · Sum': false, Sparklines: true, a: false, b: true });
});

test('Chart type keeps the usable fields and the id', () => {
  let s: ChartSettings = { version: 2, charts: [{ id: 'a', kind: 'pie', measure: 'amount', dimension: 'status', hidden: false }] };
  const change = (edit: (c: ChartSettings) => ChartSettings) => { s = edit(s); };
  const [type] = tailItems({ cf, spec: s.charts![0]!, change });
  expect(type!.label).toBe('Chart type');
  if (type!.kind === 'radio') type!.onPick('timeSeries');
  expect(s.charts).toEqual([{ id: 'a', kind: 'timeSeries', measure: 'amount', hidden: false }]);
});

test('the tail is Chart type, Resize, Duplicate and Hide, with no Remove', () => {
  const items = tailItems({ cf, spec: { id: 'a', kind: 'pie' }, change: vi.fn() });
  expect(items.map((i) => i.label)).toEqual(['Chart type', 'Resize', 'Duplicate', 'Hide']);
});

test('Resize turns the mode on and off; a resized chart also has Reset size, which drops only its size', () => {
  let s: ChartSettings = { version: 2, charts: [{ id: 'a', kind: 'pie', measure: 'amount', size: { cols: 20 } }, { id: 'b', kind: 'pie', size: { rows: 12 } }] };
  const change = (edit: (c: ChartSettings) => ChartSettings) => { s = edit(s); };
  const onResizing = vi.fn();
  const items = tailItems({ cf, spec: s.charts![0]!, change, onResizing });
  expect(items.map((i) => i.label)).toEqual(['Chart type', 'Resize', 'Reset size', 'Duplicate', 'Hide']);
  const press = (i: MenuItem) => { if (i.kind === 'action') i.onPick(); };
  press(row(items, 'Resize'));
  expect(onResizing).toHaveBeenLastCalledWith(true);
  press(row(tailItems({ cf, spec: s.charts![0]!, change, resizing: true, onResizing }), 'Done resizing'));
  expect(onResizing).toHaveBeenLastCalledWith(false);
  press(row(items, 'Reset size'));
  expect(s.charts).toEqual([{ id: 'a', kind: 'pie', measure: 'amount' }, { id: 'b', kind: 'pie', size: { rows: 12 } }]);
});

test('a chart keeps its size through a type switch and a duplicate', () => {
  let s: ChartSettings = { version: 2, charts: [{ id: 'a', kind: 'pie', size: { cols: 20, rows: 12 } }] };
  const change = (edit: (c: ChartSettings) => ChartSettings) => { s = edit(s); };
  const type = row(tailItems({ cf, spec: s.charts![0]!, change }), 'Chart type');
  if (type.kind === 'radio') type.onPick('bar');
  expect(s.charts![0]).toMatchObject({ id: 'a', kind: 'bar', size: { cols: 20, rows: 12 } });
  const dup = row(tailItems({ cf, spec: s.charts![0]!, change }), 'Duplicate');
  if (dup.kind === 'action') dup.onPick();
  expect(s.charts![1]!.size).toEqual({ cols: 20, rows: 12 });
});

test('Duplicate inserts a copy right after the original: new id, same choices, not hidden, arrays not shared', () => {
  let s: ChartSettings = { version: 2, charts: [{ id: 'a', kind: 'sankey', dimensions: ['x', 'y'], hidden: true }, { id: 'b', kind: 'pie' }] };
  const change = (edit: (c: ChartSettings) => ChartSettings) => { s = edit(s); };
  const dup = row(tailItems({ cf, spec: s.charts![0]!, change }), 'Duplicate');
  if (dup.kind === 'action') dup.onPick();
  const [orig, copy, other] = s.charts!;
  expect(s.charts).toHaveLength(3);
  expect(other!.id).toBe('b');
  expect(copy!.id).not.toBe(orig!.id);
  expect(copy!.id).toMatch(/^c-/);
  expect(copy).toEqual({ id: copy!.id, kind: 'sankey', dimensions: ['x', 'y'] });
  expect(copy!.hidden).toBeUndefined();
  expect(copy!.dimensions).toEqual(['x', 'y']);
  expect(copy!.dimensions).not.toBe(orig!.dimensions);
});

test('a Sankey with one column or none switches to another type and back, and duplicates, as a valid spec', () => {
  const region = { name: 'region', category: 'string', type: 'STRING' } as never;
  const two: ChartFields = { ...cf, marts: [{ ...cf.marts[0]!, dimensions: [dim, region] }], dimensions: [dim, region] };
  for (const [dimensions, then] of [[[], ['status', 'region']], [['status'], ['status', 'region']]] as const) {
    let s: ChartSettings = { version: 2, charts: [{ id: 'a', kind: 'sankey', dimensions: [...dimensions] }] };
    const change = (edit: (c: ChartSettings) => ChartSettings) => { s = edit(s); };
    const pick = (to: string) => { const [type] = tailItems({ cf: two, spec: s.charts![0]!, change }); if (type!.kind === 'radio') type!.onPick(to); };
    pick('pie');
    expect(s.charts![0]).toEqual({ id: 'a', kind: 'pie', ...(dimensions.length ? { dimension: 'status' } : {}) });
    pick('sankey');
    // Back on a Sankey the columns the other type held fill it to the two it needs.
    expect(s.charts![0]).toEqual({ id: 'a', kind: 'sankey', dimensions: then });
  }
  let s: ChartSettings = { version: 2, charts: [{ id: 'a', kind: 'sankey', dimensions: [] }] };
  const change = (edit: (c: ChartSettings) => ChartSettings) => { s = edit(s); };
  const dup = row(tailItems({ cf, spec: s.charts![0]!, change }), 'Duplicate');
  if (dup.kind === 'action') dup.onPick();
  expect(s.charts![1]).toEqual({ id: s.charts![1]!.id, kind: 'sankey', dimensions: [] });
});

test('Duplicate on the default list saves the defaults with the copy after its original', () => {
  let s: ChartSettings = {};
  const change = (edit: (c: ChartSettings) => ChartSettings) => { s = edit(s); };
  const dup = row(tailItems({ cf, spec: { id: 'time-series', kind: 'timeSeries' }, change }), 'Duplicate');
  if (dup.kind === 'action') dup.onPick();
  expect(s.charts!.map((c) => c.kind)).toEqual(['timeSeries', 'timeSeries', 'pie']);
  expect(s.charts![0]!.id).toBe('time-series');
  expect(s.charts![1]!.id).toMatch(/^c-/);
});

test('Hide sets hidden and keeps the chart and its setup', () => {
  let s: ChartSettings = { version: 2, charts: [{ id: 'a', kind: 'pie', dimension: 'status' }] };
  const change = (edit: (c: ChartSettings) => ChartSettings) => { s = edit(s); };
  const hide = row(tailItems({ cf, spec: s.charts![0]!, change }), 'Hide');
  if (hide.kind === 'action') hide.onPick();
  expect(s.charts).toEqual([{ id: 'a', kind: 'pie', dimension: 'status', hidden: true }]);
});

test('each chart row, and each Add chart and Chart type option, carries its kind icon; cards and Sparklines carry their own', () => {
  const change = vi.fn();
  const items = listItems({ cf, settings: {}, resolved: [{ spec: { id: 'a', kind: 'timeSeries' }, title: 'T' }, { spec: { id: 'b', kind: 'pie' }, title: null }], change });
  const icon = (label: string) => (items.find((i) => i.label === label) as { icon?: unknown }).icon;
  expect(icon('T')).toBe(KINDS.timeSeries.icon);
  expect(icon('Pie (columns hidden)')).toBe(KINDS.pie.icon);
  expect(icon('Count Unique')).toBe(Hash);
  expect(icon('Sparklines')).toBe(ChartSpline);
  const add = addChartItem({ cf, change });
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

test('the empty Add chart row names what is missing: a number when no measure is shown, a text or date column when a number is', () => {
  const change = vi.fn();
  const noteOf = (c: ChartFields) => {
    const add = addChartItem({ cf: c, change });
    return add.kind === 'group' ? add.items.map((i) => [i.label, i.kind === 'action' && i.note]) : null;
  };
  const bare = { aliasPath: '', recordsId: 'records:orders', title: '', hasPk: false, metrics: [], dates: [], dimensions: [] };
  expect(noteOf({ marts: [{ ...bare, dimensions: [dim] }], dates: [], dimensions: [dim], counter: null })).toEqual([['Show a number column to chart it.', true]]);
  expect(noteOf({ marts: [{ ...bare, metrics: [{ field: amount, fn: 'SUM' }] }], dates: [], dimensions: [], counter: null })).toEqual([['Show a text or date column to chart it.', true]]);
  expect(noteOf({ marts: [{ ...bare, hasPk: true }], dates: [], dimensions: [], counter: null })).toEqual([['Show a text or date column to chart it.', true]]);
});

test('Add chart offers a Sankey only when two dimensions are shown', () => {
  const two = { ...cf, dimensions: [dim, { name: 'region', category: 'string', type: 'STRING' } as never] };
  const kinds = (c: ChartFields) => { const add = addChartItem({ cf: c, change: vi.fn() }); return add.kind === 'radio' ? add.options.map((o) => o.value) : []; };
  expect(kinds(cf)).not.toContain('sankey');
  expect(kinds(two)).toContain('sankey');
});
