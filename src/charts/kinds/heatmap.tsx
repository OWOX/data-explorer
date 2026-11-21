import { Grid3x3 } from 'lucide-react';
import { BUCKET_LABELS, DATE_BUCKETS, formatBucket, type DateBucket } from '../../model/aggregation';
import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { emptyText } from '../../ui/format';
import type { MenuItem } from '../ChartMenu';
import { ChartPanel } from '../ChartPanel';
import { bucketFilter, dimensionFilter, isBucketDate } from '../clickFilters';
import { measuresOf } from '../fields';
import { bucketZone, dateFilter, heatmapQuery, measureKey, topValuesQuery, type Measure } from '../queries';
import { measureLabel, measureOptions, measureText, numberOf } from '../Scorecards';
import { measureId, pickBucketChoice, pickField, pickMeasure } from '../settings';
import { Heatmap } from '../svg/Heatmap';
import { useBucket } from '../useBucket';
import { useChartQuery } from '../useChartQuery';
import { blanksItem } from './timeSeries';
import { carry, seriesWidth, type ChartKindDef, type PanelProps } from './types';

type Cols = { kind: 'date'; date: Field; bucket: DateBucket | 'AUTO' } | { kind: 'dim'; dim: Field };
export type HeatR = { rows: Field; cols: Cols; measure: Measure };

function HeatmapPanel({ martId, cf, spec, r, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<HeatR>) {
  const { rows: y, cols, measure } = r;
  const date = cols.kind === 'date' ? cols.date : null;
  const blanks = spec.blanks === true;
  // Dimension axes always leave blanks out; only a date column has the choice.
  const dateRules = date ? dateFilter(filter, date, blanks) : filter;
  const { bucket, error, retry } = useBucket(martId, date, cols.kind === 'date' ? cols.bucket : 'AUTO', dateRules, version, idle || !date);
  const yTop = useChartQuery(martId, idle ? null : topValuesQuery(y, measure, dateRules), version);
  const xTop = useChartQuery(martId, !idle && cols.kind === 'dim' ? topValuesQuery(cols.dim, measure, filter) : null, version);
  const yNames = yTop.rows?.map((row) => String(row[y.name]));
  const xNames = cols.kind === 'dim' ? xTop.rows?.map((row) => String(row[cols.dim.name])) : undefined;
  const x = cols.kind === 'date' ? (bucket ? { kind: 'date' as const, date: cols.date, bucket } : null) : xNames ? { kind: 'dim' as const, dim: cols.dim, top: xNames } : null;
  const ready2 = !idle && !!x && !!yNames?.length && (x.kind === 'date' || x.top.length > 0);
  const cells = useChartQuery(martId, ready2 ? heatmapQuery(x!, y, yNames!, measure, dateRules) : null, version);
  const failed = [{ error, retry }, yTop, xTop, cells].find((q) => q.error);
  const empty = yTop.rows?.length === 0 || xTop.rows?.length === 0 || cells.rows?.length === 0;
  const loading = !empty && !cells.rows;
  const key = measureKey(measure);
  const xCol = cols.kind === 'date' ? cols.date.name : cols.dim.name;
  const at = new Map((cells.rows ?? []).map((row) => [`${String(row[xCol])}|${String(row[y.name])}`, row]));
  const xs = cols.kind === 'date'
    ? [...new Set((cells.rows ?? []).map((row) => String(row[xCol])))].sort().map((k) => ({ key: k, label: formatBucket(k, bucket!) ?? k }))
    : (xNames ?? []).map((k) => ({ key: k, label: k }));
  const ys = (yNames ?? []).map((k) => ({ key: k, label: k }));
  const colOptions = [...cf.dates.map((d) => ({ value: `date:${d.name}`, label: columnTitle(d) })), ...cf.dimensions.filter((d) => d !== y).map((d) => ({ value: `dim:${d.name}`, label: columnTitle(d) }))];
  const items: MenuItem[] = [
    { kind: 'radio', label: 'Rows', value: y.name, options: cf.dimensions.map((d) => ({ value: d.name, label: columnTitle(d) })), onPick: (v) => onChange({ dimension: v }) },
    { kind: 'radio', label: 'Columns', value: cols.kind === 'date' ? `date:${cols.date.name}` : `dim:${cols.dim.name}`, options: colOptions,
      onPick: (v) => onChange(v.startsWith('date:') ? { date: v.slice(5), dimension2: undefined } : { dimension2: v.slice(4) }) },
    ...(cols.kind === 'date' ? [{ kind: 'radio', label: 'Bucket', value: cols.bucket, options: [{ value: 'AUTO', label: 'Auto' }, ...DATE_BUCKETS.map((b) => ({ value: b, label: BUCKET_LABELS[b] }))], onPick: (v: string) => onChange({ bucket: v as DateBucket | 'AUTO' }) } as MenuItem] : []),
    { kind: 'radio', label: 'Metric', value: measureId(measure), options: measureOptions(cf, measuresOf(cf)), onPick: (v) => onChange({ measure: v }) },
    ...(date ? [blanksItem(blanks, onChange)] : []),
    ...tail,
  ];
  const xLabel = cols.kind === 'date' ? fieldLabel(cols.date) : fieldLabel(cols.dim);
  const title = `${measureLabel(cf, measure)} by ${fieldLabel(y)} × ${xLabel}`;
  return (
    <ChartPanel title={title} name="Heatmap" items={ready ? items : null} width={seriesWidth(xs.length || null)}
      loading={loading} error={failed?.error} onRetry={failed?.retry ?? (() => {})} empty={empty ? emptyText(hasFilters) : null}
      note={`Rows with a blank ${fieldLabel(y)} are not shown.`}>
      {cells.rows && <Heatmap xs={xs} ys={ys} ariaLabel={title} xTitle={cols.kind === 'date' ? columnTitle(cols.date) : columnTitle(cols.dim)} yTitle={columnTitle(y)}
        cell={(xk, yk) => { const row = at.get(`${xk}|${yk}`); return row ? { value: numberOf(row[key]), text: measureText(measure, row[key], formatOf) } : undefined; }}
        canPickX={cols.kind === 'date' ? isBucketDate : undefined}
        onPick={(xk, yk) => onFilter([dimensionFilter(y, yk), cols.kind === 'date' ? bucketFilter(cols.date, xk, bucket!, bucketZone(cols.date)) : dimensionFilter(cols.dim, xk)])} />}
    </ChartPanel>
  );
}

export const heatmap: ChartKindDef<HeatR> = {
  kind: 'heatmap',
  label: 'Heatmap',
  icon: Grid3x3,
  eligible: (cf) => cf.dimensions.length > 0 && (cf.dates.length > 0 || cf.dimensions.length > 1) && measuresOf(cf).length > 0,
  create: (_cf, from) => ({ kind: 'heatmap', ...carry(from, ['measure', 'dimension', 'dimension2', 'date', 'bucket', 'blanks']) }),
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
