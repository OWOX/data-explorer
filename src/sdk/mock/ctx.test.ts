import { createMockCtx } from './ctx';
import { demoFixtures } from './fixtures';
import { loadModel } from '../../api/model';
import { readRows } from '../../api/rows';

test('mock ctx serves a model loadModel understands', async () => {
  const model = await loadModel(createMockCtx(demoFixtures()));
  expect(model.marts.size).toBe(16);
  expect(model.marts.get('secret_ledger')!.accessible).toBe(false);
  expect(model.edges.filter((e) => e.target === 'orders')).toHaveLength(4);
  expect(model.contexts.map((c) => c.id)).toEqual(['c-sales', 'c-catalog', 'c-marketing']);
});

test('traverseData applies column, filter, limit and count options', async () => {
  const ctx = createMockCtx(demoFixtures());
  const rows = await readRows(ctx, 'orders', { column: ['id', 'status'], filter: [{ column: 'id', operator: 'lte', value: 3 }], limit: 2 });
  expect(rows).toEqual([expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 })]);
  expect(Object.keys(rows[0]!)).toEqual(['id', 'status']);
  expect(await readRows(ctx, 'orders', { uniqueCount: [''] })).toEqual([{ 'Unique Count': 450 }]);
  expect(await readRows(ctx, 'daily_kpis', { column: ['day'], aggregation: [{ column: 'day', function: 'COUNT' }] })).toEqual([{ 'day | COUNT': 30 }]);
});

test('reading an inaccessible mart rejects', async () => {
  await expect(readRows(createMockCtx(demoFixtures()), 'secret_ledger', {})).rejects.toThrow(/access/i);
});

test('collections round-trip in memory', async () => {
  const col = createMockCtx(demoFixtures()).collections<{ n: number }>('row-counts');
  await col.put('a', { n: 1 });
  expect(await col.get('a')).toEqual({ document: { n: 1 } });
  expect(await col.get('b')).toBeNull();
});

test('fixture facts later tasks rely on', () => {
  const f = demoFixtures();
  const orders = f.marts.find((m) => m.id === 'orders')!;
  expect(orders.rows).toHaveLength(450);
  expect(orders.rows.map((r) => r.id)).toEqual(Array.from({ length: 450 }, (_, i) => i + 1));
  expect(orders.fields.map((x) => x.name)).toEqual(['id', 'customer_id', 'product_id', 'store_id', 'status', 'amount', 'created_at', 'is_gift']);
  expect(f.marts.find((m) => m.id === 'daily_kpis')!.title).toBe('Daily KPIs');
  const nameLike = /^[A-Z][a-z]+ [A-Z][a-z]+$/;
  for (const m of f.marts) {
    const hit = m.rows.some((r) => Object.values(r).some((v) => typeof v === 'string' && nameLike.test(v)));
    expect(hit).toBe(m.id === 'customers');
  }
});
