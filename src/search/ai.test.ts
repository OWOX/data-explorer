import { describe, expect, test, vi } from 'vitest';
import type { AiModel, Ctx } from '../sdk/types';
import { AiUnavailable, createAiRun, extractJson, pickModel } from './ai';

const textModel = (text: string): AiModel => ({ doGenerate: vi.fn(async () => ({ content: [{ type: 'text', text }] })) });
const ctxWith = (ai: unknown) => ({ credentials: ai === undefined ? {} : { ai } }) as unknown as Ctx;

describe('pickModel', () => {
  test('prefers reasoning, then fast, else none', () => {
    const reasoning = textModel('{}');
    const fast = textModel('{}');
    expect(pickModel(ctxWith({ ...fast, fast, reasoning }))).toBe(reasoning);
    expect(pickModel(ctxWith({ ...fast, fast }))).toBe(fast);
    expect(pickModel(ctxWith(undefined))).toBeNull();
    expect(pickModel({} as Ctx)).toBeNull();
    // a handle with neither capability is not a model we can use
    expect(pickModel(ctxWith({}))).toBeNull();
  });
});

describe('extractJson', () => {
  test.each([
    ['{"a":1}', { a: 1 }],
    ['```json\n{"a":1}\n```', { a: 1 }],
    ['Here you go: {"a":[1,2]} hope it helps', { a: [1, 2] }],
    ['{"s":"} not the end"}', { s: '} not the end' }],
  ])('reads %j', (text, out) => expect(extractJson(text)).toEqual(out));
  test.each([[''], ['no json here'], ['{broken'], ['[1,2]']])('returns undefined for %j', (text) => expect(extractJson(text)).toBeUndefined());
});

describe('createAiRun', () => {
  test('asks for JSON with a system and a user message and returns the parsed object', async () => {
    const model = textModel('{"ok":true}');
    const run = createAiRun(model, new AbortController().signal);
    await expect(run.ask('SYS', 'USER')).resolves.toEqual({ ok: true });
    const call = vi.mocked(model.doGenerate).mock.calls[0]![0];
    expect(call.responseFormat).toEqual({ type: 'json' });
    expect(call.prompt).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: [{ type: 'text', text: 'USER' }] }]);
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
  });

  test('a model that never answers is AiUnavailable after the timeout, and the call is aborted', async () => {
    let seen: AbortSignal | undefined;
    const model: AiModel = { doGenerate: (o) => { seen = o.abortSignal; return new Promise(() => {}); } };
    const run = createAiRun(model, new AbortController().signal, 20);
    await expect(run.ask('s', 'u')).rejects.toBeInstanceOf(AiUnavailable);
    expect(seen?.aborted).toBe(true);
  });

  test('the timeout is shared by every question of one run', async () => {
    const model: AiModel = { doGenerate: () => new Promise((resolve) => setTimeout(() => resolve({ content: [{ type: 'text', text: '{}' }] }), 30)) };
    const run = createAiRun(model, new AbortController().signal, 50);
    await run.ask('s', 'u');
    await expect(run.ask('s', 'u').then(() => run.ask('s', 'u'))).rejects.toBeInstanceOf(AiUnavailable);
  });

  test('a rejection, an answer with no JSON and a parent abort are all AiUnavailable', async () => {
    const boom: AiModel = { doGenerate: async () => { throw new Error('quota'); } };
    await expect(createAiRun(boom, new AbortController().signal).ask('s', 'u')).rejects.toBeInstanceOf(AiUnavailable);
    await expect(createAiRun(textModel('sorry, no'), new AbortController().signal).ask('s', 'u')).rejects.toBeInstanceOf(AiUnavailable);
    const parent = new AbortController();
    const slow: AiModel = { doGenerate: () => new Promise(() => {}) };
    const pending = createAiRun(slow, parent.signal).ask('s', 'u');
    parent.abort();
    await expect(pending).rejects.toBeInstanceOf(AiUnavailable);
  });
});
