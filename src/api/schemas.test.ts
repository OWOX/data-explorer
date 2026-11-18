import { vi } from 'vitest';
import { createSchemaLoader } from './schemas';
import { stubCtx } from './test-ctx';

const detail = (id: string) => ({
  id,
  schema: { fields: [
    { name: 'id', type: 'INT64', isPrimaryKey: true },
    { name: 'secret', type: 'STRING', isHiddenForReporting: true },
    { name: 'name', type: 'STRING', alias: 'Name', description: 'n' },
  ] },
});

test('get() maps the fields reporting may use (none hidden for reporting), and caches by id', async () => {
  const getJson = vi.fn(async (path: string) => detail(path.split('/').pop()!));
  const loader = createSchemaLoader(stubCtx({ getJson }));
  const a = await loader.get('a');
  await loader.get('a');
  expect(getJson).toHaveBeenCalledTimes(1);
  expect(getJson).toHaveBeenCalledWith('/api/data-marts/a');
  expect(a).toEqual([
    { name: 'id', alias: null, type: 'INT64', category: 'number', description: null, isPrimaryKey: true },
    { name: 'name', alias: 'Name', type: 'STRING', category: 'string', description: 'n', isPrimaryKey: false },
  ]);
});

test('get() drops DISCONNECTED fields but keeps and flags calculated ones', async () => {
  const getJson = vi.fn(async () => ({ id: 'a', schema: { fields: [
    { name: 'id', type: 'INT64', status: 'CONNECTED' },
    { name: 'gone', type: 'STRING', status: 'DISCONNECTED' },
    { name: 'margin', type: 'NUMERIC', status: 'DISCONNECTED', calculated: { level: 'column' } },
  ] } }));
  const schema = await createSchemaLoader(stubCtx({ getJson })).get('a');
  expect(schema.map((f) => f.name)).toEqual(['id', 'margin']);
  expect(schema.find((f) => f.name === 'margin')!.isCalculated).toBe(true);
});

test('prefetch() loads every id, priority ids first, and notifies subscribers', async () => {
  const order: string[] = [];
  const getJson = vi.fn(async (path: string) => { const id = path.split('/').pop()!; order.push(id); return detail(id); });
  const loader = createSchemaLoader(stubCtx({ getJson }));
  const seen = vi.fn();
  loader.subscribe(seen);
  await loader.prefetch(['x', 'y', 'z'], ['z']);
  expect(order[0]).toBe('z');
  expect(loader.peek('y')).toBeDefined();
  expect(seen).toHaveBeenCalled();
});

test('a failed schema fetch is not cached', async () => {
  const getJson = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(detail('a'));
  const loader = createSchemaLoader(stubCtx({ getJson }));
  await expect(loader.get('a')).rejects.toThrow('boom');
  await expect(loader.get('a')).resolves.toHaveLength(2);
});

test('a REPEATED field is category other, so it only offers blank filters', async () => {
  const getJson = vi.fn(async () => ({ id: 'a', schema: { fields: [
    { name: 'tags', type: 'STRING', mode: 'REPEATED' },
    { name: 'name', type: 'STRING', mode: 'NULLABLE' },
  ] } }));
  const schema = await createSchemaLoader(stubCtx({ getJson })).get('a');
  expect(schema.map((f) => [f.name, f.category])).toEqual([['tags', 'other'], ['name', 'string']]);
});

test('get() carries a field\'s allowed aggregations, only the functions this build knows', async () => {
  const getJson = vi.fn(async () => ({ id: 'a', schema: { fields: [
    { name: 'amount', type: 'NUMERIC', allowedAggregations: ['P50', 'SUM', 'FUTURE'] },
    { name: 'plain', type: 'NUMERIC' },
  ] } }));
  const s = await createSchemaLoader(stubCtx({ getJson })).get('a');
  expect(s[0]!.allowedAggregations).toEqual(['SUM', 'P50']);
  expect('allowedAggregations' in s[1]!).toBe(false);
});

test('invalidate forgets a mart, so the next get reads the backend again', async () => {
  const getJson = vi.fn(async (path: string) => detail(path.split('/').pop()!));
  const loader = createSchemaLoader(stubCtx({ getJson }));
  await loader.get('a');
  loader.invalidate('a');
  expect(loader.peek('a')).toBeUndefined();
  await loader.get('a');
  expect(getJson).toHaveBeenCalledTimes(2);
});

test('a read that was in flight when the mart was invalidated is not remembered, and does not notify', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const getJson = vi.fn(async (path: string) => { if (getJson.mock.calls.length === 1) await gate; return detail(path.split('/').pop()!); });
  const loader = createSchemaLoader(stubCtx({ getJson }));
  const told = vi.fn();
  loader.subscribe(told);
  const stale = loader.get('a');
  loader.invalidate('a');
  release();
  await stale;
  expect(loader.peek('a')).toBeUndefined();
  expect(told).not.toHaveBeenCalled();
  await loader.get('a');
  expect(getJson).toHaveBeenCalledTimes(2);
  expect(loader.peek('a')).toBeDefined();
});
