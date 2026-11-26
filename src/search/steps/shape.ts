import { cleanText } from '../../api/ai-prompt';
import type { JoinedSource } from '../../api/blendable';
import { sourceOfField } from '../../api/blendable';
import { PAGE_SIZE } from '../../config';
import type { ColumnFilter } from '../../filters/build';
import { allowedFunctions, DATE_BUCKETS, isAggFn, isDateBucket, type AggregationRule, type DateTruncRule } from '../../model/aggregation';
import type { Field, Schema } from '../../model/types';
import type { RelativeDatePreset } from '../../sdk/types';
import type { GridState } from '../../state/store';
import { pruneGrid } from '../../state/view-link-resolve';
import { choiceQ, MAX_QUESTIONS, type Answers, type Question } from '../decide';
import type { Intent } from '../intent';
import { matchTiers, readValues, VALUE_COLUMNS, VALUE_MATCHES } from '../valueMatch';
import { roleOf } from './fields';
import type { Asked, StepDeps, StepInput } from './types';

export type ValueHit = { literal: number; field: string; value: string; op: 'eq' | 'neq' };
export type ShapeFacts = { schema: Schema; columns: string[]; needed: Set<string>; sources: JoinedSource[]; hits: ValueHit[][] };
export type ShapePlan = {
  grouped: boolean; measures: Field[]; dateBreakdowns: Field[]; dateField: Field | null;
  valueQs: { qid: string; literal: number; options: Record<string, ValueHit> }[];
  thresholds: { qid: string; literal: number; op: 'gt' | 'gte' | 'lt' | 'lte'; value: number; options: Record<string, string> }[];
  placements: { qid: string; key: string }[];
  sortOptions: Record<string, string> | null;
};

export const DATE_OPTIONS: Record<string, RelativeDatePreset | null> = {
  none: null, today: { kind: 'today' }, yesterday: { kind: 'yesterday' }, this_week: { kind: 'this_week' }, last_week: { kind: 'last_week' },
  this_month: { kind: 'this_month' }, last_month: { kind: 'last_month' }, this_quarter: { kind: 'this_quarter' }, last_quarter: { kind: 'last_quarter' },
  this_year: { kind: 'this_year' }, 'last_n_days:7': { kind: 'last_n_days', n: 7 }, 'last_n_days:30': { kind: 'last_n_days', n: 30 },
  'last_n_days:90': { kind: 'last_n_days', n: 90 }, 'last_n_months:3': { kind: 'last_n_months', n: 3 }, 'last_n_months:6': { kind: 'last_n_months', n: 6 },
  'last_n_months:12': { kind: 'last_n_months', n: 12 },
} as Record<string, RelativeDatePreset | null>;

const shown = (facts: ShapeFacts) => { const by = new Map(facts.schema.map((f) => [f.name, f])); return facts.columns.flatMap((c) => (by.get(c) ? [by.get(c)!] : [])); };
const oneToMany = (facts: ShapeFacts, field: string) => { const s = sourceOfField(facts.sources).get(field); return !!s && s.mainGrainMultiplication !== 'none'; };

