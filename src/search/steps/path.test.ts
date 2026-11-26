import { describe, expect, it, vi } from 'vitest';
import { applyPath, buildPathQuestions, pathCandidates, runPath } from './path';
import { EMPTY_INTENT } from '../intent';
import type { JoinedSource } from '../../api/blendable';
import type { Mart, Model } from '../../model/types';

const src = (aliasPath: string, martId: string, extra: Partial<JoinedSource> = {}): JoinedSource => ({ aliasPath, martId, label: martId, depth: aliasPath.split('.').length, fields: [], uniqueCount: true, mainGrainCollapse: 'collapses', mainGrainMultiplication: 'unknown', ...extra });
const mart = (id: string, title = id): Mart => ({ id, title, description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null });
const model: Model = { marts: new Map([['orders', mart('orders', 'Orders')], ['users', mart('users', 'Users')], ['items', mart('items')], ['deep', mart('deep')]]), sources: [], edges: [{ id: 'r1', source: 'users', target: 'orders', joins: [], alias: 'Placed orders', description: 'Orders the user placed' }], contexts: [], storages: [], failedStorages: [] };
const input = { query: 'orders of users', intent: { ...EMPTY_INTENT, subjects: ['orders'] }, hits: { marts: [], reports: [] }, model };

describe('pathCandidates', () => {
  it('keeps depth 4 or less and labels each with its relationship', () => {
    const c = pathCandidates([src('orders', 'orders', { relationshipId: 'r1' }), src('orders.items', 'items'), src('orders.items.deep', 'orders'), src('a.b.c.d.e', 'far')], input);
    expect(c.map((x) => x.source.aliasPath)).toEqual(['orders', 'orders.items.deep', 'orders.items']);
    expect(c[0]).toMatchObject({ qid: 'p0', relationship: 'Placed orders', relationshipDescription: 'Orders the user placed' });
    expect(c[2]!.via).toEqual(['Orders']);
  });
  it('keeps two relationships to one mart as two candidates', () => {
    expect(pathCandidates([src('created_by', 'users', { relationshipId: 'r1' }), src('assigned_to', 'users', { relationshipId: 'r2' })], input)).toHaveLength(2);
  });
  it('keeps one candidate per mart and relationship, preferring grain-safe, then shallow, then first', () => {
    const c = pathCandidates([src('a.b.c', 'users', { relationshipId: 'r1', mainGrainMultiplication: 'multiplies' }), src('a.b.c.d', 'users', { relationshipId: 'r1', mainGrainMultiplication: 'none' }), src('x', 'users', { relationshipId: 'r1', mainGrainMultiplication: 'none' }), src('y', 'users', { relationshipId: 'r1', mainGrainMultiplication: 'none' })], input);
    expect(c.map((x) => x.source.aliasPath)).toEqual(['x']);
    const d = pathCandidates([src('a.b.c', 'users', { relationshipId: 'r1', mainGrainMultiplication: 'multiplies' }), src('a.b.c.d', 'users', { relationshipId: 'r1', mainGrainMultiplication: 'none' })], input);
    expect(d.map((x) => x.source.aliasPath)).toEqual(['a.b.c.d']);
  });
  it('offers a source deeper than 2 only when it shares a query word', () => {
    const m = new Map(model.marts).set('topic', mart('topic', 'Problem Topic'));
    const c = pathCandidates([src('a.b.c', 'items'), src('a.b.c.d', 'topic'), src('a.b', 'deep')], { ...input, query: 'which topics drive users', model: { ...model, marts: m } });
    expect(c.map((x) => x.source.aliasPath).sort()).toEqual(['a.b', 'a.b.c.d']);
  });
  it('sorts a depth-4 source sharing a query word first', () => {
    const m = new Map(model.marts).set('topic', mart('topic', 'Problem Topic'));
    const c = pathCandidates([src('a', 'items'), src('a.b.c.d', 'topic')], { ...input, query: 'which topics drive users', model: { ...model, marts: m } });
    expect(c[0]!.source.aliasPath).toBe('a.b.c.d');
  });
  it('caps at 64, keeping the best word matches', () => {
    const many = Array.from({ length: 70 }, (_, i) => src(`s${i}`, i === 69 ? 'orders' : `m${i}`));
    const c = pathCandidates(many, input);
    expect(c).toHaveLength(64);
    expect(c[0]!.source.aliasPath).toBe('s69');
  });
});

