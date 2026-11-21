import { Grid3x3 } from 'lucide-react';
import { BUCKET_LABELS, DATE_BUCKETS, formatBucket, type DateBucket } from '../../model/aggregation';
import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { emptyText } from '../../ui/format';
import type { MenuItem } from '../ChartMenu';
import { ChartPanel } from '../ChartPanel';
import { BLANK_KEY, BLANK_LABEL, blankFirst, keyOf, labelOf } from '../blank';
import { bucketFilter, dimensionFilter } from '../clickFilters';
import { measuresOf } from '../fields';
import { bucketZone, heatmapQuery, measureKey, type HeatX, type Measure } from '../queries';
import { measureLabel, measureOptions, measureText, numberOf } from '../Scorecards';
import { measureId, pickBucketChoice, pickField, pickMeasure } from '../settings';
import { Heatmap } from '../svg/Heatmap';
import { useBucket } from '../useBucket';
import { useChartQuery } from '../useChartQuery';
import { useTopValues } from '../useTopValues';
import { carry, seriesWidth, type ChartKindDef, type PanelProps } from './types';

type Cols = { kind: 'date'; date: Field; bucket: DateBucket | 'AUTO' } | { kind: 'dim'; dim: Field };
export type HeatR = { rows: Field; cols: Cols; measure: Measure };

