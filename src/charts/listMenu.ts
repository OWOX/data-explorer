import type { MenuItem } from './ChartMenu';
import type { ChartFields, ChartMart } from './fields';
import { eligibleKinds, KINDS } from './kinds';
import { cardsOf } from './Scorecards';
import { editCharts, measureId, newChartId, patchChart, type ChartKind, type ChartSettings, type ChartSpec } from './settings';

type Change = (edit: (cur: ChartSettings) => ChartSettings) => void;

/** The Data band header's Charts menu: scorecard ticks, Sparklines, a tick per chart (hide/show, setup kept) and Add chart. */
/** Hides a scorecard: the same edit as unticking it in the header list. */
export const hideCard = (cur: ChartSettings, id: string): ChartSettings => ({ ...cur, scorecards: { ...cur.scorecards, hidden: [...new Set([...(cur.scorecards?.hidden ?? []), id])] } });

/** Saves the measure a card shows. Picking the card's own measure clears the choice instead of saving it. */
export function setCardMetric(cur: ChartSettings, id: string, measure: string, mart: ChartMart): ChartSettings {
  const rest = Object.fromEntries(Object.entries(cur.scorecards?.metrics ?? {}).filter(([k]) => k !== id));
  const own = cardsOf(mart).find((c) => c.id === id);
  const metrics = own && measureId(own.measure) === measure ? rest : { ...rest, [id]: measure };
  return { ...cur, scorecards: { ...cur.scorecards, metrics } };
}

export function listItems({ cf, settings, resolved, change }: { cf: ChartFields; settings: ChartSettings; resolved: { spec: ChartSpec; title: string | null }[]; change: Change }): MenuItem[] {
  const hidden = new Set(settings.scorecards?.hidden ?? []);
  const toggleCard = (id: string) => change((cur) => {
    const h = new Set(cur.scorecards?.hidden ?? []);
    if (!h.delete(id)) h.add(id);
    return { ...cur, scorecards: { ...cur.scorecards, hidden: [...h] } };
  });
  return [
    ...cf.marts.flatMap((m, i) => cardsOf(m, settings.scorecards?.metrics).map((c): MenuItem => ({ kind: 'check', label: i === 0 ? c.label : `${m.title} · ${c.label}`, checked: !hidden.has(c.id), onToggle: () => toggleCard(c.id) }))),
    { kind: 'check', label: 'Sparklines', checked: settings.scorecards?.sparklines ?? true, onToggle: () => change((cur) => ({ ...cur, scorecards: { ...cur.scorecards, sparklines: !(cur.scorecards?.sparklines ?? true) } })) },
    ...resolved.map(({ spec, title }): MenuItem => ({
      kind: 'check',
      // A chart that cannot draw with the shown columns keeps its place and setup; its title needs fields, so it is named by type.
      label: title ?? `${KINDS[spec.kind]?.label ?? spec.kind} (columns hidden)`,
      icon: KINDS[spec.kind]?.icon,
      checked: !spec.hidden,
      onToggle: () => change((cur) => patchChart(cur, spec.id, { hidden: !spec.hidden })),
    })),
    {
      kind: 'radio', label: 'Add chart', value: '',
      options: eligibleKinds(cf).map((k) => ({ value: k.kind, label: k.label, icon: k.icon })),
      onPick: (v) => change((cur) => editCharts(cur, (list) => [...list, { id: newChartId(), ...KINDS[v as ChartKind]!.create(cf) }])),
    },
  ];
}

/** The rows every chart's own menu ends with: Chart type (the eligible kinds; usable fields, id and hidden kept) and Remove. */
export function tailItems({ cf, spec, change }: { cf: ChartFields; spec: ChartSpec; change: Change }): MenuItem[] {
  return [
    {
      kind: 'radio', label: 'Chart type', value: spec.kind,
      options: eligibleKinds(cf).map((k) => ({ value: k.kind, label: k.label, icon: k.icon })),
      onPick: (v) => change((cur) => editCharts(cur, (list) => list.map((c) => (c.id === spec.id ? { id: c.id, ...(c.hidden !== undefined ? { hidden: c.hidden } : {}), ...KINDS[v as ChartKind]!.create(cf, c) } : c)))),
    },
    { kind: 'action', label: 'Remove', onPick: () => change((cur) => editCharts(cur, (list) => list.filter((c) => c.id !== spec.id))) },
  ];
}
