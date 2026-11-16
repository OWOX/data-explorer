import type { ColumnFilter } from '../filters/build';
import type { Field } from '../model/types';
import { buildAiPrompt, describeFilter } from './ai-prompt';

const f = (name: string, category: Field['category'], type = 'STRING'): Field => ({ name, alias: null, type, category, description: null, isPrimaryKey: false });
const schema: Field[] = [f('id', 'string'), f('created_at', 'date', 'TIMESTAMP'), f('status', 'string'), f('amount', 'number', 'NUMERIC'), f('paid', 'boolean', 'BOOLEAN'), f('customers__city', 'string')];

test.each<[ColumnFilter, string]>([
  [{ field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 30 } }, 'created_at is in the last 30 days'],
  [{ field: 'created_at', op: 'relative', value: { kind: 'today' } }, 'created_at is today'],
  [{ field: 'created_at', op: 'relative', value: { kind: 'this_month' } }, 'created_at is in this month'],
  [{ field: 'status', op: 'eq', value: 'paid' }, 'status equals paid'],
  [{ field: 'status', op: 'contains', value: 'pa' }, 'status contains pa'],
  [{ field: 'amount', op: 'gte', value: '10' }, 'amount is at least 10'],
  [{ field: 'amount', op: 'between', value: { from: 1, to: 5 } }, 'amount is between 1 and 5'],
  [{ field: 'created_at', op: 'before', value: '2026-01-01' }, 'created_at is before 2026-01-01'],
  [{ field: 'status', op: 'is_blank' }, 'status is blank'],
  [{ field: 'paid', op: 'is_true' }, 'paid is true'],
])('a filter reads as plain words: %j', (filter, words) => {
  expect(describeFilter(filter)).toBe(words);
});

test('the prompt names the project, the mart, the shown columns in schema order, the filters and the sorts', () => {
  const prompt = buildAiPrompt({
    projectId: 'p1', projectTitle: 'Acme', martId: 'orders', martTitle: 'Orders', schema,
    visible: ['customers__city', 'id', 'created_at'],
    filters: [{ field: 'status', op: 'eq', value: 'paid' }, { field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 30 } }],
    sorts: [{ field: 'created_at', direction: 'desc' }, { field: 'amount', direction: 'asc' }],
  });
  expect(prompt).toBe([
    'Using the OWOX Data Marts connector, in the OWOX project Acme (project id p1):',
    'Query the data mart "Orders" (id orders).',
    'Fields: id, created_at, customers__city.',
    'Filters: status equals paid; created_at is in the last 30 days.',
    'Sort: created_at descending, then amount ascending.',
    'Show the result as a table, and say if rows were truncated.',
  ].join('\n'));
});

test('without a project title the id stands in, and no filters or sorts read as none', () => {
  const prompt = buildAiPrompt({ projectId: 'p1', martId: 'orders', martTitle: 'Orders', schema, visible: ['id'], filters: [], sorts: [] });
  expect(prompt).toContain('in the OWOX project p1 (project id p1):');
  expect(prompt).toContain('Filters: none.');
  expect(prompt).toContain('Sort: none.');
});
