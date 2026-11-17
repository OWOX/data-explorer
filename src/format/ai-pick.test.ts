import { beforeEach, expect, test, vi } from 'vitest';
import { stubCtx } from '../api/test-ctx';
import type { Field, Schema } from '../model/types';
import type { AiModel, Ctx } from '../sdk/types';
import { pickFormats, resetAiPickSession } from './ai-pick';
import { formatStore } from './store';

const f = (name: string, category: Field['category'], type: string, extra: Partial<Field> = {}): Field => ({ name, alias: null, type, category, description: null, isPrimaryKey: false, ...extra });
const schema: Schema = [f('amount', 'number', 'NUMERIC', { alias: 'Revenue', description: 'Order total' }), f('rate', 'number', 'FLOAT64'), f('created', 'date', 'TIMESTAMP'), f('status', 'string', 'STRING')];

function setup(answer: unknown, opts: { noAi?: boolean } = {}) {
  const doGenerate = vi.fn<AiModel['doGenerate']>(async () => {
    if (answer instanceof Error) throw answer;
    return { content: [{ type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer) }] };
  });
  const docs = new Map<string, unknown>();
  const base = stubCtx();
  const ctx = {
    ...base,
    credentials: opts.noAi ? undefined : { ai: { fast: { doGenerate } } },
    collections: <T,>(name: string) => ({ get: async (id: string) => (docs.has(`${name}/${id}`) ? { document: docs.get(`${name}/${id}`) as T } : null), put: async (id: string, d: T) => { docs.set(`${name}/${id}`, d); } }),
  } as unknown as Ctx;
  return { ctx, store: formatStore(ctx), doGenerate, docs };
}
const run = (s: ReturnType<typeof setup>, project = {}, sch = schema, signal = new AbortController().signal) => pickFormats(s.ctx, s.store, 'm1', 'Orders', sch, project, signal);

beforeEach(() => resetAiPickSession());

test('no models: no call, nothing stored', async () => {
  const s = setup({}, { noAi: true });
  expect(await run(s)).toEqual({});
  expect(s.doGenerate).not.toHaveBeenCalled();
  expect(s.docs.size).toBe(0);
});

test('asks with title, name, alias and description, no values; stores valid picks and drops the rest', async () => {
  const s = setup({ amount: { kind: 'money', currency: 'usd' }, rate: { kind: 'percent' }, created: { kind: 'date' }, status: { kind: 'plain' }, ghost: { kind: 'plain' } });
  const picks = await run(s);
  // `created` is a TIMESTAMP, which offers `date`; `status` is text and `ghost` is no column.
  expect(picks).toEqual({ amount: { kind: 'money', currency: 'USD' }, rate: { kind: 'percent' }, created: { kind: 'date' } });
  expect((await s.store.load('m1')).project).toEqual(picks);
  const user = (s.doGenerate.mock.calls[0]![0].prompt[1] as { content: { text: string }[] }).content[0]!.text;
  const doc = JSON.parse(user) as { dataMart: string; columns: { id: string; alias?: string; description?: string; kinds: string[] }[] };
  expect(doc.dataMart).toBe('Orders');
  expect(doc.columns.map((c) => c.id)).toEqual(['amount', 'rate', 'created']);
  expect(doc.columns[0]).toMatchObject({ alias: 'Revenue', description: 'Order total' });
});

test('invalid kinds, currencies and shapes are dropped; auto is not stored', async () => {
  const s = setup({ amount: { kind: 'money', currency: 'ZZZZ' }, rate: { kind: 'bogus' }, created: { kind: 'auto' } });
  expect(await run(s)).toEqual({});
  const t = setup({ amount: { kind: 'money' }, rate: 'percent', created: { kind: 'money', currency: 'USD' } });
  expect(await run(t)).toEqual({});
});

test('a joined column goes to the model by the joined mart title and original name, and is keyed by the blended name', async () => {
  const joined = f('customers.revenue', 'number', 'NUMERIC', { joined: { martId: 'c', label: 'Customers', aliasPath: 'customers', originalName: 'revenue' } });
  const s = setup({ 'customers.revenue': { kind: 'money', currency: 'EUR' } });
  expect(await run(s, {}, [joined])).toEqual({ 'customers.revenue': { kind: 'money', currency: 'EUR' } });
  const user = (s.doGenerate.mock.calls[0]![0].prompt[1] as { content: { text: string }[] }).content[0]!.text;
  expect(JSON.parse(user).columns[0]).toMatchObject({ id: 'customers.revenue', name: 'revenue', dataMart: 'Customers' });
});

test('columns with a project pick are not asked about and the pick is kept, even one that lands while the model thinks', async () => {
  const s = setup({ amount: { kind: 'plain' }, rate: { kind: 'percent' }, created: { kind: 'date' } });
  s.doGenerate.mockImplementationOnce(async () => {
    await s.store.setProject('m1', { rate: { kind: 'plain' } });
    return { content: [{ type: 'text', text: JSON.stringify({ amount: { kind: 'plain' }, rate: { kind: 'percent' } }) }] };
  });
  const picks = await run(s, { created: { kind: 'datetime' } });
  expect(picks).toEqual({ amount: { kind: 'plain' } });
  expect((await s.store.load('m1')).project).toEqual({ rate: { kind: 'plain' }, amount: { kind: 'plain' } });
  const user = (s.doGenerate.mock.calls[0]![0].prompt[1] as { content: { text: string }[] }).content[0]!.text;
  expect(JSON.parse(user).columns.map((c: { id: string }) => c.id)).not.toContain('created');
});

test('a failure or a non-JSON answer is silent', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(await run(setup(new Error('boom')))).toEqual({});
  resetAiPickSession();
  expect(await run(setup('not json at all'))).toEqual({});
  expect(warn).not.toHaveBeenCalled();
});

test('asks once per mart per session; an aborted ask is taken back', async () => {
  const s = setup({ rate: { kind: 'percent' } });
  await run(s);
  await run(s, {});
  expect(s.doGenerate).toHaveBeenCalledTimes(1);
  resetAiPickSession();
  const ctl = new AbortController();
  const slow = setup({ rate: { kind: 'percent' } });
  const p = run(slow, {}, schema, ctl.signal);
  ctl.abort();
  expect(await p).toEqual({});
  expect((await slow.store.load('m1')).project).toEqual({});
  await run(slow);
  expect(slow.doGenerate).toHaveBeenCalledTimes(2);
});

test('nothing eligible: no call', async () => {
  const s = setup({});
  expect(await pickFormats(s.ctx, s.store, 'm1', 'Orders', [f('status', 'string', 'STRING')], {}, new AbortController().signal)).toEqual({});
  expect(s.doGenerate).not.toHaveBeenCalled();
});
