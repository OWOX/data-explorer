import { describe, expect, it, vi } from 'vitest';
import { runPipeline, type PipelineHost } from './pipeline';
import type { Mart, Model, Schema, Field } from '../model/types';
import type { GridState } from '../state/store';
import type { StepDeps } from './steps/types';

const f = (name: string, category: Field['category']): Field => ({ name, alias: null, type: 'X', category, description: null, isPrimaryKey: name === 'id' });
const schema = Object.assign([f('id', 'string'), f('country', 'string'), f('spend', 'number')], { primaryKey: ['id'] }) as Schema;
const mart = (id: string): Mart => ({ id, title: id, description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null });
const model: Model = { marts: new Map([['users', mart('users')], ['orders', mart('orders')]]), sources: [], edges: [{ id: 'e', source: 'orders', target: 'users', joins: [{ sourceField: 'user_id', targetField: 'id' }] }], contexts: [], storages: [], failedStorages: [] };
const fast = { doGenerate: async () => ({ content: [{ type: 'text', text: '{"subjects":["users"],"breakdowns":["country"]}' }] }) };

/** Answers every question: the first option of a choice, the top level of a score. */
const allYes: StepDeps['decide'] = async (qs) => Object.fromEntries(Object.entries(qs).map(([id, q]) => [id, q.type === 'choice' ? { type: 'choice', choice: Object.keys(q.criteria)[0]! } : { type: 'score', level: 2 }]));

function host() {
  const calls: string[] = [];
  const first: GridState = { columns: ['id'], filters: {}, sorts: null, limit: 200 };
  const h: PipelineHost & { fills: GridState[] } = {
    fills: [],
    open: vi.fn(async (id) => { calls.push(`open:${id}`); return first; }),
    fill: vi.fn((_id, expect, grid) => { calls.push('fill'); h.fills.push(grid); expect; }),
    progress: vi.fn((p) => calls.push(`progress:${p}`)),
    alternatives: vi.fn(),
    chartSettings: { load: vi.fn(async () => ({})), save: vi.fn() },
  };
  return { h, calls, first };
}
const deps = (decide: StepDeps['decide'], signal = new AbortController().signal): StepDeps => ({
  ctx: { owox: { dataMarts: { traverseData: async () => { throw new Error('no data'); } } } } as never,
  fast, decide, signal, schemas: { get: async () => schema }, blendable: { get: async () => [] },
});
const input = { query: 'users by country', hits: { marts: [], reports: [] }, model };

describe('runPipeline', () => {
  it('runs the steps in order and chains each fill on the previous grid', async () => {
    const { h, calls, first } = host();
    const r = await runPipeline(input, deps(allYes), h);
    expect(r.status).toBe('done');
    expect(calls.filter((c) => c.startsWith('progress'))).toEqual(['progress:main', 'progress:path', 'progress:fields', 'progress:filters', 'progress:charts', 'progress:null']);
    expect(calls[calls.indexOf('progress:path') - 1]).toBe('open:users');
    const fill = h.fill as unknown as { mock: { calls: [string, GridState, GridState][] } };
    expect(fill.mock.calls[0]![1]).toBe(first);
    expect(fill.mock.calls[1]![1]).toBe(fill.mock.calls[0]![2]);
    expect(h.chartSettings.save).toHaveBeenCalledOnce();
    expect(h.fills.at(-1)!.view).toBe('charts');
  });
  it('stops at a failed step and keeps what it built', async () => {
    const { h } = host();
    let n = 0;
    const flaky: StepDeps['decide'] = async (qs, s, sig) => { n += 1; if (n === 3) throw new Error('down'); return allYes(qs, s, sig); };
    const r = await runPipeline(input, deps(flaky), h);
    expect(r.status).toBe('failed');
    expect(h.open).toHaveBeenCalledOnce();
    expect(h.chartSettings.save).not.toHaveBeenCalled();
  });
  it('touches nothing after an abort', async () => {
    const { h } = host();
    const ctl = new AbortController();
    const decide: StepDeps['decide'] = async (qs, s, sig) => { ctl.abort(); return allYes(qs, s, sig); };
    const r = await runPipeline(input, deps(decide, ctl.signal), h);
    expect(r.status).toBe('aborted');
    expect(h.open).not.toHaveBeenCalled();
    expect(h.fill).not.toHaveBeenCalled();
  });
  it('skips step 1 when the main mart is given and reuses the intent', async () => {
    const { h, calls } = host();
    const decide = vi.fn(allYes);
    await runPipeline({ ...input, mainId: 'orders', intent: { subjects: [], measures: [], breakdowns: [], time: null, values: [], ranking: null, chartHint: null } }, deps(decide), h);
    expect(calls).not.toContain('progress:main');
    expect(calls).toContain('open:orders');
  });
  it('shows alternatives for an unsure main pick', async () => {
    const { h } = host();
    const unsure: StepDeps['decide'] = async (qs, s, sig) => ('main' in qs ? { main: { type: 'choice', choice: 'users', probabilities: { users: 0.5, orders: 0.45 } } } : allYes(qs, s, sig));
    await runPipeline(input, deps(unsure), h);
    expect(h.alternatives).toHaveBeenCalledWith(['orders']);
  });
  it('reports nothing when no mart can be found', async () => {
    const { h } = host();
    const empty: Model = { ...model, marts: new Map(), edges: [] };
    expect((await runPipeline({ ...input, model: empty }, deps(allYes), h)).status).toBe('nothing');
    expect(h.open).not.toHaveBeenCalled();
  });
  it('opens the main mart and stops when step 1 fails', async () => {
    const { h } = host();
    const down: StepDeps['decide'] = async () => { throw new Error('down'); };
    const r = await runPipeline(input, deps(down), h);
    expect(r.status).toBe('failed');
    expect(h.open).toHaveBeenCalledOnce();
    expect(h.fill).not.toHaveBeenCalled();
  });
  it('does nothing after an abort that lands right after open on a failed step 1', async () => {
    const { h, calls } = host();
    const ctl = new AbortController();
    h.open = vi.fn(async () => { calls.push('open'); ctl.abort(); return { columns: ['id'], filters: {}, sorts: null, limit: 200 }; });
    const down: StepDeps['decide'] = async () => { throw new Error('down'); };
    const r = await runPipeline(input, deps(down, ctl.signal), h);
    expect(r.status).toBe('aborted');
    expect(calls.slice(calls.indexOf('open') + 1)).toEqual([]);
    expect(h.fill).not.toHaveBeenCalled();
  });
});
