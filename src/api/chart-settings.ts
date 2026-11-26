import { isRecord } from '../model/guards';
import { isDateBucket } from '../model/aggregation';
import { isChartKind, SANKEY_MAX, type ChartSettings, type ChartSpec } from '../charts/settings';
import { cleanSize } from '../charts/resize';
import type { Ctx } from '../sdk/types';

export const CHARTS_COLLECTION = 'charts';

export interface ChartSettingsStore {
  /** The member's saved chart choices for a main mart; empty when there are none or the read failed. */
  load(martId: string): Promise<ChartSettings>;
  /** One write per call; resolves once the write settles. A failure is logged, never rejected, and changes nothing on screen. */
  save(martId: string, s: ChartSettings): Promise<void>;
}

const obj = (v: unknown): Record<string, unknown> | null => (isRecord(v) ? v : null);

function cleanSpec(v: unknown): ChartSpec | null {
  const o = obj(v);
  if (!o || typeof o.id !== 'string' || !isChartKind(o.kind)) return null;
  const out: ChartSpec = { id: o.id, kind: o.kind };
  if (typeof o.hidden === 'boolean') out.hidden = o.hidden;
  for (const k of ['measure', 'date', 'dimension', 'dimension2'] as const) if (typeof o[k] === 'string') out[k] = o[k] as string;
  for (const k of ['measure2', 'stack'] as const) if (o[k] === null || typeof o[k] === 'string') out[k] = o[k] as string | null;
  if (Array.isArray(o.dimensions)) {
    const names = [...new Set(o.dimensions.filter((x): x is string => typeof x === 'string'))].slice(0, SANKEY_MAX);
    out.dimensions = names;
  }
  if (o.bucket === 'AUTO' || isDateBucket(o.bucket)) out.bucket = o.bucket as ChartSpec['bucket'];
  if (o.orientation === 'vertical' || o.orientation === 'horizontal') out.orientation = o.orientation;
  if (typeof o.area === 'boolean') out.area = o.area;
  const size = cleanSize(o.size);
  if (size) out.size = size;
  return out;
}

// Drops what a stale or hand-edited doc could break the charts with: unknown keys and wrong types.
function clean(doc: unknown): ChartSettings {
  const d = obj(doc);
  if (!d) return {};
  const out: ChartSettings = {};
  const sc = obj(d.scorecards);
  if (sc) {
    out.scorecards = {};
    if (Array.isArray(sc.hidden)) out.scorecards.hidden = sc.hidden.filter((x): x is string => typeof x === 'string');
    if (typeof sc.sparklines === 'boolean') out.scorecards.sparklines = sc.sparklines;
    for (const k of ['metrics', 'dates'] as const) {
      const picks = obj(sc[k]);
      if (picks) out.scorecards[k] = Object.fromEntries(Object.entries(picks).filter((e): e is [string, string] => typeof e[1] === 'string'));
    }
  }
  // A document from before the charts list has no `charts` array: the defaults stand in.
  if (Array.isArray(d.charts)) {
    const seen = new Set<string>();
    out.charts = d.charts.map(cleanSpec).filter((c): c is ChartSpec => !!c && !seen.has(c.id) && !!seen.add(c.id));
  }
  return out;
}

export function createChartSettings(ctx: Ctx): ChartSettingsStore {
  const col = ctx.collections<ChartSettings>(CHARTS_COLLECTION);
  return {
    async load(martId) {
      try {
        return clean((await col.get(martId))?.document);
      } catch (e) {
        console.warn('Reading the chart settings failed', e);
        return {};
      }
    },
    save(martId, s) {
      return Promise.resolve()
        .then(async () => { await col.put(martId, s); })
        .catch((e) => console.warn('Saving the chart settings failed', e));
    },
  };
}
