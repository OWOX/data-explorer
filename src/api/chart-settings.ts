import { isRecord } from '../model/guards';
import { isDateBucket } from '../model/aggregation';
import type { ChartSettings } from '../charts/settings';
import type { Ctx } from '../sdk/types';

export const CHARTS_COLLECTION = 'charts';

export interface ChartSettingsStore {
  /** The member's saved chart choices for a main mart; empty when there are none or the read failed. */
  load(martId: string): Promise<ChartSettings>;
  /** One write per call; a failure is logged and changes nothing on screen. */
  save(martId: string, s: ChartSettings): void;
}

const obj = (v: unknown): Record<string, unknown> | null => (isRecord(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

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
  const ts = obj(d.timeSeries);
  if (ts) {
    out.timeSeries = {};
    if (str(ts.date) !== undefined) out.timeSeries.date = ts.date as string;
    if (ts.bucket === 'AUTO' || isDateBucket(ts.bucket)) out.timeSeries.bucket = ts.bucket as 'AUTO';
    if (str(ts.metric) !== undefined) out.timeSeries.metric = ts.metric as string;
    if (ts.stack === null || str(ts.stack) !== undefined) out.timeSeries.stack = ts.stack as string | null;
    if (ts.orientation === 'vertical' || ts.orientation === 'horizontal') out.timeSeries.orientation = ts.orientation;
  }
  const pie = obj(d.pie);
  if (pie) {
    out.pie = {};
    if (str(pie.metric) !== undefined) out.pie.metric = pie.metric as string;
    if (str(pie.dimension) !== undefined) out.pie.dimension = pie.dimension as string;
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