describe('applyPath', () => {
  const cands = pathCandidates(['a', 'b', 'c.d', 'e', 'f', 'g', 'h'].map((p) => src(p, `m_${p}`, p === 'b' ? { mainGrainMultiplication: 'none' } : {})), input);
  it('keeps useful and needed candidates, needed first, then grain-safe, then shallow, at most 5', () => {
    const s = (level: number) => ({ type: 'score' as const, level });
    // No candidate shares a word with the query, so they sort by depth: p0..p5 are a, b, e, f, g, h and p6 is c.d.
    const kept = applyPath({ p0: s(1), p1: s(1), p2: s(0), p3: s(1), p4: s(1), p5: s(1), p6: s(2) }, cands);
    expect(kept.map((k) => k.aliasPath)).toEqual(['c.d', 'b', 'a', 'f', 'g']);
  });
  it('ranks a grain-safe route above a shallower multiplying one at equal level', () => {
    const c = pathCandidates([src('a.b', 'm1', { mainGrainMultiplication: 'multiplies' }), src('c.d.e', 'orders', { mainGrainMultiplication: 'none' })], input);
    expect(applyPath({ p0: { type: 'score', level: 1 }, p1: { type: 'score', level: 1 } }, c).map((k) => k.aliasPath)).toEqual(['c.d.e', 'a.b']);
  });
  it('drops a multiplying route to a mart that also has a grain-safe one, keeps same-safety duplicates', () => {
    const c = pathCandidates([
      src('a.b', 'users', { relationshipId: 'r1', mainGrainMultiplication: 'multiplies' }), src('c.d.e', 'users', { relationshipId: 'r2', mainGrainMultiplication: 'none' }),
      src('f', 'items', { relationshipId: 'r3', mainGrainMultiplication: 'multiplies' }), src('g', 'items', { relationshipId: 'r4', mainGrainMultiplication: 'multiplies' }),
    ], input);
    const s = { type: 'score' as const, level: 1 };
    expect(applyPath(Object.fromEntries(c.map((x) => [x.qid, s])), c).map((k) => k.aliasPath)).toEqual(['c.d.e', 'f', 'g']);
  });
  it('keeps a higher-scored multiplying route when the safe sibling scored lower', () => {
    const c = pathCandidates([src('a.b', 'users', { relationshipId: 'r1', mainGrainMultiplication: 'multiplies' }), src('c.d.e', 'users', { relationshipId: 'r2', mainGrainMultiplication: 'none' })], input);
    expect(applyPath({ p0: { type: 'score', level: 2 }, p1: { type: 'score', level: 1 } }, c).map((k) => k.aliasPath).sort()).toEqual(['a.b', 'c.d.e']);
  });
  it('joins nothing without answers', () => {
    expect(applyPath({}, cands)).toEqual([]);
  });
});

it('builds one score question per candidate with three levels', () => {
  const asked = buildPathQuestions(input, 'Users', pathCandidates([src('orders', 'orders')], input))!;
  expect(asked.questions.p0).toMatchObject({ type: 'score' });
  expect((asked.questions.p0 as unknown as { criteria: unknown[] }).criteria).toHaveLength(3);
});

it('joins nothing and reports failure when decision fails', async () => {
  const deps = { ctx: {} as never, fast: {} as never, signal: new AbortController().signal, decide: vi.fn(async () => { throw new Error('x'); }), schemas: { get: vi.fn() }, blendable: { get: async () => [src('orders', 'orders')] } };
  const r = await runPath(input, deps, 'users');
  expect(r).toMatchObject({ sources: [], failed: true });
  expect(r.all).toHaveLength(1);
});
