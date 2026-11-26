import { ChartColumn, ChartSpline, CopyPlus, EyeOff, Hash, LayoutGrid, Plus, RotateCcw, Scaling } from 'lucide-react';
import type { MenuItem } from './ChartMenu';
import { measuresOf, type ChartFields, type ChartMart } from './fields';
import { eligibleKinds, KINDS } from './kinds';
import { cardsOf, sparkDate } from './Scorecards';
import { editCharts, measureId, newChartId, patchChart, pickField, resetSize, type ChartKind, type ChartSettings, type ChartSpec, type Spark } from './settings';

type Change = (edit: (cur: ChartSettings) => ChartSettings) => void;

/** Hides a scorecard: the same edit as unticking it in the Charts group. */
export const hideCard = (cur: ChartSettings, id: string): ChartSettings => ({ ...cur, scorecards: { ...cur.scorecards, hidden: [...new Set([...(cur.scorecards?.hidden ?? []), id])] } });

/** Saves the measure a card shows. Picking the card's own measure clears the choice instead of saving it. */
export function setCardMetric(cur: ChartSettings, id: string, measure: string, mart: ChartMart): ChartSettings {
  const rest = Object.fromEntries(Object.entries(cur.scorecards?.metrics ?? {}).filter(([k]) => k !== id));
  const own = cardsOf(mart).find((c) => c.id === id);
  const metrics = own && measureId(own.measure) === measure ? rest : { ...rest, [id]: measure };
  return { ...cur, scorecards: { ...cur.scorecards, metrics } };
}

/** Saves the date a card's sparkline is drawn on. Picking the mart's own date (the one the trends follow) clears the choice, so the card follows later chart date changes. */
export function setCardDate(cur: ChartSettings, id: string, date: string, mart: ChartMart, spark: Spark): ChartSettings {
  const rest = Object.fromEntries(Object.entries(cur.scorecards?.dates ?? {}).filter(([k]) => k !== id));
  const dates = sparkDate(mart, spark)?.name === date ? rest : { ...rest, [id]: date };
  return { ...cur, scorecards: { ...cur.scorecards, dates } };
}

/**
 * Drops the card picks that name one of the columns the member has just hidden (a metric picked for a card, a date picked for its trend),
 * so showing the column again later does not silently switch the card. The same object comes back when nothing names them, so callers can skip the save.
 */
export function dropPicksOf(cur: ChartSettings, hidden: ReadonlySet<string>): ChartSettings {
  const keep = (m: Record<string, string> | undefined) => Object.fromEntries(Object.entries(m ?? {}).filter(([, v]) => !hidden.has(v)));
  const m = keep(cur.scorecards?.metrics);
  const d = keep(cur.scorecards?.dates);
  if (Object.keys(m).length === Object.keys(cur.scorecards?.metrics ?? {}).length && Object.keys(d).length === Object.keys(cur.scorecards?.dates ?? {}).length) return cur;
  return { ...cur, scorecards: { ...cur.scorecards, ...(cur.scorecards?.metrics ? { metrics: m } : {}), ...(cur.scorecards?.dates ? { dates: d } : {}) } };
}

/** The kinds drawn by one category dimension (`spec.dimension`). */
const BY_DIMENSION: ReadonlySet<ChartKind> = new Set(['pie', 'bar', 'rankedBar', 'spread', 'scatter', 'heatmap']);

/**
 * A new chart of a dimension kind starts on the dimension the fewest charts already show (the first of those in column order), so adding a
 * chart does not repeat one already on the page (hidden charts do not count). A dimension a chart saves but the columns no longer show counts as the one it falls back to.
 */
function withFreshDimension<S extends Omit<ChartSpec, 'id' | 'hidden'>>(spec: S, list: readonly ChartSpec[], cf: ChartFields): S {
  if (!BY_DIMENSION.has(spec.kind) || spec.dimension !== undefined || cf.dimensions.length === 0) return spec;
  const uses = new Map<string, number>();
  for (const c of list) {
    if (c.hidden || !BY_DIMENSION.has(c.kind)) continue;
    const name = pickField(cf.dimensions, c.dimension)!.name;
    uses.set(name, (uses.get(name) ?? 0) + 1);
  }
  const fresh = cf.dimensions.reduce((best, d) => ((uses.get(d.name) ?? 0) < (uses.get(best.name) ?? 0) ? d : best));
  return { ...spec, dimension: fresh.name };
}

