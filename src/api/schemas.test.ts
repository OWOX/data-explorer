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

test('get() maps reporting-visible fields and caches by id', async () => {
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
