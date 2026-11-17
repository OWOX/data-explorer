import { describe, expect, test, vi } from 'vitest';
import { stubCtx } from '../api/test-ctx';
import type { Field, Mart, Model, Schema } from '../model/types';
import type { AiModel, Ctx } from '../sdk/types';
import { smartSearch } from './run';

const mart = (id: string, title = id, accessible = true): Mart => ({ id, title, description: `${title} data`, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible, sourceKey: null });
const model: Model = { marts: new Map(['orders', 'customers', 'products', 'stores', 'hits', 'secret'].map((id) => [id, mart(id, id, id !== 'secret')])), sources: [], edges: [], contexts: [], storages: [], failedStorages: [] };
const f = (name: string, category: Field['category'], type = 'STRING'): Field => ({ name, alias: null, type, category, description: null, isPrimaryKey: false });
const schema: Schema = [f('id', 'number', 'INT64'), f('status', 'string'), f('amount', 'number', 'NUMERIC'), f('created_at', 'date', 'TIMESTAMP')];
const schemas = { get: vi.fn(async () => schema) };

const hit = (entityId: string, finalScore: number) => ({ entityType: 'DATA_MART', entityId, title: entityId, description: null, finalScore });
function setup(opts: { search?: unknown; answers?: (task: string, doc: Record<string, unknown>) => unknown; ai?: boolean }) {
  const calls: { task: string }[] = [];
  const doGenerate = vi.fn(async (o: Parameters<AiModel['doGenerate']>[0]) => {
    const user = o.prompt[1] as { content: { text: string }[] };
    const doc = JSON.parse(user.content[0]!.text) as { task: string };
    calls.push(doc);
    const answer = opts.answers?.(doc.task, doc);
    if (answer instanceof Error) throw answer;
    return { content: [{ type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer ?? {}) }] };
  });
  const ai: AiModel = { doGenerate };
  const base = stubCtx({ getJson: vi.fn(async () => { if (opts.search instanceof Error) throw opts.search; return opts.search ?? []; }) });
  const ctx: Ctx = { ...base, ...(opts.ai === false ? {} : { credentials: { ai: { ...ai, fast: ai, reasoning: ai } } }) };
  return { ctx, calls, doGenerate, deps: { ctx, model, schemas, signal: new AbortController().signal } };
}

describe('smartSearch', () => {
  test('endpoint results rank by score, five at most, then the model sets up the best mart', async () => {
    const t = setup({
      search: [hit('products', 5), hit('orders', 90), hit('customers', 40), hit('stores', 30), hit('hits', 20), hit('secret', 99), hit('extra', 1)],
      answers: (task) => (task === 'view' ? { columns: ['status', 'amount'], filters: [{ field: 'status', op: 'eq', value: 'paid' }], sorts: [{ field: 'amount', direction: 'desc' }] } : {}),
    });
    const out = await smartSearch(t.deps, 'paid orders');
    expect(out.ids).toEqual(['orders', 'customers', 'stores', 'hits', 'products']);
    expect(out.ai).toBe('used');
    expect(out.grid?.filters.status).toEqual({ field: 'status', op: 'eq', value: 'paid' });
    expect(out.grid?.sorts).toEqual([{ field: 'amount', direction: 'desc' }]);
    // the endpoint found marts, so the model was asked only for the view, of the best one
    expect(t.calls.map((c) => c.task)).toEqual(['view']);
    expect((t.calls[0] as unknown as { dataMart: { id: string } }).dataMart.id).toBe('orders');
    expect(vi.mocked(t.ctx.owox.getJson)).toHaveBeenCalledWith('/api/search', { q: 'paid orders', entityTypes: 'DATA_MART', excludeDrafts: 'true', limit: '5' });
  });

  test('an empty endpoint goes to AI discovery; its ids are checked against the model and capped; then the view', async () => {
    const t = setup({
      search: [],
      answers: (task) => (task === 'discover' ? { ids: ['customers', 'nope', 'secret', 'customers', 'orders', 'products', 'stores', 'hits', 'orders'] } : { columns: ['status'] }),
    });
    const out = await smartSearch(t.deps, 'who buys');
    expect(out.ids).toEqual(['customers', 'orders', 'products', 'stores', 'hits']);
    expect(t.calls.map((c) => c.task)).toEqual(['discover', 'view']);
    expect(out.grid?.columns).toEqual(['status']);
  });

  test('a failing endpoint is the same as an empty one', async () => {
    const t = setup({ search: new Error('500'), answers: (task) => (task === 'discover' ? { ids: ['orders'] } : {}) });
    expect((await smartSearch(t.deps, 'orders')).ids).toEqual(['orders']);
  });

  test('bad fields in the model view are dropped, the rest applies', async () => {
    const t = setup({ search: [hit('orders', 1)], answers: () => ({ columns: ['status', 'ghost'], filters: [{ field: 'ghost', op: 'eq', value: 1 }, { field: 'created_at', op: 'relative', value: { kind: 'last_month' } }], sorts: [{ field: 'ghost', direction: 'asc' }] }) });
    const out = await smartSearch(t.deps, 'orders last month');
    expect(out.grid?.columns).toEqual(['status']);
    expect(Object.keys(out.grid!.filters)).toEqual(['created_at']);
    expect(out.grid?.sorts).toBeNull();
  });

  test('no AI configured: the endpoint result alone, no error, nothing asked', async () => {
    const t = setup({ search: [hit('orders', 1)], ai: false });
    expect(await smartSearch(t.deps, 'orders')).toEqual({ ids: ['orders'], grid: null, ai: 'none' });
    const empty = setup({ search: [], ai: false });
    expect(await smartSearch(empty.deps, 'orders')).toEqual({ ids: [], grid: null, ai: 'none' });
  });

  test('a model that fails or answers nonsense leaves the endpoint result, marked unavailable', async () => {
    const down = setup({ search: [hit('orders', 1)], answers: () => new Error('quota') });
    expect(await smartSearch(down.deps, 'orders')).toEqual({ ids: ['orders'], grid: null, ai: 'unavailable' });
    const junk = setup({ search: [hit('orders', 1)], answers: () => 'I am sorry, I cannot' });
    expect((await smartSearch(junk.deps, 'orders')).ai).toBe('unavailable');
  });

  test('a model that never answers is unavailable after the timeout, with the endpoint result kept', async () => {
    const t = setup({ search: [hit('orders', 1)] });
    t.ctx.credentials!.ai!.reasoning!.doGenerate = () => new Promise(() => {});
    const out = await smartSearch({ ...t.deps, timeoutMs: 20 }, 'orders');
    expect(out).toEqual({ ids: ['orders'], grid: null, ai: 'unavailable' });
  });

  test('searching never reads rows', async () => {
    const t = setup({ search: [hit('orders', 1)], answers: () => ({ columns: ['status'] }) });
    await smartSearch(t.deps, 'orders');
    expect(vi.mocked(t.ctx.owox.dataMarts.traverseData)).not.toHaveBeenCalled();
  });

  test('a mart whose schema cannot be read is still found, with no view', async () => {
    const t = setup({ search: [hit('orders', 1)] });
    const out = await smartSearch({ ...t.deps, schemas: { get: vi.fn(async () => { throw new Error('boom'); }) } }, 'orders');
    expect(out).toEqual({ ids: ['orders'], grid: null, ai: 'used' });
  });
});
