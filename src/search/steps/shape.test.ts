// src/search/steps/shape.test.ts
import { describe, expect, it } from 'vitest';
import { applyShape, buildShapeQuestions, type ShapeFacts } from './shape';
import { EMPTY_INTENT, type Intent } from '../intent';
import type { Field, Schema } from '../../model/types';
import type { JoinedSource } from '../../api/blendable';

const f = (name: string, category: Field['category'], extra: Partial<Field> = {}): Field => ({ name, alias: null, type: category === 'number' ? 'FLOAT' : category === 'date' ? 'DATE' : 'STRING', category, description: null, isPrimaryKey: false, ...extra });
const orders: JoinedSource = { aliasPath: 'orders', martId: 'o', label: 'Orders', depth: 1, uniqueCount: true, mainGrainMultiplication: 'multiplies', fields: [f('orders__country', 'string', { joined: { martId: 'o', label: 'Orders', aliasPath: 'orders', originalName: 'country' } })] };
const schema = Object.assign([f('id', 'string'), f('signup_date', 'date'), f('spend', 'number'), f('country', 'string'), ...orders.fields], { primaryKey: ['id'] }) as Schema;
const facts = (over: Partial<ShapeFacts> = {}): ShapeFacts => ({ schema, columns: ['country', 'signup_date', 'spend'], needed: new Set(['spend']), sources: [orders], hits: [], ...over });
const intent = (over: Partial<Intent> = {}): Intent => ({ ...EMPTY_INTENT, ...over });
const inp = (i: Intent) => ({ query: 'q', intent: i, hits: { marts: [], reports: [] }, model: { marts: new Map(), sources: [], edges: [], contexts: [], storages: [], failedStorages: [] } });
const choice = (c: string) => ({ type: 'choice' as const, choice: c });

describe('buildShapeQuestions', () => {
  it('asks aggregation and bucket questions only when grouped', () => {
    const { asked } = buildShapeQuestions(inp(intent({ breakdowns: ['country'] })), facts());
    expect(Object.keys(asked!.questions)).toEqual(expect.arrayContaining(['a0', 'b0']));
    const flat = buildShapeQuestions(inp(intent()), facts({ needed: new Set() }));
    expect(flat.asked).toBeNull();
  });
  it('asks the date question only with a time phrase', () => {
    expect(buildShapeQuestions(inp(intent({ time: 'last month' })), facts({ needed: new Set() })).asked!.questions.date).toBeDefined();
  });
  it('asks nothing for a value with one match, and a choice for several', () => {
    const one = buildShapeQuestions(inp(intent({ values: [{ text: 'DE', op: 'eq' }] })), facts({ needed: new Set(), hits: [[{ literal: 0, field: 'country', value: 'DE', op: 'eq' }]] }));
    expect(one.asked).toBeNull();
    const two = buildShapeQuestions(inp(intent({ values: [{ text: 'de', op: 'eq' }] })), facts({ needed: new Set(), hits: [[{ literal: 0, field: 'country', value: 'DE', op: 'eq' }, { literal: 0, field: 'country', value: 'de', op: 'eq' }]] }));
    expect(Object.keys((two.asked!.questions.v0 as { criteria: object }).criteria)).toEqual(['m0', 'm1', 'none']);
  });
  it('asks filter or slice only on a one-to-many joined field', () => {
    const r = buildShapeQuestions(inp(intent({ values: [{ text: 'DE', op: 'eq' }] })), facts({ needed: new Set(), hits: [[{ literal: 0, field: 'orders__country', value: 'DE', op: 'eq' }]] }));
    expect(r.asked!.questions.s0).toBeDefined();
  });
});

describe('applyShape', () => {
  it('applies a single value match as a filter without asking', () => {
    const fx = facts({ needed: new Set(), hits: [[{ literal: 0, field: 'country', value: 'DE', op: 'eq' }]] });
    const i = intent({ values: [{ text: 'DE', op: 'eq' }] });
    const { plan } = buildShapeQuestions(inp(i), fx);
    expect(applyShape({}, plan, fx, i).filters).toEqual({ country: { field: 'country', op: 'eq', value: 'DE' } });
  });
  it('puts a joined value into slices when the answer is slice', () => {
    const fx = facts({ needed: new Set(), hits: [[{ literal: 0, field: 'orders__country', value: 'DE', op: 'eq' }]] });
    const i = intent({ values: [{ text: 'DE', op: 'eq' }] });
    const { plan } = buildShapeQuestions(inp(i), fx);
    const g = applyShape({ s0: choice('slice') }, plan, fx, i);
    expect(g.slices).toEqual({ orders__country: { field: 'orders__country', op: 'eq', value: 'DE' } });
    expect(g.filters).toEqual({});
  });
  it('groups with the chosen function and bucket and sorts by the first measure', () => {
    const i = intent({ breakdowns: ['week'] });
    const { plan } = buildShapeQuestions(inp(i), facts());
    const g = applyShape({ a0: choice('SUM'), b0: choice('WEEK') }, plan, facts(), i);
    expect(g.aggregations).toEqual([{ column: 'spend', function: 'SUM' }]);
    expect(g.dateTrunc).toEqual([{ column: 'signup_date', unit: 'WEEK' }]);
    expect(g.sorts).toEqual([{ field: 'spend', direction: 'desc' }]);
  });
  it('applies a relative date preset', () => {
    const i = intent({ time: 'last 30 days' });
    const fx = facts({ needed: new Set() });
    const { plan } = buildShapeQuestions(inp(i), fx);
    expect(applyShape({ date: choice('last_n_days:30') }, plan, fx, i).filters.signup_date).toEqual({ field: 'signup_date', op: 'relative', value: { kind: 'last_n_days', n: 30 } });
  });
  it('limits the rows for a top-n ranking', () => {
    const i = intent({ ranking: { direction: 'desc', n: 10 } });
    const fx = facts({ needed: new Set() });
    const { plan } = buildShapeQuestions(inp(i), fx);
    const g = applyShape({ o: choice('c2') }, plan, fx, i);
    expect(g).toMatchObject({ limit: 10, sorts: [{ field: 'spend', direction: 'desc' }] });
  });
  it('skips a threshold under grouping, since that would be a HAVING filter', () => {
    const i = intent({ breakdowns: ['country'], values: [{ text: '1000', op: 'gt' }] });
    const { plan } = buildShapeQuestions(inp(i), facts());
    expect(plan.thresholds).toEqual([]);
  });
  it('without answers keeps the columns with no filters or grouping', () => {
    const i = intent({ breakdowns: ['country'], time: 'last month' });
    const { plan } = buildShapeQuestions(inp(i), facts());
    const g = applyShape({}, plan, facts(), i);
    expect(g).toMatchObject({ columns: ['country', 'signup_date', 'spend'], filters: {} });
    expect(g.aggregations).toBeUndefined();
  });
});
