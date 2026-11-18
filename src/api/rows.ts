import type { Ctx, Row, TraverseOptions } from '../sdk/types';

export interface ReadRowsHooks {
  signal?: AbortSignal;
  onChunk?: (rowsSoFar: Row[]) => void;
  onRunId?: (runId: string | undefined) => void;
}

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

export async function readRows(ctx: Ctx, martId: string, options: TraverseOptions, hooks: ReadRowsHooks = {}): Promise<Row[]> {
  if (hooks.signal?.aborted) throw abortError();
  const traversal = await ctx.owox.dataMarts.traverseData(martId, options);
  hooks.onRunId?.(traversal.runId);
  const rows: Row[] = [];
  try {
    for await (const chunk of traversal.rowChunks()) {
      rows.push(...chunk);
      hooks.onChunk?.(rows);
      if (hooks.signal?.aborted) {
        await traversal.cancel();
        throw abortError();
      }
    }
  } catch (e) {
    if (!(e instanceof DOMException)) await traversal.cancel().catch(() => undefined);
    throw e;
  }
  return rows;
}
