import { describe, expect, test, vi } from 'vitest';
import { stubCtx } from '../api/test-ctx';
import type { Field, Mart, Model, Schema } from '../model/types';
import type { AiModel, Ctx } from '../sdk/types';
import type { SearchHits } from './endpoint';
import { buildAdhocView, findAdhocMart } from './run';

const mart = (id: string, title = id, accessible = true): Mart => ({ id, title, description: `${title} data`, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible, sourceKey: null });
const model: Model = { marts: new Map(['orders', 'customers', 'products', 'stores', 'hits', 'secret'].map((id) => [id, mart(id, id, id !== 'secret')])), sources: [], edges: [], contexts: [], storages: [], failedStorages: [] };
const f = (name: string, category: Field['category'], type = 'STRING'): Field => ({ name, alias: null, type, category, description: null, isPrimaryKey: false });
const schema: Schema = [f('id', 'number', 'INT64'), f('status', 'string'), f('amount', 'number', 'NUMERIC'), f('created_at', 'date', 'TIMESTAMP')];
const schemas = { get: vi.fn(async () => schema) };

function setup(opts: { answers?: (task: string, doc: Record<string, unknown>) => unknown; ai?: boolean }) {
  const calls: Record<string, unknown>[] = [];
  const doGenerate = vi.fn(async (o: Parameters<AiModel['doGenerate']>[0]) => {
    const user = o.prompt[1] as { content: { text: string }[] };
    const doc = JSON.parse(user.content[0]!.text) as { task: string };
    calls.push(doc);
    const answer = opts.answers?.(doc.task, doc);
    if (answer instanceof Error) throw answer;
    return { content: [{ type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer ?? {}) }] };
  });
  const ai: AiModel = { doGenerate };
  const base = stubCtx({});
  const ctx: Ctx = { ...base, ...(opts.ai === false ? {} : { credentials: { ai: { ...ai, fast: ai, reasoning: ai } } }) };
  return { ctx, calls, doGenerate, deps: { ctx, model, schemas, signal: new AbortController().signal } };
}
const tasks = (t: { calls: Record<string, unknown>[] }) => t.calls.map((c) => c.task);
const hits = (marts: string[], reports: SearchHits['reports'] = []): SearchHits => ({ marts, reports });
const report = (id: string, martId: string) => ({ id, title: `Report ${id}`, martId });

describe('findAdhocMart', () => {
  test('no AI: the first mart hit, else the first report\'s mart, else null; the model is never called', async () => {
    const t = setup({ ai: false });
    expect(await findAdhocMart(t.deps, 'q', hits(['orders', 'customers']))).toEqual({ martId: 'orders', ai: 'none' });
    expect(await findAdhocMart(t.deps, 'q', hits([], [report('r1', 'stores')]))).toEqual({ martId: 'stores', ai: 'none' });
    expect(await findAdhocMart(t.deps, 'q', hits([]))).toEqual({ martId: null, ai: 'none' });
    expect(t.doGenerate).not.toHaveBeenCalled();
  });

  test('with AI, the first accessible id the model names wins; the call is discover with the search hits', async () => {
    const t = setup({ answers: () => ({ ids: ['nope', 'secret', 'products', 'orders'] }) });
    const out = await findAdhocMart(t.deps, 'what sells', hits(['orders'], [report('r1', 'stores'), report('r2', 'orders')]));
    expect(out).toEqual({ martId: 'products', ai: 'used' });
    expect(tasks(t)).toEqual(['discover']);
    // marts first, then the reports' marts, no repeats
    expect(t.calls[0]!.searchHits).toEqual([{ id: 'orders', title: 'orders' }, { id: 'stores', title: 'stores' }]);
  });

  test('without any hit there is no searchHits key', async () => {
    const t = setup({ answers: () => ({ ids: ['orders'] }) });
    await findAdhocMart(t.deps, 'q', hits([]));
    expect(t.calls[0]).not.toHaveProperty('searchHits');
  });

  test('a model naming nothing valid falls back, marked used; a failing model falls back, marked unavailable', async () => {
    const nothing = setup({ answers: () => ({ ids: ['nope', 'secret'] }) });
    expect(await findAdhocMart(nothing.deps, 'q', hits(['customers']))).toEqual({ martId: 'customers', ai: 'used' });
    const down = setup({ answers: () => new Error('quota') });
    expect(await findAdhocMart(down.deps, 'q', hits([], [report('r', 'stores')]))).toEqual({ martId: 'stores', ai: 'unavailable' });
    const junk = setup({ answers: () => 'I am sorry' });
    expect((await findAdhocMart(junk.deps, 'q', hits(['orders']))).ai).toBe('unavailable');
  });

  test('an aborted signal rejects nothing and returns the fallback without calling the model', async () => {
    const t = setup({ answers: () => ({ ids: ['products'] }) });
    const ctl = new AbortController();
    ctl.abort();
    expect(await findAdhocMart({ ...t.deps, signal: ctl.signal }, 'q', hits(['orders']))).toEqual({ martId: 'orders', ai: 'unavailable' });
    expect(t.doGenerate).not.toHaveBeenCalled();
  });

  test('a newer query aborts an older call 1: it returns the fallback without using its model answer', async () => {
    let release: (() => void) | undefined;
    const t = setup({ answers: () => ({ ids: ['products'] }) });
    const inner = t.ctx.credentials!.ai!.fast!.doGenerate;
    t.ctx.credentials!.ai!.fast!.doGenerate = (o) => new Promise((resolve, reject) => {
      o.abortSignal?.addEventListener('abort', () => reject(new Error('aborted')));
      release = () => void inner(o).then(resolve, reject);
    });
    const first = new AbortController();
    const older = findAdhocMart({ ...t.deps, signal: first.signal }, 'old', hits(['orders']));
    const newer = new AbortController();
    const newest = findAdhocMart({ ...t.deps, signal: newer.signal }, 'new', hits(['customers']));
    await vi.waitFor(() => expect(release).toBeDefined());
    first.abort();
    expect(await older).toEqual({ martId: 'orders', ai: 'unavailable' });
    release!();
    expect(await newest).toEqual({ martId: 'products', ai: 'used' });
  });

  test('a model that never answers is unavailable after the timeout', async () => {
    const t = setup({});
    t.ctx.credentials!.ai!.fast!.doGenerate = () => new Promise(() => {});
    expect(await findAdhocMart({ ...t.deps, timeoutMs: 40 }, 'q', hits(['orders']))).toEqual({ martId: 'orders', ai: 'unavailable' });
  });
});

