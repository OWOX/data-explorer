import { ChartArea, ChartLine, ChartNoAxesCombined, ChartColumnStacked } from 'lucide-react';
import { BUCKET_LABELS, type DateBucket } from '../../model/aggregation';
import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { emptyText } from '../../ui/format';
import type { MenuItem } from '../ChartMenu';
import { fieldGroups, measureGroups } from '../menuGroups';
import { ChartPanel } from '../ChartPanel';
import { BLANK_KEY } from '../blank';
import { bucketFilter, dimensionFilter } from '../clickFilters';
import { measuresOf, menuOf } from '../fields';
import { bucketZone, type Measure } from '../queries';
import { isIntegerMeasure, measureFormat, measureLabel } from '../Scorecards';
import { measureId, pickBucketChoice, pickField, pickMeasure } from '../settings';
import { LineChart } from '../svg/LineChart';
import { useBucket } from '../useBucket';
import { seriesColor, useDateSeries } from '../useDateSeries';
import { dateMenu, tickText } from './timeSeries';
import { carry, seriesWidth, type ChartKindDef, type PanelProps } from './types';

export type LineR = { date: Field; bucket: DateBucket | 'AUTO'; measure: Measure; measure2: Measure | null; stack: Field | null; area: boolean };

function LinePanel({ martId, cf, r, spark, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<LineR>) {
  const { date, measure, measure2, stack } = r;
  const scope = measure2 ? [measure, measure2] : [measure];
  const { bucket, error, retry } = useBucket(martId, date, r.bucket, filter, version, idle);
  const range = { error, retry };
  const one = useDateSeries({ martId, cf, spark, date, bucket, measure, stack, filter, version, idle, formatOf, range, scope });
  // The second measure is its own unstacked series; with none, its hook reads nothing.
  const two = useDateSeries({ martId, cf, spark, date, bucket, measure: measure2 ?? measure, stack: null, filter, version, idle: idle || !measure2, formatOf, scope });
  const failed = one.failed ?? (measure2 ? two.failed : undefined);
  const loading = one.loading || (!!measure2 && two.loading);
  const [lt, lf] = measureFormat(measure, formatOf);
  const [rt, rf] = measure2 ? measureFormat(measure2, formatOf) : [lt, lf];
  const others = measuresOf(menuOf(cf)).filter((m) => measureId(m) !== measureId(measure));
  const items: MenuItem[] = [
    ...dateMenu(cf, r, onChange),
    { kind: 'radio', label: 'Second measure', icon: ChartNoAxesCombined, value: measure2 ? measureId(measure2) : '', options: [{ value: '', label: 'Off' }], groups: measureGroups(menuOf(cf), others), onPick: (v) => onChange({ measure2: v === '' ? null : v }) },
    ...(measure2 ? [] : [{ kind: 'radio', label: 'Stack by', icon: ChartColumnStacked, value: stack?.name ?? '', options: [{ value: '', label: 'No stacking' }], groups: fieldGroups(menuOf(cf), menuOf(cf).dimensions), onPick: (v: string) => onChange({ stack: v === '' ? null : v }) } as MenuItem]),
    { kind: 'check', label: 'Area', icon: ChartArea, checked: r.area, onToggle: () => onChange({ area: !r.area }) },
    ...tail,
  ];
  const by = BUCKET_LABELS[bucket ?? 'DAY'].toLowerCase();
  const title = `${one.label}${measure2 ? ` and ${two.label}` : ''} by ${by}${stack ? ` · by ${fieldLabel(stack)}` : ''}`;
  const rightSeries = measure2 && two.series?.[0] ? { ...two.series[0], color: seriesColor(1) } : null;
  return (
    <ChartPanel title={bucket ? title : `${one.label} by date`} name="Line" items={ready ? items : null} width={seriesWidth(one.series?.[0]?.points.length ?? null)}
      loading={loading} error={failed?.error} onRetry={failed?.retry ?? (() => {})} empty={one.empty ? emptyText(hasFilters) : null}>
      {one.series && !loading && (() => {
        const left = one.series;
        const pick = (x: string, i?: number) => onFilter([bucketFilter(date, x, bucket!, bucketZone(date)), ...(stack && i !== undefined && !left[i]!.other ? [dimensionFilter(stack, left[i]!.blank ? BLANK_KEY : left[i]!.name)] : [])]);
        return <LineChart left={left} right={rightSeries} area={r.area} ariaLabel={title} formatLeft={(n) => tickText(n, lt, lf)} formatRight={(n) => tickText(n, rt, rf)} onPick={bucket ? pick : undefined} xTitle={columnTitle(date)} yTitle={one.label} yTitleRight={measure2 ? two.label : undefined} integerLeft={isIntegerMeasure(measure)} integerRight={!!measure2 && isIntegerMeasure(measure2)} />;
      })()}
    </ChartPanel>
  );
}

export const line: ChartKindDef<LineR> = {
  kind: 'line',
  label: 'Line',
  icon: ChartLine,
  eligible: (cf) => cf.dates.length > 0 && measuresOf(cf).length > 0,
  create: (_cf, from) => ({ kind: 'line', ...carry(from, ['measure', 'measure2', 'date', 'bucket', 'stack', 'area']) }),
  resolve(spec, cf) {
    const date = pickField(cf.dates, spec.date);
    const list = measuresOf(cf);
    const measure = pickMeasure(list, spec.measure);
    if (!date || !measure) return null;
    const measure2 = list.find((m) => measureId(m) === spec.measure2 && measureId(m) !== measureId(measure)) ?? null;
    return { date, bucket: pickBucketChoice(spec.bucket), measure, measure2, stack: measure2 ? null : pickField(cf.dimensions, spec.stack, null), area: spec.area === true };
  },
  title: (r, cf) => `${measureLabel(cf, r.measure, r.measure2 ? [r.measure, r.measure2] : undefined)}${r.measure2 ? ` and ${measureLabel(cf, r.measure2, [r.measure, r.measure2])}` : ''} by date`,
  Panel: LinePanel,
};
