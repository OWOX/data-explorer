import { expect, test } from 'vitest';
import type { ChartFields, ChartMart } from './fields';
import type { Measure } from './queries';
import { chartListItem } from './listMenu';
import { measureLabel } from './Scorecards';

const mart = (aliasPath: string, title: string): ChartMart => ({ aliasPath, recordsId: `records:${title}`, title, hasPk: true, metrics: [], dates: [], dimensions: [] });
const cf: ChartFields = { marts: [mart('', 'User | Entity'), mart('c', 'Contact')], dimensions: [], dates: [] };
const main: Measure = { kind: 'records', aliasPath: '', recordsId: 'records:User | Entity' };
const joined: Measure = { kind: 'records', aliasPath: 'c', recordsId: 'records:Contact' };

test('the main mart’s Count Unique stays short when only its own measures are in play', () => {
  expect(measureLabel(cf, main)).toBe('Count Unique');
  expect(measureLabel(cf, main, [main])).toBe('Count Unique');
});

test('it names its mart once measures from more than one mart are shown together', () => {
  expect(measureLabel(cf, main, [main, joined])).toBe('User | Entity · Count Unique');
  expect(measureLabel(cf, joined, [main, joined])).toBe('Contact · Count Unique');
});

test('a joined mart’s Count Unique always names its mart', () => {
  expect(measureLabel(cf, joined)).toBe('Contact · Count Unique');
});

/** The rows of the Charts group. */
const listItems = (args: Parameters<typeof chartListItem>[0]) => { const g = chartListItem(args); return g.kind === 'group' ? g.items : []; };

test('the Charts group names the main mart’s Count Unique when other marts are listed too', () => {
  const items = listItems({ cf, settings: {}, resolved: [], change: () => {} });
  expect(items.slice(0, 2).map((i) => i.label)).toEqual(['User | Entity · Count Unique', 'Contact · Count Unique']);
  const solo = listItems({ cf: { ...cf, marts: [cf.marts[0]!] }, settings: {}, resolved: [], change: () => {} });
  expect(solo[0]!.label).toBe('Count Unique');
});

test('a line chart’s title names the main mart only when its two measures span marts', async () => {
  const { KINDS } = await import('./kinds');
  const r = (measure2: Measure | null) => ({ date: {} as never, bucket: 'AUTO' as const, measure: main, measure2, stack: null, area: false });
  expect(KINDS.line.title(r(joined) as never, cf)).toBe('User | Entity · Count Unique and Contact · Count Unique by date');
  expect(KINDS.line.title(r(null) as never, cf)).toBe('Count Unique by date');
});
