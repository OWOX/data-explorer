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
export function cleanChartSettings(doc: unknown): ChartSettings {
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
      if (picks) out.scorecards[k] = Object.fromEntries(Object.entries(picks).filter((e): e is [string, string] => typeof e[1] === 'string' && !(e[0] in Object.prototype)));
    }
  }
  // A document from before the charts list has no `charts` array: the defaults stand in.
  if (Array.isArray(d.charts)) {
    const seen = new Set<string>();
    out.charts = d.charts.map(cleanSpec).filter((c): c is ChartSpec => !!c && !seen.has(c.id) && !!seen.add(c.id));
  }
  return out;
}

/** How long a load waits for this tab's saves of the mart before it reads anyway. */
const SAVE_WAIT_MS = 5000;
type Slot = { running: Promise<void>; /** At most one more put per mart: later saves replace its doc. */ queued?: { doc: ChartSettings; done: Promise<void>; finish: () => void } };

export function createChartSettings(ctx: Ctx): ChartSettingsStore {
  const col = ctx.collections<ChartSettings>(CHARTS_COLLECTION);
  // Per mart, the put in flight and the one queued behind it: a load waits for them, so it never reads a doc older than a save this tab already made.
  const slots = new Map<string, Slot>();
  const put = (martId: string, s: ChartSettings): Promise<void> => {
    const run: Promise<void> = Promise.resolve()
      .then(async () => { await col.put(martId, s); })
      .catch((e) => console.warn('Saving the chart settings failed', e))
      .then(() => {
        const slot = slots.get(martId);
        const q = slot?.queued;
        if (!slot || slot.running !== run) return;
        if (!q) { slots.delete(martId); return; }
        slot.queued = undefined;
        slot.running = put(martId, q.doc);
        void slot.running.then(q.finish);
      });
    return run;
  };
  return {
    async load(martId) {
      const slot = slots.get(martId);
      const wait = slot && (slot.queued?.done ?? slot.running);
      if (wait) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([wait, new Promise<void>((r) => { timer = setTimeout(r, SAVE_WAIT_MS); })]);
        clearTimeout(timer);
      }
      try {
        return cleanChartSettings((await col.get(martId))?.document);
      } catch (e) {
        console.warn('Reading the chart settings failed', e);
        return {};
      }
    },
    save(martId, s) {
      const slot = slots.get(martId);
      if (!slot) {
        const running = put(martId, s);
        slots.set(martId, { running });
        return running;
      }
      if (slot.queued) { slot.queued.doc = s; return slot.queued.done; }
      let finish!: () => void;
      const done = new Promise<void>((r) => { finish = r; });
      slot.queued = { doc: s, done, finish };
      return done;
    },
  };
}
