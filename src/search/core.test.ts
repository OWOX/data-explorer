// src/search/core.test.ts
import { describe, expect, it } from 'vitest';
import { coreSignals, relevance, shortlist } from './core';
import type { Edge, Mart, Model } from '../model/types';

const mart = (id: string, title = id, description: string | null = null): Mart => ({ id, title, description, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null });
const edge = (source: string, target: string, sf = 'user_id', tf = 'id'): Edge => ({ id: `${source}-${target}-${sf}`, source, target, joins: [{ sourceField: sf, targetField: tf }] });
const modelOf = (marts: Mart[], edges: Edge[]): Model => ({ marts: new Map(marts.map((m) => [m.id, m])), sources: [], edges, contexts: [], storages: [], failedStorages: [] });

describe('coreSignals', () => {
  const m = modelOf([mart('users'), mart('orders'), mart('sessions'), mart('user_acquisition_report', 'User acquisition')], [
    edge('orders', 'users'), edge('sessions', 'users'), edge('users', 'orders', 'id', 'user_id'),
  ]);
  const s = coreSignals(m);
  it('counts inbound, outbound and distinct neighbours', () => {
    expect(s.get('users')).toMatchObject({ inbound: 2, outbound: 1, neighbours: 2, keyAgreement: 1 });
  });
  it('gives a mart without edges a zero score', () => {
    expect(s.get('user_acquisition_report')).toEqual({ inbound: 0, outbound: 0, neighbours: 0, keyAgreement: 0, score: 0 });
  });
  it('scores the connected entity above a report-style mart', () => {
    expect(s.get('users')!.score).toBeGreaterThan(s.get('user_acquisition_report')!.score);
  });
  it('measures key agreement as the share of inbound edges on the most common target key', () => {
    const k = coreSignals(modelOf([mart('a'), mart('b'), mart('c'), mart('t')], [edge('a', 't', 'x', 'id'), edge('b', 't', 'y', 'id'), edge('c', 't', 'z', 'email')]));
    expect(k.get('t')!.keyAgreement).toBeCloseTo(2 / 3);
  });
});

describe('shortlist', () => {
  it('ranks by relevance first, then core score, and never reads titles for coreness', () => {
    const m = modelOf([mart('users', 'Users'), mart('orders', 'Orders'), mart('uar', 'User acquisition report')], [edge('orders', 'users'), edge('users', 'orders', 'id', 'user_id')]);
    const ids = shortlist(m, coreSignals(m), { marts: [], reports: [] }, ['users']);
    expect(ids[0]).toBe('users');
  });
  it('puts search hits ahead', () => {
    const m = modelOf([mart('a'), mart('b')], [edge('a', 'b')]);
    expect(shortlist(m, coreSignals(m), { marts: ['a'], reports: [] }, [])[0]).toBe('a');
  });
  it('still ranks when the catalogue has no relationships', () => {
    const m = modelOf([mart('users', 'Users'), mart('ads', 'Ads')], []);
    expect(shortlist(m, coreSignals(m), { marts: [], reports: [] }, ['ads'])[0]).toBe('ads');
  });
  it('skips marts the member cannot open and caps the list', () => {
    const marts = Array.from({ length: 30 }, (_, i) => mart(`m${i}`));
    marts[0] = { ...marts[0]!, accessible: false };
    const m = modelOf(marts, []);
    const ids = shortlist(m, coreSignals(m), { marts: [], reports: [] }, []);
    expect(ids).toHaveLength(20);
    expect(ids).not.toContain('m0');
  });
  it('counts a report hit as a hit on its mart', () => {
    const m = modelOf([mart('a'), mart('b')], []);
    expect(relevance('b', m, { marts: [], reports: [{ id: 'r', title: 'R', martId: 'b' }] }, [])).toBe(3);
  });
});
