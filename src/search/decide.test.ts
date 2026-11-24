import { Experimental_DecisionRefusalError } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { AiUnavailable } from './ai';
import { choiceQ, createDecide, isUnsure, ranked, scoreQ } from './decide';
import type { DecisionModel } from '../sdk/types';

const model = {} as DecisionModel;
const fakeDecide = (answers: Record<string, unknown>) => vi.fn(async () => ({ answers })) as never;
const qs = { c: choiceQ('pick', { a: null, b: 'B' }), s: scoreQ('rate', ['no', 'maybe', 'yes']) };

describe('createDecide', () => {
  it('sends the state as one JSON text part and maps answers', async () => {
    const fn = fakeDecide({ c: { type: 'choice', choice: 'b', probabilities: { a: 0.2, b: 0.8 } }, s: { type: 'score', score: 1.6 } });
    const decide = createDecide(model, { decideFn: fn });
    const out = await decide(qs, { query: 'x' }, new AbortController().signal);
    expect(out.c).toEqual({ type: 'choice', choice: 'b', probabilities: { a: 0.2, b: 0.8 } });
    expect(out.s).toEqual({ type: 'score', level: 2, probabilities: undefined });
    const call = (fn as unknown as { mock: { calls: [{ state: unknown }][] } }).mock.calls[0]![0];
    expect(call.state).toEqual([{ type: 'text', text: '{"query":"x"}' }]);
  });
  it('leaves an option that was not offered unanswered', async () => {
    const decide = createDecide(model, { decideFn: fakeDecide({ c: { type: 'choice', choice: 'zzz' }, s: { type: 'score', score: 1 } }) });
    const out = await decide(qs, {}, new AbortController().signal);
    expect(out.c).toBeUndefined();
    expect(out.s).toEqual({ type: 'score', level: 1, probabilities: undefined });
  });
  it('treats an inherited property name as not offered', async () => {
    const decide = createDecide(model, { decideFn: fakeDecide({ c: { type: 'choice', choice: 'constructor' } }) });
    expect((await decide({ c: qs.c }, {}, new AbortController().signal)).c).toBeUndefined();
  });
  it('answers around a refused question with one re-ask', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Experimental_DecisionRefusalError({ questionIds: ['s'], provider: 'x', modelId: 'd' }))
      .mockResolvedValueOnce({ answers: { c: { type: 'choice', choice: 'b' } } });
    const out = await createDecide(model, { decideFn: fn as never })(qs, {}, new AbortController().signal);
    expect(out.c).toEqual({ type: 'choice', choice: 'b', probabilities: undefined });
    expect(out.s).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(Object.keys(fn.mock.calls[1]![0].questions)).toEqual(['c']);
  });
  it('fails when the re-ask is refused too', async () => {
    const refuse = () => new Experimental_DecisionRefusalError({ questionIds: ['c'], provider: 'x', modelId: 'd' });
    const fn = vi.fn().mockRejectedValueOnce(new Experimental_DecisionRefusalError({ questionIds: ['s'], provider: 'x', modelId: 'd' })).mockRejectedValueOnce(refuse());
    await expect(createDecide(model, { decideFn: fn as never })(qs, {}, new AbortController().signal)).rejects.toBeInstanceOf(AiUnavailable);
  });
  it('clamps a score into its levels', async () => {
    const decide = createDecide(model, { decideFn: fakeDecide({ s: { type: 'score', score: 7 } }) });
    expect((await decide({ s: qs.s }, {}, new AbortController().signal)).s).toEqual({ type: 'score', level: 2, probabilities: undefined });
  });
  it('turns a provider error into AiUnavailable', async () => {
    const decide = createDecide(model, { decideFn: vi.fn(async () => { throw new Error('500'); }) as never });
    await expect(decide(qs, {}, new AbortController().signal)).rejects.toBeInstanceOf(AiUnavailable);
  });
  it('times out even when the model ignores the signal', async () => {
    const decide = createDecide(model, { timeoutMs: 20, decideFn: vi.fn(() => new Promise(() => {})) as never });
    await expect(decide(qs, {}, new AbortController().signal)).rejects.toBeInstanceOf(AiUnavailable);
  });
  it('rejects more than 64 questions before any request', async () => {
    const fn = fakeDecide({});
    const many = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`q${i}`, qs.c]));
    await expect(createDecide(model, { decideFn: fn })(many, {}, new AbortController().signal)).rejects.toBeInstanceOf(AiUnavailable);
    expect(fn).not.toHaveBeenCalled();
  });
  it('asks nothing for an empty question set', async () => {
    const fn = fakeDecide({});
    expect(await createDecide(model, { decideFn: fn })({}, {}, new AbortController().signal)).toEqual({});
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('confidence', () => {
  it('is unsure under 0.6 or within 0.15 of the second', () => {
    expect(isUnsure({ type: 'choice', choice: 'a', probabilities: { a: 0.55, b: 0.45 } })).toBe(true);
    expect(isUnsure({ type: 'choice', choice: 'a', probabilities: { a: 0.62, b: 0.5 } })).toBe(true);
    expect(isUnsure({ type: 'choice', choice: 'a', probabilities: { a: 0.8, b: 0.2 } })).toBe(false);
  });
  it('is sure without probabilities', () => {
    expect(isUnsure({ type: 'choice', choice: 'a' })).toBe(false);
  });
  it('ranks options by probability', () => {
    expect(ranked({ type: 'choice', choice: 'b', probabilities: { a: 0.1, b: 0.6, c: 0.3 } })).toEqual(['b', 'c', 'a']);
    expect(ranked({ type: 'choice', choice: 'b' })).toEqual(['b']);
  });
});
