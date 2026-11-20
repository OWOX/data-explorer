import { describe, expect, test, vi } from 'vitest';
import type { AiModel, Ctx } from '../sdk/types';
import { AiUnavailable, createAiRun, extractJson, pickModels } from './ai';

const textModel = (text: string): AiModel => ({ doGenerate: vi.fn(async () => ({ content: [{ type: 'text', text }] })) });
const ctxWith = (ai: unknown) => ({ credentials: ai === undefined ? {} : { ai } }) as unknown as Ctx;

describe('pickModels', () => {
  test('gives the fast and reasoning models that exist, or none', () => {
    const reasoning = textModel('{}');
    const fast = textModel('{}');
    expect(pickModels(ctxWith({ ...fast, fast, reasoning }))).toEqual({ fast, reasoning });
    expect(pickModels(ctxWith({ ...fast, fast }))).toEqual({ fast });
    expect(pickModels(ctxWith({ reasoning }))).toEqual({ reasoning });
    expect(pickModels(ctxWith(undefined))).toBeNull();
    expect(pickModels({} as Ctx)).toBeNull();
    expect(pickModels(ctxWith({}))).toBeNull();
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
  const live = () => new AbortController().signal;

  test('asks for JSON with a system and a user message, no output cap, and returns the parsed object', async () => {
    const model = textModel('{"ok":true}');
    const run = createAiRun({ fast: model }, live());
    await expect(run.ask('discover', 'SYS', 'USER')).resolves.toEqual({ ok: true });
    const call = vi.mocked(model.doGenerate).mock.calls[0]![0];
    expect(call.responseFormat).toEqual({ type: 'json' });
    expect(call.prompt).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: [{ type: 'text', text: 'USER' }] }]);
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
    expect(call).not.toHaveProperty('maxOutputTokens');
  });

  test('discovery asks the fast model, fields asks the reasoning model; each falls back to the one that exists', async () => {
    const fast = textModel('{"m":"fast"}');
    const reasoning = textModel('{"m":"reasoning"}');
    const both = createAiRun({ fast, reasoning }, live());
    expect(await both.ask('discover', 's', 'u')).toEqual({ m: 'fast' });
    expect(await both.ask('fields', 's', 'u')).toEqual({ m: 'reasoning' });
    expect(await createAiRun({ reasoning }, live()).ask('discover', 's', 'u')).toEqual({ m: 'reasoning' });
    expect(await createAiRun({ fast }, live()).ask('fields', 's', 'u')).toEqual({ m: 'fast' });
  });

  test('a reasoning model that fails is retried once on fast; a cancelled run is not', async () => {
    const reasoning: AiModel = { doGenerate: vi.fn(async () => { throw new Error('quota'); }) };
    const fast = textModel('{"m":"fast"}');
    expect(await createAiRun({ fast, reasoning }, live()).ask('fields', 's', 'u')).toEqual({ m: 'fast' });
    expect(reasoning.doGenerate).toHaveBeenCalledTimes(1);
    const junk = textModel('no json');
    expect(await createAiRun({ fast, reasoning: junk }, live()).ask('fields', 's', 'u')).toEqual({ m: 'fast' });
    const parent = new AbortController();
    const slow: AiModel = { doGenerate: () => new Promise(() => {}) };
    const fastSpy = textModel('{}');
    const pending = createAiRun({ fast: fastSpy, reasoning: slow }, parent.signal).ask('fields', 's', 'u');
    parent.abort();
    await expect(pending).rejects.toBeInstanceOf(AiUnavailable);
    expect(fastSpy.doGenerate).not.toHaveBeenCalled();
  });

  test('a model that never answers is AiUnavailable after its share of the budget, and the call is aborted', async () => {
    let seen: AbortSignal | undefined;
    const model: AiModel = { doGenerate: (o) => { seen = o.abortSignal; return new Promise(() => {}); } };
    await expect(createAiRun({ fast: model }, live(), 50).ask('discover', 's', 'u')).rejects.toBeInstanceOf(AiUnavailable);
    expect(seen?.aborted).toBe(true);
  });

  test('a slow reasoning model leaves the retry on fast the rest of the budget', async () => {
    vi.useFakeTimers();
    try {
      const reasoning: AiModel = { doGenerate: () => new Promise(() => {}) };
      const fast = textModel('{"m":"fast"}');
      const answer = createAiRun({ fast, reasoning }, live(), 1000).ask('fields', 's', 'u');
      // the fields share is 500 ms; the retry runs in the 500 ms left
      await vi.advanceTimersByTimeAsync(500);
      expect(await answer).toEqual({ m: 'fast' });
      expect(fast.doGenerate).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  test('the retry on fast gets its own share of the budget, not the whole rest', async () => {
    vi.useFakeTimers();
    try {
      const reasoning: AiModel = { doGenerate: async () => { throw new Error('down'); } };
      const fast: AiModel = { doGenerate: () => new Promise(() => {}) };
      const answer = createAiRun({ fast, reasoning }, live(), 1000).ask('fields', 's', 'u');
      const settled = answer.then(() => 'ok', (e: unknown) => e);
      // reasoning fails at once, so nearly the whole 1000 ms is left; the retry is still capped at the 500 ms share
      await vi.advanceTimersByTimeAsync(500);
      expect(await settled).toBeInstanceOf(AiUnavailable);
    } finally { vi.useRealTimers(); }
  });

  test('temperature goes to the fast model only', async () => {
    const fast = textModel('{}');
    const reasoning = textModel('{}');
    const run = createAiRun({ fast, reasoning }, live());
    await run.ask('discover', 's', 'u');
    await run.ask('filters', 's', 'u');
    expect(vi.mocked(fast.doGenerate).mock.calls[0]![0].temperature).toBe(0);
    expect(vi.mocked(reasoning.doGenerate).mock.calls[0]![0]).not.toHaveProperty('temperature');
    const failing: AiModel = { doGenerate: async () => { throw new Error('x'); } };
    const retry = textModel('{}');
    await createAiRun({ fast: retry, reasoning: failing }, live()).ask('fields', 's', 'u');
    expect(vi.mocked(retry.doGenerate).mock.calls[0]![0].temperature).toBe(0);
  });

  test('the budget is shared by every question of one run', async () => {
    const model: AiModel = { doGenerate: () => new Promise((resolve) => setTimeout(() => resolve({ content: [{ type: 'text', text: '{}' }] }), 30)) };
    const run = createAiRun({ fast: model }, live(), 50);
    await run.ask('filters', 's', 'u');
    await expect(run.ask('filters', 's', 'u')).rejects.toBeInstanceOf(AiUnavailable);
  });

  test('a rejection and an answer with no JSON are AiUnavailable', async () => {
    const boom: AiModel = { doGenerate: async () => { throw new Error('quota'); } };
    await expect(createAiRun({ fast: boom }, live()).ask('fields', 's', 'u')).rejects.toBeInstanceOf(AiUnavailable);
    await expect(createAiRun({ fast: textModel('sorry, no') }, live()).ask('fields', 's', 'u')).rejects.toBeInstanceOf(AiUnavailable);
    await expect(createAiRun({}, live()).ask('fields', 's', 'u')).rejects.toBeInstanceOf(AiUnavailable);
  });
});
