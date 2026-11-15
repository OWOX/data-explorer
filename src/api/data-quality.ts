import type { DqSummary } from '../model/types';
import type { Ctx, DqSummariesResponseDto } from '../sdk/types';

export async function loadDqSummaries(ctx: Ctx, ids: string[]): Promise<Map<string, DqSummary>> {
  if (ids.length === 0) return new Map();
  const res = await ctx.owox.postJson<DqSummariesResponseDto>('/api/data-marts/data-quality/summaries', { dataMartIds: ids });
  return new Map(res.items.map((i) => [i.dataMartId, i.summary]));
}