/** The config menu's Add chart row: a radio of the chart kinds the shown columns allow. */
export function addChartItem({ cf, change }: { cf: ChartFields; change: Change }): MenuItem {
  // The row is always there, so the rows around it keep their places: with no kind to add, its submenu says what is missing.
  if (eligibleKinds(cf).length === 0) return { kind: 'group', label: 'Add chart', icon: Plus, items: [{ kind: 'action', label: measuresOf(cf).length > 0 ? 'Show a text or date column to chart it.' : 'Show a number column to chart it.', icon: ChartColumn, note: true, onPick: () => undefined }] };
  return {
    kind: 'radio', label: 'Add chart', icon: Plus, value: '',
    options: eligibleKinds(cf).map((k) => ({ value: k.kind, label: k.label, icon: k.icon })),
    onPick: (v) => change((cur) => editCharts(cur, (list) => [...list, { id: newChartId(), ...withFreshDimension(KINDS[v as ChartKind]!.create(cf), list, cf) }])),
  };
}

/**
 * The config menu's Charts row: a submenu of scorecard ticks, Sparklines and a tick per chart (hide/show, setup kept).
 * A hidden chart or scorecard comes back only from here, so it lists every one.
 */
export function chartListItem({ cf, settings, resolved, change }: { cf: ChartFields; settings: ChartSettings; resolved: { spec: ChartSpec; title: string | null }[]; change: Change }): MenuItem {
  const hidden = new Set(settings.scorecards?.hidden ?? []);
  const toggleCard = (id: string) => change((cur) => {
    const h = new Set(cur.scorecards?.hidden ?? []);
    if (!h.delete(id)) h.add(id);
    return { ...cur, scorecards: { ...cur.scorecards, hidden: [...h] } };
  });
  return {
    kind: 'group', label: 'Charts', icon: LayoutGrid,
    items: [
      ...cf.marts.flatMap((m, i) => cardsOf(m, settings.scorecards?.metrics).map((c): MenuItem => ({ kind: 'check', icon: Hash, label: i === 0 ? (c.measure.kind === 'records' && cf.marts.length > 1 && m.title ? `${m.title} · ${c.label}` : c.label) : `${m.title} · ${c.label}`, checked: !hidden.has(c.id), onToggle: () => toggleCard(c.id) }))),
      { kind: 'check', icon: ChartSpline, label: 'Sparklines', checked: settings.scorecards?.sparklines ?? true, onToggle: () => change((cur) => ({ ...cur, scorecards: { ...cur.scorecards, sparklines: !(cur.scorecards?.sparklines ?? true) } })) },
      ...resolved.map(({ spec, title }): MenuItem => ({
        kind: 'check',
        // A chart that cannot draw with the shown columns keeps its place and setup; its title needs fields, so it is named by type.
        label: title ?? `${KINDS[spec.kind].label} (columns hidden)`,
        icon: KINDS[spec.kind].icon,
        checked: !spec.hidden,
        onToggle: () => change((cur) => patchChart(cur, spec.id, { hidden: !spec.hidden })),
      })),
    ],
  };
}

/** A Sankey's first two columns stand for the one or two dimensions the other types keep, so a type switch carries them. */
const fromSankey = (c: ChartSpec): ChartSpec => (c.dimensions && c.kind === 'sankey' ? { ...c, dimension: c.dimensions[0], dimension2: c.dimensions[1] } : c);

/** The rows every chart's own menu ends with: Chart type (the eligible kinds; usable fields, id, size and hidden kept), Resize (on and off), Reset size for a resized chart, Duplicate and Hide. */
export function tailItems({ cf, spec, change, resizing, onResizing }: { cf: ChartFields; spec: ChartSpec; change: Change; resizing: boolean; onResizing: (on: boolean) => void }): MenuItem[] {
  return [
    {
      kind: 'radio', label: 'Chart type', icon: ChartColumn, value: spec.kind,
      options: eligibleKinds(cf).map((k) => ({ value: k.kind, label: k.label, icon: k.icon })),
      onPick: (v) => change((cur) => editCharts(cur, (list) => list.map((c) => (c.id === spec.id ? { id: c.id, ...(c.hidden !== undefined ? { hidden: c.hidden } : {}), ...(c.size ? { size: c.size } : {}), ...KINDS[v as ChartKind]!.create(cf, fromSankey(c)) } : c)))),
    },
    { kind: 'action', label: resizing ? 'Done resizing' : 'Resize', icon: Scaling, onPick: () => onResizing(!resizing) },
    ...(spec.size ? [{ kind: 'action', label: 'Reset size', icon: RotateCcw, onPick: () => change((cur) => resetSize(cur, spec.id)) } satisfies MenuItem] : []),
    // The copy sits right after its original, with its own id and no hidden flag; structuredClone keeps the two from sharing arrays.
    { kind: 'action', label: 'Duplicate', icon: CopyPlus, onPick: () => change((cur) => editCharts(cur, (list) => list.flatMap((c) => (c.id === spec.id ? [c, { ...structuredClone(c), id: newChartId(), hidden: undefined }] : [c])))) },
    { kind: 'action', label: 'Hide', icon: EyeOff, onPick: () => change((cur) => patchChart(cur, spec.id, { hidden: true })) },
  ];
}