function HeatmapPanel({ martId, cf, r, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<HeatR>) {
  const { rows: y, cols, measure } = r;
  const date = cols.kind === 'date' ? cols.date : null;
  const { bucket, error, retry } = useBucket(martId, date, cols.kind === 'date' ? cols.bucket : 'AUTO', filter, version, idle || !date);
  // Each axis' values: the blank one first when it has rows, the top values after. A list cannot name NULL, so the blank row / column is read apart.
  const yTop = useTopValues({ martId, cf, dim: y, measure, filter, version, idle, withOther: false });
  const xTop = useTopValues({ martId, cf, dim: cols.kind === 'dim' ? cols.dim : y, measure, filter, version, idle: idle || cols.kind !== 'dim', withOther: false });
  const yNames = yTop.names;
  const yBlank = !!yTop.categories?.some((c) => c.key === BLANK_KEY);
  const xNames = cols.kind === 'dim' ? xTop.names : undefined;
  const xBlank = cols.kind === 'dim' && !!xTop.categories?.some((c) => c.key === BLANK_KEY);
  const xKnown = cols.kind === 'date' ? !!bucket : !!xTop.categories;
  const xReal = cols.kind === 'date' || !!xNames?.length;
  const xWith = (top: string[] | null): HeatX | null => (cols.kind === 'date' ? (bucket ? { kind: 'date', date: cols.date, bucket } : null) : { kind: 'dim', dim: cols.dim, top });
  const on = !idle && xKnown && !!yTop.categories;
  const read = (want: boolean, x: HeatX | null, yList: string[] | null) => (on && want && x ? heatmapQuery(x, y, yList, measure, filter) : null);
  const main = useChartQuery(martId, read(!!yNames?.length && xReal, xWith(xNames ?? []), yNames ?? []), version);
  const blankY = useChartQuery(martId, read(yBlank && xReal, xWith(xNames ?? []), null), version);
  const blankX = useChartQuery(martId, read(xBlank && !!yNames?.length, xWith(null), yNames ?? []), version);
  const blankXY = useChartQuery(martId, read(xBlank && yBlank, xWith(null), null), version);
  const reads = [main, blankY, blankX, blankXY];
  const failed = [{ error, retry }, yTop.failed, xTop.failed, ...reads].find((q) => q && q.error);
  const settled = on && reads.every((q) => q.rows || q.loading === false);
  const cellRows = reads.flatMap((q) => q.rows ?? []);
  const empty = yTop.empty || xTop.empty || (settled && cellRows.length === 0);
  const loading = !empty && !failed && !settled;
  const key = measureKey(measure);
  const xCol = cols.kind === 'date' ? cols.date.name : cols.dim.name;
  const at = new Map(cellRows.map((row) => [`${keyOf(row[xCol])}|${keyOf(row[y.name])}`, row]));
  const xs = cols.kind === 'date'
    ? blankFirst([...new Set(cellRows.map((row) => keyOf(row[xCol])))].sort()).map((k) => ({ key: k, label: k === BLANK_KEY ? BLANK_LABEL : formatBucket(k, bucket!) ?? k }))
    : (xTop.categories ?? []).map((c) => ({ key: c.key, label: labelOf(c.key) }));
  const ys = (yTop.categories ?? []).map((c) => ({ key: c.key, label: labelOf(c.key) }));
  const colOptions = [...cf.dates.map((d) => ({ value: `date:${d.name}`, label: columnTitle(d) })), ...cf.dimensions.filter((d) => d !== y).map((d) => ({ value: `dim:${d.name}`, label: columnTitle(d) }))];
  const items: MenuItem[] = [
    { kind: 'radio', label: 'Rows', value: y.name, options: cf.dimensions.map((d) => ({ value: d.name, label: columnTitle(d) })), onPick: (v) => onChange({ dimension: v }) },
    { kind: 'radio', label: 'Columns', value: cols.kind === 'date' ? `date:${cols.date.name}` : `dim:${cols.dim.name}`, options: colOptions,
      onPick: (v) => onChange(v.startsWith('date:') ? { date: v.slice(5), dimension2: undefined } : { dimension2: v.slice(4) }) },
    ...(cols.kind === 'date' ? [{ kind: 'radio', label: 'Bucket', value: cols.bucket, options: [{ value: 'AUTO', label: 'Auto' }, ...DATE_BUCKETS.map((b) => ({ value: b, label: BUCKET_LABELS[b] }))], onPick: (v: string) => onChange({ bucket: v as DateBucket | 'AUTO' }) } as MenuItem] : []),
    { kind: 'radio', label: 'Metric', value: measureId(measure), options: measureOptions(cf, measuresOf(cf)), onPick: (v) => onChange({ measure: v }) },
    ...tail,
  ];
  const xLabel = cols.kind === 'date' ? fieldLabel(cols.date) : fieldLabel(cols.dim);
  const title = `${measureLabel(cf, measure)} by ${fieldLabel(y)} × ${xLabel}`;
  return (
    <ChartPanel title={title} name="Heatmap" items={ready ? items : null} width={seriesWidth(xs.length || null)}
      loading={loading} error={failed?.error} onRetry={failed?.retry ?? (() => {})} empty={empty ? emptyText(hasFilters) : null}>
      {settled && <Heatmap xs={xs} ys={ys} ariaLabel={title} xTitle={cols.kind === 'date' ? columnTitle(cols.date) : columnTitle(cols.dim)} yTitle={columnTitle(y)}
        cell={(xk, yk) => { const row = at.get(`${xk}|${yk}`); return row ? { value: numberOf(row[key]), text: measureText(measure, row[key], formatOf) } : undefined; }}
        onPick={(xk, yk) => onFilter([dimensionFilter(y, yk), cols.kind === 'date' ? bucketFilter(cols.date, xk, bucket!, bucketZone(cols.date)) : dimensionFilter(cols.dim, xk)])} />}
    </ChartPanel>
  );
}

export const heatmap: ChartKindDef<HeatR> = {
  kind: 'heatmap',
  label: 'Heatmap',
  icon: Grid3x3,
  eligible: (cf) => cf.dimensions.length > 0 && (cf.dates.length > 0 || cf.dimensions.length > 1) && measuresOf(cf).length > 0,
  create: (_cf, from) => ({ kind: 'heatmap', ...carry(from, ['measure', 'dimension', 'dimension2', 'date', 'bucket']) }),
  resolve(spec, cf) {
    const rows = pickField(cf.dimensions, spec.dimension);
    const measure = pickMeasure(measuresOf(cf), spec.measure);
    if (!rows || !measure) return null;
    const second = cf.dimensions.find((d) => d.name === spec.dimension2 && d !== rows);
    const date = pickField(cf.dates, spec.date);
    const other = cf.dimensions.find((d) => d !== rows);
    const cols: Cols | null = second ? { kind: 'dim', dim: second } : date ? { kind: 'date', date, bucket: pickBucketChoice(spec.bucket) } : other ? { kind: 'dim', dim: other } : null;
    return cols ? { rows, cols, measure } : null;
  },
  title: (r, cf) => `${measureLabel(cf, r.measure)} by ${fieldLabel(r.rows)} × ${fieldLabel(r.cols.kind === 'date' ? r.cols.date : r.cols.dim)}`,
  Panel: HeatmapPanel,
};
