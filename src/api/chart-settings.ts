import { isRecord } from '../model/guards';
import { isDateBucket } from '../model/aggregation';
import { isChartKind, type ChartSettings, type ChartSpec } from '../charts/settings';
import type { Ctx } from '../sdk/types';

export const CHARTS_COLLECTION = 'charts';

export interface ChartSettingsStore {
  /** The member's saved chart choices for a main mart; empty when there are none or the read failed. */
  load(martId: string): Promise<ChartSettings>;
  /** One write per call; a failure is logged and changes nothing on screen. */
  save(martId: string, s: ChartSettings): void;
}

const obj = (v: unknown): Record<string, unknown> | null => (isRecord(v) ? v : null);

function cleanSpec(v: unknown): ChartSpec | null {
  const o = obj(v);
  if (!o || typeof o.id !== 'string' || !isChartKind(o.kind)) return null;
  const out: ChartSpec = { id: o.id, kind: o.kind };
  if (typeof o.hidden === 'boolean') out.hidden = o.hidden;
  for (const k of ['measure', 'date', 'dimension', 'dimension2'] as const) if (typeof o[k] === 'string') out[k] = o[k] as string;
  for (const k of ['measure2', 'stack'] as const) if (o[k] === null || typeof o[k] === 'string') out[k] = o[k] as string | null;
  if (o.bucket === 'AUTO' || isDateBucket(o.bucket)) out.bucket = o.bucket as ChartSpec['bucket'];
  if (o.orientation === 'vertical' || o.orientation === 'horizontal') out.orientation = o.orientation;
  if (typeof o.area === 'boolean') out.area = o.area;
  if (typeof o.blanks === 'boolean') out.blanks = o.blanks;
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
  }
  // Charts are read from a version 2 doc only: a v1 doc's fixed panels are dropped, the defaults stand in.
  if (d.version === 2 && Array.isArray(d.charts)) {
    const seen = new Set<string>();
    out.version = 2;
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
      Promise.resolve()
        .then(() => col.put(martId, s))
        .catch((e) => console.warn('Saving the chart settings failed', e));
    },
  };
}
