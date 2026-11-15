import type { Ctx, ContextDto, ModelCanvasPageDto } from '../sdk/types';
import type { Edge, Mart, Model } from '../model/types';

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

export async function loadModel(ctx: Ctx): Promise<Model> {
  const [storages, list, contexts] = await Promise.all([
    ctx.owox.storages.list(),
    ctx.owox.dataMarts.list(),
    ctx.owox.getJson<ContextDto[]>('/api/contexts'),
  ]);
  const listed = new Map(list.map((m) => [m.id, m]));
  const marts = new Map<string, Mart>();
  const rawEdges = (
    await Promise.all(
      storages.map(async (s) => {
        const [nodes, edges] = await Promise.all([canvasNodes(ctx, s.id), ctx.owox.models.getEdges(s.id)]);
        for (const n of nodes) {
          const item = listed.get(n.id);
          marts.set(n.id, {
            id: n.id,
            title: n.title,
            description: n.description,
            icon: n.icon ?? null,
            storageId: s.id,
            contextIds: item?.contexts.map((c) => c.id) ?? [],
            dataLastUpdatedAt: n.dataLastUpdated?.dataLastUpdatedAt ?? null,
            accessible: item !== undefined,
          });
        }
        return edges;
      }),
    )
  ).flat();

  const edges: Edge[] = rawEdges
    .filter((e) => marts.has(e.sourceDataMartId) && marts.has(e.targetDataMartId))
    .map((e) => ({
      id: e.id,
      source: e.sourceDataMartId,
      target: e.targetDataMartId,
      joins: e.joinConditions.map((j) => ({ sourceField: j.sourceFieldName, targetField: j.targetFieldName })),
    }));

  return { marts, edges, contexts: contexts.map((c) => ({ id: c.id, name: c.name, icon: c.icon ?? null })) };
}
