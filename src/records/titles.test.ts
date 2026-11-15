import { vi } from 'vitest';
import { lookupTitles } from './titles';
import { relationshipColumns } from './relationships';
import { stubCtx, traversalOf } from '../api/test-ctx';
import type { Field } from '../model/types';

const schema: Field[] = [
  { name: 'id', alias: null, type: 'INT64', category: 'number', description: null, isPrimaryKey: true },
  { name: 'name', alias: null, type: 'STRING', category: 'string', description: null, isPrimaryKey: false },
];
const rel = relationshipColumns('orders', [{ id: 'e', source: 'orders', target: 'customers', joins: [{ sourceField: 'customer_id', targetField: 'id' }] }]).get('customer_id')!;

test('queries distinct non-blank values with in and maps value → title', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ id: 1, name: 'Ann' }, { id: 2, name: 'Bob' }]));
  const res = await lookupTitles(stubCtx({ dataMarts: { list: vi.fn(), traverseData } }), rel, [1, 2, 2, null, '', 1], schema);
  expect(traverseData).toHaveBeenCalledWith('customers', { column: ['id', 'name'], filter: [{ column: 'id', operator: 'in', value: [1, 2] }], limit: 2 });
  expect(res).toEqual(new Map([['1', 'Ann'], ['2', 'Bob']]));
});

test('splits more than 500 values into batches', async () => {
  const traverseData = vi.fn<(id: string, opts: unknown) => Promise<ReturnType<typeof traversalOf>>>(async () => traversalOf([]));
  const values = Array.from({ length: 1201 }, (_, i) => i + 1);
  await lookupTitles(stubCtx({ dataMarts: { list: vi.fn(), traverseData } }), rel, values, schema);
  expect(traverseData).toHaveBeenCalledTimes(3);
  expect((traverseData.mock.calls[0]![1] as { filter: { value: number[] }[] }).filter[0]!.value).toHaveLength(500);
});

test('no title field, composite, or no values → no query', async () => {
  const traverseData = vi.fn();
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  expect((await lookupTitles(ctx, rel, [1], [schema[0]!])).size).toBe(0);
  expect((await lookupTitles(ctx, { ...rel, composite: true }, [1], schema)).size).toBe(0);
  expect((await lookupTitles(ctx, rel, [null], schema)).size).toBe(0);
  expect(traverseData).not.toHaveBeenCalled();
});

test('string ids are sent as strings', async () => {
  const traverseData = vi.fn<(id: string, opts: unknown) => Promise<ReturnType<typeof traversalOf>>>(async () => traversalOf([]));
  const strSchema: Field[] = [{ ...schema[0]!, name: 'code', type: 'STRING', category: 'string' }, schema[1]!];
  const strRel = { ...rel, relatedField: 'code' };
  await lookupTitles(stubCtx({ dataMarts: { list: vi.fn(), traverseData } }), strRel, ['UA', 'PL'], strSchema);
  expect(traverseData.mock.calls[0]![1]).toMatchObject({ filter: [{ column: 'code', operator: 'in', value: ['UA', 'PL'] }] });
});
