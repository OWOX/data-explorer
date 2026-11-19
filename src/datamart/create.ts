import { martAppUrl } from '../config';
import type { Ctx } from '../sdk/types';

/** The REST steps that create a SQL data mart, in order. */
export type CreateStage = 'create' | 'define' | 'schema' | 'publish' | 'share';

/** What the dialog shows while each stage runs. */
export const CREATE_STAGE_LABEL: Record<CreateStage, string> = {
  create: 'Creating the data mart…',
  define: 'Saving its SQL…',
  schema: 'Reading its columns…',
  publish: 'Publishing…',
  share: 'Making it available for reporting…',
};

/** A failed step. After `create`, `martId` points at the draft left in OWOX. */
export class CreateMartError extends Error {
  constructor(message: string, readonly stage: CreateStage, readonly martId?: string) { super(message); }
}

export type CreateMartRequest = { title: string; storageId: string; sql: string; /** Resume a mart an earlier attempt created: skips 'create'. */ martId?: string; /** Resume from this stage (with martId). */ from?: CreateStage; signal?: AbortSignal };

const ORDER: CreateStage[] = ['create', 'define', 'schema', 'publish', 'share'];
const SCHEMA_TIMEOUT = 'OWOX is still reading the columns. Open the data mart to publish it.';
const SCHEMA_UNREADABLE = 'OWOX could not read the columns of this SQL. Open the draft to see why.';

/** The server's message when the error carries one, else the error's own. */
function messageOf(e: unknown): string {
  const x = e as { payload?: { message?: unknown }; message?: unknown } | null;
  const m = x?.payload?.message ?? x?.message;
  return typeof m === 'string' && m ? m : Array.isArray(m) ? m.join(', ') : String(e);
}

/** A reason worth showing: not empty, not a bare transport failure, not Nest's generic "Bad Request Exception". */
const usable = (m: unknown): m is string => typeof m === 'string' && !!m.trim() && !/^Request failed with/i.test(m.trim()) && !/^[A-Z][A-Za-z ]* Exception$/.test(m.trim());

/** Whether publish failed only because the mart is already published (an earlier attempt got that far). */
function alreadyPublished(e: unknown): boolean {
  const x = e as { payload?: { apiCode?: unknown } } | null;
  return x?.payload?.apiCode === 'DATA_MART_ALREADY_PUBLISHED' || /already published/i.test(messageOf(e));
}

/** Resolves after `ms`, or early (rejecting) when the signal aborts. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));
    const onAbort = () => { clearTimeout(t); reject(new Error('Cancelled')); };
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Runs the REST steps in order; onStage is called as each starts. Resolves with the new mart's id and its OWOX link. */
export async function createDataMart(ctx: Ctx, req: CreateMartRequest, onStage?: (s: CreateStage) => void, o: { pollMs?: number; timeoutMs?: number } = {}): Promise<{ id: string; url: string }> {
  const pollMs = o.pollMs ?? 1000;
  const timeoutMs = o.timeoutMs ?? 60_000;
  const { owox } = ctx;
  let id = req.martId;
  const start = req.martId ? ORDER.indexOf(req.from ?? 'define') : 0;
  const step = async <T,>(stage: CreateStage, run: () => Promise<T>): Promise<T> => {
    onStage?.(stage);
    try { return await run(); } catch (e) {
      if (e instanceof CreateMartError) throw e;
      throw new CreateMartError(messageOf(e), stage, id);
    }
  };

  if (start <= 0) {
    id = await step('create', async () => (await owox.postJson<{ id: string }>('/api/data-marts', { title: req.title, storageId: req.storageId })).id);
  }
  const base = `/api/data-marts/${encodeURIComponent(id!)}`;
  if (start <= 1) await step('define', () => owox.putJson(`${base}/definition`, { definitionType: 'SQL', definition: { sqlQuery: req.sql } }));
  if (start <= 2) {
    await step('schema', async () => {
      const { triggerId } = await owox.postJson<{ triggerId: string }>(`${base}/schema-actualize-triggers`, {});
      const trigger = `${base}/schema-actualize-triggers/${encodeURIComponent(triggerId)}`;
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const { status } = await owox.getJson<{ status: string }>(`${trigger}/status`);
        if (status === 'SUCCESS') break;
        if (status === 'ERROR') {
          // The backend records why on the trigger itself.
          let reason: string | undefined;
          try { const r = await owox.getJson<{ success?: boolean; error?: string }>(trigger); if (usable(r?.error)) reason = r.error; } catch (e) { const m = messageOf(e); if (usable(m)) reason = m; }
          throw new CreateMartError(reason ?? SCHEMA_UNREADABLE, 'schema', id);
        }
        if (!['IDLE', 'READY', 'PROCESSING'].includes(status)) throw new CreateMartError(`Reading the columns ended with status ${status}.`, 'schema', id);
        if (Date.now() >= deadline) throw new CreateMartError(SCHEMA_TIMEOUT, 'schema', id);
        await wait(pollMs, req.signal);
      }
      const r = await owox.getJson<{ success: boolean; error?: string }>(trigger);
      if (!r.success) throw new CreateMartError(r.error || 'OWOX could not read the columns.', 'schema', id);
    });
  }
  if (start <= 3) await step('publish', () => owox.putJson(`${base}/publish`, {}).catch((e) => { if (!alreadyPublished(e)) throw e; }));
  await step('share', () => owox.putJson(`${base}/availability`, { availableForReporting: true, availableForMaintenance: false }));
  return { id: id!, url: martAppUrl(ctx.projectId, id!) };
}
