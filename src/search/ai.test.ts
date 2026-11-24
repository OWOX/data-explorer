import { describe, expect, test, vi } from 'vitest';
import type { AiModel, Ctx } from '../sdk/types';
import { AiUnavailable, createAiRun, extractJson, pickModels, pipelineReady } from './ai';

const textModel = (text: string): AiModel => ({ doGenerate: vi.fn(async () => ({ content: [{ type: 'text', text }] })) });
const decision = { specificationVersion: 'v4', provider: 'x', modelId: 'd', supportedQuestionTypes: ['choice', 'score', 'boolean'], doDecide: async () => ({ answers: {}, warnings: [] }) } as const;
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
    expect(pipelineReady(ai(undefined))).toBe(true);
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

describe('createAiRun', () => {
  const live = () => new AbortController().signal;

  test('asks for JSON with a system and a user message, no output cap, and returns the parsed object', async () => {
    const model = textModel('{"ok":true}');
    const run = createAiRun({ fast: model }, live());
    await expect(run.ask('intent', 'SYS', 'USER')).resolves.toEqual({ ok: true });
    const call = vi.mocked(model.doGenerate).mock.calls[0]![0];
    expect(call.responseFormat).toEqual({ type: 'json' });
    expect(call.prompt).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: [{ type: 'text', text: 'USER' }] }]);
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
    expect(call).not.toHaveProperty('maxOutputTokens');
  });

  test('asks the fast model for every role', async () => {
    const run = createAiRun({ fast: textModel('{"ok":1}') }, live());
    expect(await run.ask('intent', 's', 'u')).toEqual({ ok: 1 });
    expect(await run.ask('shortlist', 's', 'u')).toEqual({ ok: 1 });
  });

  test('temperature 0 goes to the fast model', async () => {
    const fast = textModel('{}');
    await createAiRun({ fast }, live()).ask('intent', 's', 'u');
    expect(vi.mocked(fast.doGenerate).mock.calls[0]![0].temperature).toBe(0);
  });

  test('a model that never answers is AiUnavailable after its share of the budget, and the call is aborted', async () => {
    let seen: AbortSignal | undefined;
    const model: AiModel = { doGenerate: (o) => { seen = o.abortSignal; return new Promise(() => {}); } };
    await expect(createAiRun({ fast: model }, live(), 50).ask('intent', 's', 'u')).rejects.toBeInstanceOf(AiUnavailable);
    expect(seen?.aborted).toBe(true);
  });

  test('the budget is shared by every question of one run', async () => {
    const model: AiModel = { doGenerate: () => new Promise((resolve) => setTimeout(() => resolve({ content: [{ type: 'text', text: '{}' }] }), 30)) };
    const run = createAiRun({ fast: model }, live(), 50);
    await run.ask('shortlist', 's', 'u');
    await expect(run.ask('shortlist', 's', 'u')).rejects.toBeInstanceOf(AiUnavailable);
  });

  test('a rejection and an answer with no JSON are AiUnavailable', async () => {
    const boom: AiModel = { doGenerate: async () => { throw new Error('quota'); } };
    await expect(createAiRun({ fast: boom }, live()).ask('shortlist', 's', 'u')).rejects.toBeInstanceOf(AiUnavailable);
    await expect(createAiRun({ fast: textModel('sorry, no') }, live()).ask('shortlist', 's', 'u')).rejects.toBeInstanceOf(AiUnavailable);
    await expect(createAiRun({ decision }, live()).ask('formats', 's', 'u')).rejects.toBeInstanceOf(AiUnavailable);
  });
});
