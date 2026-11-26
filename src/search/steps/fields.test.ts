import { describe, expect, it, vi } from 'vitest';
import { applyFields, buildFieldQuestions, roleOf, runFields, wordShortlist, type MartFields } from './fields';
import { EMPTY_INTENT } from '../intent';
import type { Field, Schema } from '../../model/types';

const f = (name: string, category: Field['category'] = 'string', extra: Partial<Field> = {}): Field => ({ name, alias: null, type: category === 'number' ? 'FLOAT' : category === 'date' ? 'DATE' : 'STRING', category, description: null, isPrimaryKey: false, ...extra });
const input = { query: 'spend by country', intent: { ...EMPTY_INTENT, measures: ['spend'], breakdowns: ['country'] }, hits: { marts: [], reports: [] }, model: { marts: new Map(), sources: [], edges: [], contexts: [], storages: [], failedStorages: [] } };
const score = (level: number) => ({ type: 'score' as const, level });

it('gives numbers the measure role and the rest the breakdown role', () => {
  expect(roleOf(f('spend', 'number'))).toBe('measure');
  expect(roleOf(f('country'))).toBe('breakdown');
  expect(roleOf(f('day', 'date'))).toBe('breakdown');
  expect(roleOf(f('tags', 'other'))).toBeNull();
});

it('shortlists by words, keeping key and date fields', () => {
  const fields = [f('id'), f('created', 'date'), ...Array.from({ length: 80 }, (_, i) => f(`col${i}`)), f('country')];
  const s = wordShortlist(fields, 'spend by country', ['id']);
  expect(s).toHaveLength(64);
  expect(s.map((x) => x.name)).toEqual(expect.arrayContaining(['id', 'created', 'country']));
});

it('asks one score per field under generated ids', () => {
  const asked = buildFieldQuestions(input, { aliasPath: '', title: 'Ads', fields: [] }, [f('ads.spend', 'number'), f('country')])!;
  expect(Object.keys(asked.questions)).toEqual(['f0', 'f1']);
});

describe('applyFields', () => {
  const main: MartFields = { aliasPath: '', title: 'Users', fields: [f('id'), f('country'), f('spend', 'number')] };
  const joined: MartFields = { aliasPath: 'orders', title: 'Orders', fields: [f('orders__amount', 'number'), f('orders__status')] };
  it('keeps needed then useful fields, main first, and drops a joined mart with none', () => {
    const r = applyFields([
      { mart: main, fields: main.fields, answers: { f0: score(0), f1: score(2), f2: score(1) } },
      { mart: joined, fields: joined.fields, answers: { f0: score(0), f1: score(0) } },
    ], ['id']);
    expect(r.columns).toEqual(['country', 'spend']);
    expect([...r.needed]).toEqual(['country']);
    expect(r.keptPaths).toEqual([]);
  });
  it('keeps the main default columns when the main mart has no answers', () => {
    const r = applyFields([{ mart: main, fields: main.fields, answers: null }, { mart: joined, fields: joined.fields, answers: { f0: score(2), f1: score(1) } }], ['id', 'country']);
    expect(r).toMatchObject({ columns: ['id', 'country', 'orders__amount', 'orders__status'], keptPaths: ['orders'], failedMain: true });
  });
  it('caps 8 per mart and 20 in total', () => {
    const wide = (p: string): MartFields => ({ aliasPath: p, title: p, fields: Array.from({ length: 12 }, (_, i) => f(`${p}_${i}`)) });
    const all = ['', 'a', 'b'].map((p) => wide(p));
    const ans = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}`, score(2)]));
    const r = applyFields(all.map((m) => ({ mart: m, fields: m.fields, answers: ans })), []);
    expect(r.columns).toHaveLength(20);
    expect(r.columns.filter((c) => c.startsWith('_'))).toHaveLength(8);
  });
});

it('asks one decision per mart, in parallel', async () => {
  const decide = vi.fn(async (qs: Record<string, unknown>) => Object.fromEntries(Object.keys(qs).map((k) => [k, score(2)])));
  const schema = Object.assign([f('id'), f('country')], { primaryKey: ['id'] }) as Schema;
  const deps = { ctx: {} as never, fast: {} as never, signal: new AbortController().signal, decide, schemas: { get: vi.fn() }, blendable: { get: vi.fn() } };
  const r = await runFields(input, deps, { schema, title: 'Users' }, [{ aliasPath: 'orders', martId: 'o', label: 'Orders', depth: 1, fields: [f('orders__amount', 'number')], uniqueCount: true, mainGrainCollapse: 'collapses', mainGrainMultiplication: 'unknown' }]);
  expect(decide).toHaveBeenCalledTimes(2);
  expect(r.columns).toEqual(['id', 'country', 'orders__amount']);
});
