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
  expect([...a]).toEqual([
    { name: 'id', alias: null, type: 'INT64', category: 'number', description: null, isPrimaryKey: true },
    { name: 'name', alias: 'Name', type: 'STRING', category: 'string', description: 'n', isPrimaryKey: false },
  ]);
});

test('get() records the declared key, a key hidden for reporting included, while the field stays out of the schema', async () => {
  const getJson = vi.fn(async () => ({ id: 'a', schema: { fields: [
    { name: 'id', type: 'INT64', isPrimaryKey: true, isHiddenForReporting: true },
    { name: 'name', type: 'STRING' },
  ] } }));
  const schema = await createSchemaLoader(stubCtx({ getJson })).get('a');
  expect(schema.map((x) => x.name)).toEqual(['name']);
  expect(schema.primaryKey).toEqual(['id']);
});

test('a key with a disconnected component is no key, as the backend counts it', async () => {
  const getJson = vi.fn(async () => ({ id: 'a', schema: { fields: [
    { name: 'a', type: 'INT64', isPrimaryKey: true },
    { name: 'b', type: 'INT64', isPrimaryKey: true, status: 'DISCONNECTED' },
  ] } }));
  expect((await createSchemaLoader(stubCtx({ getJson })).get('a')).primaryKey).toEqual([]);
});

test('the declared key follows the backend: nested components by path, calculated ones connected, a disconnected parent loses the key', async () => {
  const one = (fields: unknown) => createSchemaLoader(stubCtx({ getJson: vi.fn(async () => ({ id: 'a', schema: { fields } })) })).get('a');
  expect((await one([{ name: 'r', type: 'RECORD', fields: [{ name: 'k', type: 'INT64', isPrimaryKey: true }] }])).primaryKey).toEqual(['r.k']);
  expect((await one([{ name: 'k', type: 'INT64', isPrimaryKey: true, status: 'DISCONNECTED', calculated: { formula: '1' } }])).primaryKey).toEqual(['k']);
  expect((await one([{ name: 'r', type: 'RECORD', status: 'DISCONNECTED', fields: [{ name: 'k', type: 'INT64', isPrimaryKey: true }] }])).primaryKey).toEqual([]);
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

test('a read that was in flight when the mart was invalidated is not remembered', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const getJson = vi.fn(async (path: string) => { if (getJson.mock.calls.length === 1) await gate; return detail(path.split('/').pop()!); });
  const loader = createSchemaLoader(stubCtx({ getJson }));
  const stale = loader.get('a');
  loader.invalidate('a');
  release();
  await stale;
  expect(loader.peek('a')).toBeUndefined();
  await loader.get('a');
  expect(getJson).toHaveBeenCalledTimes(2);
  expect(loader.peek('a')).toBeDefined();
});

test('a read in flight before clear() is not served after it', async () => {
  const resolvers: Array<(v: unknown) => void> = [];
  const getJson = vi.fn(() => new Promise((res) => { resolvers.push(res); }));
  const loader = createSchemaLoader(stubCtx({ getJson }));
  const before = loader.get('a');
  loader.clear();
  const after = loader.get('a');
  expect(getJson).toHaveBeenCalledTimes(2);
  resolvers[0]!({ id: 'a', schema: { fields: [{ name: 'old', type: 'STRING' }] } });
  await before;
  expect(loader.peek('a')).toBeUndefined();
  resolvers[1]!({ id: 'a', schema: { fields: [{ name: 'new', type: 'STRING' }] } });
  expect((await after).map((f) => f.name)).toEqual(['new']);
  expect(loader.peek('a')!.map((f) => f.name)).toEqual(['new']);
});