export function buildShapeQuestions(input: StepInput, facts: ShapeFacts): { asked: Asked; plan: ShapePlan } {
  const { intent } = input;
  const fields = shown(facts);
  const measures = fields.filter((f) => roleOf(f) === 'measure');
  const dateBreakdowns = fields.filter((f) => f.category === 'date' && !f.isCalculated);
  const grouped = intent.breakdowns.length > 0 || intent.measures.length > 0 || measures.some((m) => facts.needed.has(m.name));
  const dateField = dateBreakdowns[0] ?? facts.schema.find((f) => f.category === 'date' && !f.joined) ?? null;
  const q: Record<string, Question> = {};
  const plan: ShapePlan = { grouped, measures, dateBreakdowns, dateField, valueQs: [], thresholds: [], placements: [], sortOptions: null };

  if (grouped) {
    measures.forEach((m, i) => { const fns = allowedFunctions(m); if (fns.length) q[`a${i}`] = choiceQ(`How should measure ${i} be totalled for the query? Pick none to leave it ungrouped.`, Object.fromEntries([...fns.map((fn) => [fn, null]), ['none', null]])); });
    dateBreakdowns.forEach((_, i) => { q[`b${i}`] = choiceQ(`Which time bucket should date breakdown ${i} use for the query?`, Object.fromEntries([['none', null], ...DATE_BUCKETS.map((b) => [b, null])])); });
  }
  if (intent.time && dateField) q.date = choiceQ('Which date range does the query ask for? Pick none when it asks for no date range.', Object.fromEntries(Object.keys(DATE_OPTIONS).map((k) => [k, null])));

  intent.values.forEach((v, n) => {
    const hits = facts.hits[n] ?? [];
    if (hits.length > 1) {
      const options = Object.fromEntries(hits.map((h, i) => [`m${i}`, h]));
      plan.valueQs.push({ qid: `v${n}`, literal: n, options });
      q[`v${n}`] = choiceQ(`Which column and value does the query mean by value ${n}? Pick none when none fits.`, Object.fromEntries([...Object.keys(options).map((k) => [k, null]), ['none', null]]));
    }
    if (!grouped && (v.op === 'gt' || v.op === 'gte' || v.op === 'lt' || v.op === 'lte') && Number.isFinite(Number(v.text)) && measures.length) {
      const options = Object.fromEntries(measures.map((m, i) => [`c${i}`, m.name]));
      plan.thresholds.push({ qid: `t${n}`, literal: n, op: v.op, value: Number(v.text), options });
      q[`t${n}`] = choiceQ(`Which number column does the threshold in value ${n} apply to? Pick none when none fits.`, Object.fromEntries([...Object.keys(options).map((k) => [k, null]), ['none', null]]));
    }
    if (hits.some((h) => oneToMany(facts, h.field))) {
      plan.placements.push({ qid: `s${n}`, key: `v${n}` });
      q[`s${n}`] = choiceQ(`Value ${n} is on a joined data mart that has many rows per main row.`, { filter: 'Keep only main rows that have a matching joined row.', slice: 'Keep every main row and count only the matching joined rows.' });
    }
  });
  if (intent.time && dateField?.joined && oneToMany(facts, dateField.name)) {
    plan.placements.push({ qid: 'sd', key: 'date' });
    q.sd = choiceQ('The date range is on a joined data mart that has many rows per main row.', { filter: 'Keep only main rows that have a joined row in the range.', slice: 'Keep every main row and count only the joined rows in the range.' });
  }
  if (intent.ranking && fields.length >= 2) {
    plan.sortOptions = Object.fromEntries(fields.map((f, i) => [`c${i}`, f.name]));
    q.o = choiceQ(`Which column ranks the rows (${intent.ranking.direction === 'desc' ? 'highest' : 'lowest'} first)?`, Object.fromEntries(Object.keys(plan.sortOptions).map((k) => [k, null])));
  }

  const ids = Object.keys(q).slice(0, MAX_QUESTIONS);
  const asked: Asked = ids.length ? {
    questions: Object.fromEntries(ids.map((id) => [id, q[id]!])),
    state: {
      query: cleanText(input.query, 256), intent,
      measures: measures.map((m, i) => ({ id: `measure ${i}`, name: cleanText(m.joined?.originalName ?? m.name, 120), alias: cleanText(m.alias, 120), description: cleanText(m.description, 120) })),
      dateBreakdowns: dateBreakdowns.map((d, i) => ({ id: `date breakdown ${i}`, name: cleanText(d.name, 120) })),
      values: intent.values.map((v, n) => ({ id: `value ${n}`, text: v.text, op: v.op, matches: (facts.hits[n] ?? []).map((h, i) => ({ option: `m${i}`, column: cleanText(h.field, 120), value: cleanText(h.value, 120) })) })),
      columns: fields.map((f, i) => ({ option: `c${i}`, name: cleanText(f.name, 120), alias: cleanText(f.alias, 120) })),
    },
  } : null;
  return { asked, plan };
}

const placed = (answers: Answers, plan: ShapePlan, key: string): 'filter' | 'slice' => {
  const p = plan.placements.find((x) => x.key === key);
  const a = p ? answers[p.qid] : undefined;
  return a?.type === 'choice' && a.choice === 'slice' ? 'slice' : 'filter';
};

