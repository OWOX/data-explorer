import { describe, expect, test, vi } from 'vitest';
import type { AiModel, Ctx } from '../sdk/types';
import { AiUnavailable, askFast, extractJson, pickModels, pipelineReady, raceAi } from './ai';

const textModel = (text: string): AiModel => ({ doGenerate: vi.fn(async () => ({ content: [{ type: 'text', text }] })) });
const decision = { specificationVersion: 'v4', provider: 'x', modelId: 'd', supportedQuestionTypes: ['choice', 'score'], doDecide: async () => ({ answers: {}, warnings: [] }) } as const;
const ctxWith = (ai: unknown) => ({ credentials: ai === undefined ? {} : { ai } }) as unknown as Ctx;

describe('pickModels', () => {
  test('returns fast and decision when both are declared', () => {
    const fast = textModel('{}');
    const m = pickModels(ctxWith(Object.assign({}, fast, { fast, decision })));
    expect(m?.fast).toBe(fast);
    expect(m?.decision).toBe(decision);
    expect(pipelineReady(m)).toBe(true);
  });
  test('is not ready for the pipeline without decision', () => {
    const fast = textModel('{}');
    const m = pickModels(ctxWith(Object.assign({}, fast, { fast })));
    expect(m?.fast).toBe(fast);
    expect(pipelineReady(m)).toBe(false);
  });
  test('is not ready when the decision model cannot answer choice and score questions', () => {
    const fast = textModel('{}');
    const ai = (types: unknown) => pickModels(ctxWith(Object.assign({}, fast, { fast, decision: { ...decision, supportedQuestionTypes: types } })));
    expect(pipelineReady(ai(['choice', 'boolean']))).toBe(false);
    expect(pipelineReady(ai(['score']))).toBe(false);
    expect(pipelineReady(ai(['choice', 'score']))).toBe(true);
    expect(pipelineReady(ai([]))).toBe(false);
  });
  test('is null without AI', () => {
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

describe('raceAi', () => {
  it('returns what the run resolves to', async () => {
    await expect(raceAi(new AbortController().signal, 1000, async () => 7)).resolves.toBe(7);
  });
  it('gives up after the time limit and aborts the run', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const p = raceAi(new AbortController().signal, 50, (s) => new Promise<never>(() => { s.addEventListener('abort', () => { aborted = true; }); }));
    const seen = expect(p).rejects.toBeInstanceOf(AiUnavailable);
    await vi.advanceTimersByTimeAsync(60);
    await seen;
    expect(aborted).toBe(true);
    vi.useRealTimers();
  });
  it('gives up when the caller aborts', async () => {
    const ctl = new AbortController();
    const p = raceAi(ctl.signal, 1000, () => new Promise<never>(() => {}));
    ctl.abort();
    await expect(p).rejects.toBeInstanceOf(AiUnavailable);
  });
  it('wraps any other error', async () => {
    await expect(raceAi(new AbortController().signal, 1000, async () => { throw new Error('boom'); })).rejects.toBeInstanceOf(AiUnavailable);
  });
});

describe('askFast', () => {
  const live = () => new AbortController().signal;

  test('asks for JSON with a system and a user message, no output cap, temperature 0, and returns the parsed object', async () => {
    const model = textModel('{"ok":true}');
    await expect(askFast(model, 'SYS', 'USER', live())).resolves.toEqual({ ok: true });
    const call = vi.mocked(model.doGenerate).mock.calls[0]![0];
    expect(call.responseFormat).toEqual({ type: 'json' });
    expect(call.prompt).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: [{ type: 'text', text: 'USER' }] }]);
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
    expect(call.temperature).toBe(0);
    expect(call).not.toHaveProperty('maxOutputTokens');
  });

  test('a model that never answers is AiUnavailable after the time limit, and the call is aborted', async () => {
    let seen: AbortSignal | undefined;
    const model: AiModel = { doGenerate: (o) => { seen = o.abortSignal; return new Promise(() => {}); } };
    await expect(askFast(model, 's', 'u', live(), 50)).rejects.toBeInstanceOf(AiUnavailable);
    expect(seen?.aborted).toBe(true);
  });

  test('a rejection and an answer with no JSON are AiUnavailable', async () => {
    const boom: AiModel = { doGenerate: async () => { throw new Error('quota'); } };
    await expect(askFast(boom, 's', 'u', live())).rejects.toBeInstanceOf(AiUnavailable);
    await expect(askFast(textModel('sorry, no'), 's', 'u', live())).rejects.toBeInstanceOf(AiUnavailable);
  });
});