describe('buildAdhocView', () => {
  const answers = (task: string) => (task === 'fields'
    ? { columns: ['status', 'amount'], aggregations: [{ column: 'amount', function: 'SUM' }] }
    : { filters: [{ field: 'status', op: 'eq', value: 'paid' }], sorts: [{ field: 'amount', direction: 'desc' }, { field: 'id', direction: 'asc' }] });

  test('asks fields, then filters with the columns fields chose, and merges both', async () => {
    const t = setup({ answers });
    const out = await buildAdhocView(t.deps, 'paid orders', 'orders');
    expect(tasks(t)).toEqual(['fields', 'filters']);
    expect(t.calls[1]!.columns).toEqual(['status', 'amount']);
    expect(out.ai).toBe('used');
    expect(out.grid?.columns).toEqual(['status', 'amount']);
    expect(out.grid?.aggregations).toEqual([{ column: 'amount', function: 'SUM' }]);
    expect(out.grid?.filters.status).toEqual({ field: 'status', op: 'eq', value: 'paid' });
    // id is not a chosen column, so its sort is dropped
    expect(out.grid?.sorts).toEqual([{ field: 'amount', direction: 'desc' }]);
  });

  test('bad fields in the answers are dropped, the rest applies', async () => {
    const t = setup({ answers: (task) => (task === 'fields' ? { columns: ['status', 'ghost'] } : { filters: [{ field: 'ghost', op: 'eq', value: 1 }, { field: 'created_at', op: 'relative', value: { kind: 'last_month' } }] }) });
    const out = await buildAdhocView(t.deps, 'orders last month', 'orders');
    expect(out.grid?.columns).toEqual(['status']);
    expect(Object.keys(out.grid!.filters)).toEqual(['created_at']);
  });

  test('no AI: no grid, no call', async () => {
    const t = setup({ ai: false });
    expect(await buildAdhocView(t.deps, 'q', 'orders')).toEqual({ grid: null, ai: 'none' });
    expect(t.doGenerate).not.toHaveBeenCalled();
  });

  test('a failing fields call is unavailable with no grid, and filters is not asked', async () => {
    const t = setup({ answers: () => new Error('quota') });
    expect(await buildAdhocView(t.deps, 'q', 'orders')).toEqual({ grid: null, ai: 'unavailable' });
    expect(tasks(t)).toEqual(['fields']);
  });

  test('a failing filters call is unavailable with no grid, like a failing fields call', async () => {
    const t = setup({ answers: (task) => (task === 'fields' ? { columns: ['status'] } : new Error('quota')) });
    const out = await buildAdhocView(t.deps, 'q', 'orders');
    expect(out).toEqual({ grid: null, ai: 'unavailable' });
  });

  test('an empty schema gives no grid and no call; a schema that cannot be read leaves the mart as it is', async () => {
    const t = setup({ answers });
    expect(await buildAdhocView({ ...t.deps, schemas: { get: vi.fn(async () => []) } }, 'q', 'orders')).toEqual({ grid: null, ai: 'used' });
    expect(await buildAdhocView({ ...t.deps, schemas: { get: vi.fn(async () => { throw new Error('boom'); }) } }, 'q', 'orders')).toEqual({ grid: null, ai: 'used' });
    expect(t.doGenerate).not.toHaveBeenCalled();
  });

  test('building a view never reads rows', async () => {
    const t = setup({ answers });
    await buildAdhocView(t.deps, 'q', 'orders');
    expect(vi.mocked(t.ctx.owox.dataMarts.traverseData)).not.toHaveBeenCalled();
  });
});