export function applyShape(answers: Answers, plan: ShapePlan, facts: ShapeFacts, intent: Intent): GridState {
  const filters: Record<string, ColumnFilter> = {};
  const slices: Record<string, ColumnFilter> = {};
  const put = (key: string, filter: ColumnFilter) => {
    const joined = !!facts.schema.find((f) => f.name === filter.field)?.joined;
    (joined && placed(answers, plan, key) === 'slice' ? slices : filters)[filter.field] = filter;
  };
  intent.values.forEach((_, n) => {
    const hits = facts.hits[n] ?? [];
    let hit: ValueHit | undefined;
    if (hits.length === 1) hit = hits[0];
    else { const vq = plan.valueQs.find((x) => x.literal === n); const a = vq && answers[vq.qid]; if (a?.type === 'choice' && a.choice !== 'none') hit = vq!.options[a.choice]; }
    if (hit) put(`v${n}`, { field: hit.field, op: hit.op, value: hit.value });
  });
  for (const t of plan.thresholds) { const a = answers[t.qid]; if (a?.type === 'choice' && a.choice !== 'none' && t.options[a.choice]) filters[t.options[a.choice]!] = { field: t.options[a.choice]!, op: t.op, value: t.value }; }
  const d = answers.date;
  if (d?.type === 'choice' && plan.dateField && DATE_OPTIONS[d.choice]) put('date', { field: plan.dateField.name, op: 'relative', value: DATE_OPTIONS[d.choice]! });

  const aggregations: AggregationRule[] = [];
  const dateTrunc: DateTruncRule[] = [];
  if (plan.grouped) {
    plan.measures.forEach((m, i) => { const a = answers[`a${i}`]; if (a?.type === 'choice' && isAggFn(a.choice)) aggregations.push({ column: m.name, function: a.choice }); });
    plan.dateBreakdowns.forEach((b, i) => { const a = answers[`b${i}`]; if (a?.type === 'choice' && isDateBucket(a.choice)) dateTrunc.push({ column: b.name, unit: a.choice }); });
  }
  let sorts: GridState['sorts'] = null;
  let limit = PAGE_SIZE;
  const o = answers.o;
  if (plan.sortOptions && o?.type === 'choice' && plan.sortOptions[o.choice] && intent.ranking) {
    sorts = [{ field: plan.sortOptions[o.choice]!, direction: intent.ranking.direction }];
    if (intent.ranking.n && intent.ranking.n < PAGE_SIZE) limit = intent.ranking.n;
  } else if (aggregations.length) sorts = [{ field: aggregations[0]!.column, direction: 'desc' }];

  const grid: GridState = {
    columns: facts.columns, filters, sorts, limit,
    ...(Object.keys(slices).length ? { slices } : {}),
    ...(aggregations.length ? { aggregations } : {}),
    ...(dateTrunc.length ? { dateTrunc } : {}),
  };
  return pruneGrid(grid, facts.schema).grid ?? grid;
}

/** For each intent value with eq or neq: its matches among the real top values of up to 6 text breakdowns. */
export async function findValueHits(input: StepInput, deps: StepDeps, mainId: string, facts: Omit<ShapeFacts, 'hits'>): Promise<ValueHit[][]> {
  const literals = input.intent.values.map((v, n) => ({ v, n })).filter(({ v }) => v.op === 'eq' || v.op === 'neq');
  if (!literals.length) return input.intent.values.map(() => []);
  const text = shown({ ...facts, hits: [] }).filter((f) => f.category === 'string').slice(0, VALUE_COLUMNS);
  const values = await Promise.all(text.map(async (f) => ({ f, values: await readValues(deps.ctx, mainId, f, deps.signal) })));
  return input.intent.values.map((v, n) => {
    if (!literals.some((l) => l.n === n)) return [];
    const tiers = values.map(({ f, values: vs }) => ({ f, tiers: matchTiers(v.text, vs) }));
    const best = [0, 1, 2].find((t) => tiers.some((x) => x.tiers[t]!.length));
    if (best === undefined) return [];
    return tiers.flatMap(({ f, tiers: ts }) => ts[best]!.map((value) => ({ literal: n, field: f.name, value, op: v.op as 'eq' | 'neq' }))).slice(0, VALUE_MATCHES);
  });
}

/** Step 4: value lookups in code, then one decision for grouping, dates, ambiguous values, thresholds, filter-or-slice and sort. */
export async function runShape(input: StepInput, deps: StepDeps, mainId: string, base: Omit<ShapeFacts, 'hits'>): Promise<{ grid: GridState; failed: boolean }> {
  const facts: ShapeFacts = { ...base, hits: await findValueHits(input, deps, mainId, base) };
  const { asked, plan } = buildShapeQuestions(input, facts);
  if (!asked) return { grid: applyShape({}, plan, facts, input.intent), failed: false };
  try {
    return { grid: applyShape(await deps.decide(asked.questions, asked.state, deps.signal), plan, facts, input.intent), failed: false };
  } catch {
    return { grid: { columns: base.columns, filters: {}, sorts: null, limit: PAGE_SIZE }, failed: true };
  }
}
