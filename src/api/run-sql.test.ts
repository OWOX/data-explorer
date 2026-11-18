import { readRunSql } from './run-sql';
import { stubCtx } from './test-ctx';

const notFound = () => Object.assign(new Error('nf'), { payload: { status: 404 } });

test('reads executionSqlQuery from the run', async () => {
  const ctx = stubCtx();
  ctx.owox.getJson = vi.fn(async () => ({ additionalParams: { httpData: { executionSqlQuery: 'SELECT 1' } } })) as never;
  expect(await readRunSql(ctx, 'orders', 'r1')).toEqual({ sql: 'SELECT 1' });
  expect(ctx.owox.getJson).toHaveBeenCalledWith('/api/data-marts/orders/runs/r1');
});

test('a run not saved yet is asked again, then read', async () => {
  const ctx = stubCtx();
  const get = vi.fn().mockRejectedValueOnce(notFound()).mockResolvedValueOnce({ additionalParams: { httpData: { executionSqlQuery: 'SELECT 2' } } });
  ctx.owox.getJson = get as never;
  expect(await readRunSql(ctx, 'orders', 'r1', { waitMs: 0 })).toEqual({ sql: 'SELECT 2' });
  expect(get).toHaveBeenCalledTimes(2);
});

test('still not found after the retries, or another error: the SQL could not be read', async () => {
  const ctx = stubCtx();
  ctx.owox.getJson = vi.fn().mockRejectedValue(notFound()) as never;
  expect(await readRunSql(ctx, 'orders', 'r1', { waitMs: 0, retries: 2 })).toEqual({ reason: 'The SQL could not be read from OWOX' });
  expect(ctx.owox.getJson).toHaveBeenCalledTimes(3);
  ctx.owox.getJson = vi.fn().mockRejectedValue(new Error('boom')) as never;
  expect(await readRunSql(ctx, 'orders', 'r1', { waitMs: 0 })).toEqual({ reason: 'The SQL could not be read from OWOX' });
  expect(ctx.owox.getJson).toHaveBeenCalledTimes(1);
});

test('a run without SQL says so', async () => {
  const ctx = stubCtx();
  ctx.owox.getJson = vi.fn(async () => ({ additionalParams: { httpData: {} } })) as never;
  expect(await readRunSql(ctx, 'orders', 'r1')).toEqual({ reason: 'OWOX did not record the SQL of this query' });
});
