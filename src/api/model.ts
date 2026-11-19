import type { Ctx, ConnectorDto, ConnectorSummaryDto, ContextDto, ModelCanvasPageDto } from '../sdk/types';
import type { Edge, Mart, Model } from '../model/types';
import { cleanSummary, groupSources, sourceKeyFor } from '../model/sources';
import { runPool } from './pool';

const STORAGE_CONCURRENCY = 6;

async function canvasNodes(ctx: Ctx, storageId: string) {
  const items: ModelCanvasPageDto['items'] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const query: Record<string, string> = { storageId };
    if (offset > 0) query.offset = String(offset);
    const page: ModelCanvasPageDto = await ctx.owox.getJson<ModelCanvasPageDto>('/api/model-canvas/data-marts', query);
    items.push(...page.items);
    offset = page.nextOffset;
  }
  return items;
}

/**
 * The bundled connectors, then the custom ones the marts use that the bundled list lacks.
 * Both are decoration: a refused read costs the titles and logos, never the page.
 */
async function readConnectors(ctx: Ctx, listed: Promise<{ definitionType?: string | null; connectorSourceName?: string | null }[]>): Promise<{ bundled: ConnectorDto[]; custom: ConnectorSummaryDto[] }> {
  let bundled: ConnectorDto[];
  try {
    const read = await ctx.owox.getJson<ConnectorDto[]>('/api/connectors');
    // isArray guards a malformed connectors response.
    if (!Array.isArray(read)) return { bundled: [], custom: [] };
    bundled = read;
  } catch {
    // Without the bundled list a bundled name cannot be told from a custom one, so none is asked.
    return { bundled: [], custom: [] };
  }
  try {
    const have = new Set(bundled.map((c) => c.name));
    const names = [...new Set((await listed).filter((m) => m.definitionType === 'CONNECTOR').map((m) => m.connectorSourceName))]
      .filter((n): n is string => !!n && !have.has(n));
    if (names.length === 0) return { bundled, custom: [] };
    const rows = await ctx.owox.getJson<unknown>('/api/connectors/custom/summaries', { names: names.join(',') });
    return { bundled, custom: Array.isArray(rows) ? rows.flatMap(cleanSummary) : [] };
  } catch {
    // Its own fallback: a missing or refused endpoint costs the custom detail, not the bundled list.
    return { bundled, custom: [] };
  }
}

export type LoadProgress = { done: number; total: number };

/** The reads before the storages are known: the storages, the marts, the contexts and the connectors. */
export const FIRST_STEPS = 4;

/** `onProgress` hears every finished read. Each storage adds two more once the storages are known: its canvas and its edges. */
export async function loadModel(ctx: Ctx, onProgress?: (p: LoadProgress) => void): Promise<Model> {
  let done = 0;
  let total = FIRST_STEPS;
  const step = <T,>(value: T): T => { done += 1; onProgress?.({ done, total }); return value; };
  const listP = ctx.owox.dataMarts.list();
  const [storages, list, contexts, { bundled, custom }] = await Promise.all([
    ctx.owox.storages.list().then((s) => { total += s.length * 2; return step(s); }),
    listP.then(step),
    ctx.owox.getJson<ContextDto[]>('/api/contexts').then(step),
    // Connector titles and logos are decoration: a failure falls back to the raw keys.
    readConnectors(ctx, listP).then(step),
  ]);
  const listed = new Map(list.map((m) => [m.id, m]));
  const marts = new Map<string, Mart>();
  const results = await runPool(storages, STORAGE_CONCURRENCY, async (s) => {
    // A storage that fails still counts as read: the bar must be able to fill.
    const [nodes, edges] = await Promise.all([canvasNodes(ctx, s.id).then(step, (e) => { step(null); throw e; }), ctx.owox.models.getEdges(s.id).then(step, (e) => { step(null); throw e; })]);
    for (const n of nodes) {
      const item = listed.get(n.id);
      const connectorName = item?.definitionType === 'CONNECTOR' ? item.connectorSourceName || undefined : undefined;
      marts.set(n.id, {
        id: n.id,
        title: n.title,
        description: n.description,
        icon: n.icon ?? null,
        storageId: s.id,
        contextIds: item?.contexts.map((c) => c.id) ?? [],
        dataLastUpdatedAt: n.dataLastUpdated?.dataLastUpdatedAt ?? null,
        // availableForReporting is the mart's sharing flag, not the member's permission, so it is not checked.
        accessible: item !== undefined && n.status === 'PUBLISHED',
        sourceKey: connectorName ? sourceKeyFor(connectorName, bundled, custom) : null,
        ...(connectorName ? { connectorName } : {}),
      });
    }
    return edges;
  });
  const failedStorages: Model['failedStorages'] = [];
  const rawEdges = results.flatMap((r, i) => {
    if (!(r instanceof Error)) return r;
    failedStorages.push({ id: storages[i]!.id, title: storages[i]!.title, message: r.message });
    return [];
  });
  // One bad storage must not blank the whole canvas: fail only when nothing loaded.
  if (storages.length > 0 && failedStorages.length === storages.length) throw results.find((r): r is Error => r instanceof Error)!;

  const edges: Edge[] = rawEdges
    .filter((e) => marts.has(e.sourceDataMartId) && marts.has(e.targetDataMartId))
    .map((e) => ({
      id: e.id,
      source: e.sourceDataMartId,
      target: e.targetDataMartId,
      joins: e.joinConditions.map((j) => ({ sourceField: j.sourceFieldName, targetField: j.targetFieldName })),
    }));

  const sources = groupSources(marts.values(), bundled, custom);
  return { marts, sources, edges, contexts: contexts.map((c) => ({ id: c.id, name: c.name, icon: c.icon ?? null })), storages: storages.map((s) => ({ id: s.id, title: s.title, type: s.type })), failedStorages };
}
