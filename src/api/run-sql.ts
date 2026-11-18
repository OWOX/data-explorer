import type { Ctx } from '../sdk/types';
import { isNotFound } from './exports';

/** The SQL a grid query ran, or why it is not available. */
export type RunSql = { sql: string } | { reason: string };
type RunDto = { additionalParams?: { httpData?: { executionSqlQuery?: unknown } } | null } | null;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The compiled SQL of a grid query, from its run. OWOX saves the run when the query ends, so a 404 is asked again,
 * `retries` times (default 3), `waitMs` apart (default 1000). It only reads: no query runs and nothing is written.
 */
export async function readRunSql(ctx: Ctx, martId: string, runId: string, o: { retries?: number; waitMs?: number } = {}): Promise<RunSql> {
  const retries = o.retries ?? 3;
  const waitMs = o.waitMs ?? 1000;
  for (let attempt = 0; ; attempt++) {
    try {
      const run = await ctx.owox.getJson<RunDto>(`/api/data-marts/${encodeURIComponent(martId)}/runs/${encodeURIComponent(runId)}`);
      const sql = run?.additionalParams?.httpData?.executionSqlQuery;
      return typeof sql === 'string' && sql.trim() ? { sql } : { reason: 'OWOX did not record the SQL of this query' };
    } catch (e) {
      if (isNotFound(e) && attempt < retries) { await pause(waitMs); continue; }
      return { reason: 'The SQL could not be read from OWOX' };
    }
  }
}
