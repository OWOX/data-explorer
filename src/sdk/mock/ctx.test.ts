import { createMockCtx } from './ctx';
import { demoFixtures } from './fixtures';
import { loadModel } from '../../api/model';
import { readRows } from '../../api/rows';
import type { BlendableSchemaDto } from '../types';

test('mock ctx serves a model loadModel understands', async () => {
  const model = await loadModel(createMockCtx(demoFixtures()));
  expect(model.marts.size).toBe(20);
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
  expect(await readRows(ctx, 'daily_kpis', { column: ['day'], aggregation: [{ column: 'day', function: 'MIN' }] })).toEqual([expect.objectContaining({ 'day | MIN': expect.anything() })]);
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
  expect(orders.fields.map((x) => x.name)).toEqual(['id', 'customer_id', 'product_id', 'store_id', 'status', 'amount', 'created_at', 'is_gift', 'acquisition_session_id', 'net_revenue']);
  expect(f.marts.find((m) => m.id === 'daily_kpis')!.title).toBe('Daily KPIs');
  // orders (status) and categories (aliased label) are labelled by design; only payments and daily_kpis lack any string label.
  const labelled = (m: (typeof f.marts)[number]) => m.fields.some((x) => x.type === 'STRING' && !x.isPrimaryKey && !x.name.endsWith('_id') && !x.isHiddenForReporting);
  expect(f.marts.filter((m) => !labelled(m)).map((m) => m.id).sort()).toEqual(['daily_kpis', 'payments']);
  for (const id of ['returns', 'shipments', 'ad_spend', 'secret_ledger']) {
    expect(f.marts.find((m) => m.id === id)!.fields.some((x) => x.name === 'name' && x.type === 'STRING')).toBe(true);
  }
});

test('traverseData sorts by several keys, in order, each with its own direction, numbers by value', async () => {
  const ctx = createMockCtx(demoFixtures());
  const rows = await readRows(ctx, 'orders', { column: ['id', 'status', 'amount'], sort: [{ column: 'status', direction: 'asc' }, { column: 'id', direction: 'desc' }], limit: 450 });
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]!, b = rows[i]!;
    const c = String(a.status).localeCompare(String(b.status));
    expect(c <= 0).toBe(true);
    if (c === 0) expect(Number(a.id)).toBeGreaterThan(Number(b.id));
  }
  const byAmount = await readRows(ctx, 'orders', { column: ['amount'], sort: [{ column: 'amount', direction: 'asc' }], limit: 450 });
  const amounts = byAmount.map((r) => Number(r.amount));
  expect(amounts).toEqual([...amounts].sort((x, y) => x - y));
});

test('blendable-schema lists the marts an order joins to, with their fields as blended names', async () => {
  const dto = await createMockCtx(demoFixtures()).owox.getJson<BlendableSchemaDto>('/api/data-marts/orders/blendable-schema');
  const sources = dto.availableSources!;
  expect(sources.filter((s) => s.depth === 1).map((s) => s.aliasPath).sort()).toEqual(['customers', 'products', 'stores']);
  expect(sources.every((s) => s.isIncluded && s.isAccessibleForReporting)).toBe(true);
  // Countries is reached twice, through customers and through stores: two sources, told apart by their alias path.
  expect(sources.filter((s) => s.dataMartId === 'countries').map((s) => s.aliasPath).sort()).toEqual(['customers.countries', 'stores.countries']);
  const names = dto.blendedFields!.map((b) => b.name);
  expect(names).toEqual(expect.arrayContaining(['customers__email', 'products__sku', 'stores__city', 'customers__countries__name']));
  expect(names).not.toContain('customers__internal_flag'); // hidden for reporting
  expect(dto.hiddenFieldNames).toContain('customers__internal_flag');
  expect(dto.blendedFields!.find((b) => b.name === 'products__title')).toMatchObject({ alias: 'Name', aliasPath: 'products', sourceDataMartId: 'products', originalFieldName: 'title' });
  await expect(createMockCtx(demoFixtures()).owox.getJson('/api/data-marts/nope/blendable-schema')).rejects.toThrow();
});

test('traverseData resolves blended columns, filters and sorts by joining on the link', async () => {
  const ctx = createMockCtx(demoFixtures());
  const rows = await readRows(ctx, 'orders', { column: ['id', 'customer_id', 'customers__email', 'customers__countries__name', 'products__title'], filter: [{ column: 'id', operator: 'lte', value: 3 }] });
  const customers = demoFixtures().marts.find((m) => m.id === 'customers')!.rows;
  for (const r of rows) {
    const c = customers.find((x) => x.id === r.customer_id);
    expect(r.customers__email).toBe(c?.email ?? null);
    expect(r.products__title).toEqual(expect.any(String));
  }
  const filtered = await readRows(ctx, 'orders', { column: ['id', 'stores__city'], filter: [{ column: 'stores__city', operator: 'eq', value: 'Berlin' }], limit: 450 });
  expect(filtered.length).toBeGreaterThan(0);
  expect(filtered.every((r) => r.stores__city === 'Berlin')).toBe(true);
  const sorted = await readRows(ctx, 'orders', { column: ['id', 'products__title'], sort: [{ column: 'products__title', direction: 'asc' }], limit: 450 });
  const titles = sorted.map((r) => String(r.products__title));
  expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
});

test('an order that names no customer joins to nothing, not to a wrong row', async () => {
  const rows = await readRows(createMockCtx(demoFixtures()), 'orders', { column: ['id', 'customers__name'], filter: [{ column: 'id', operator: 'eq', value: 7 }] });
  expect(rows).toEqual([{ id: 7, customers__name: null }]);
});

test('a field hidden for reporting is rejected like the backend does, in column, filter and sort, also joined and in a report', async () => {
  const ctx = createMockCtx(demoFixtures());
  await expect(readRows(ctx, 'customers', { column: ['id', 'internal_flag'] })).rejects.toThrow(/Unknown column/);
  await expect(readRows(ctx, 'customers', { column: ['id'], filter: [{ column: 'internal_flag', operator: 'is_blank' }] })).rejects.toThrow(/Unknown column/);
  await expect(readRows(ctx, 'customers', { column: ['id'], sort: [{ column: 'internal_flag', direction: 'asc' }] })).rejects.toThrow(/Unknown column/);
  await expect(readRows(ctx, 'orders', { column: ['id', 'customers__internal_flag'] })).rejects.toThrow(/Unknown column/);
  await expect(ctx.owox.postJson('/api/reports', { dataMartId: 'customers', columnConfig: ['id', 'internal_flag'] })).rejects.toThrow(/Unknown column/);
  await expect(readRows(ctx, 'customers', { column: ['id', 'email'], limit: 1 })).resolves.toHaveLength(1);
});

test('the mock /api/search ranks a title hit above a description hit, honours limit and refuses a one-letter query', async () => {
  const ctx = createMockCtx(demoFixtures());
  const hits = await ctx.owox.getJson<{ entityId: string; finalScore: number }[]>('/api/search', { q: 'orders', entityTypes: 'DATA_MART', excludeDrafts: 'true', limit: '3' });
  expect(hits).toHaveLength(3);
  expect(hits[0]!.entityId).toBe('orders');
  expect(hits.map((h) => h.finalScore)).toEqual([...hits.map((h) => h.finalScore)].sort((a, b) => b - a));
  expect(await ctx.owox.getJson('/api/search', { q: 'zzzz qqqq' })).toEqual([]);
  await expect(ctx.owox.getJson('/api/search', { q: 'a' })).rejects.toThrow(/between 2 and 256/);
});

test('the mock AI answers deterministically from the question document; ai: false leaves no credential', async () => {
  const ai = createMockCtx(demoFixtures()).credentials!.ai!;
  expect(ai.reasoning).toBeDefined();
  const ask = async (doc: object) => JSON.parse((await ai.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(doc) }] }] })).content[0]!.text!);
  expect(await ask({ task: 'discover', query: 'who are our buyers', dataMarts: [{ id: 'orders' }, { id: 'customers' }] })).toEqual({ ids: ['customers'] });
  const fields = [{ name: 'id', category: 'number' }, { name: 'status', category: 'string' }, { name: 'amount', category: 'number' }, { name: 'created_at', category: 'date' }];
  expect(await ask({ task: 'view', query: 'paid orders last month', fields })).toMatchObject({
    filters: [{ field: 'created_at', op: 'relative', value: { kind: 'last_month' } }, { field: 'status', op: 'eq', value: 'paid' }],
  });
  expect(await ask({ task: 'view', query: 'biggest orders', fields })).toMatchObject({ sorts: [{ field: 'amount', direction: 'desc' }] });
  expect(createMockCtx(demoFixtures(), { ai: false }).credentials?.ai).toBeUndefined();
});

test('uniqueCount with grouping counts distinct primary keys per group', async () => {
  const ctx = createMockCtx(demoFixtures());
  const rows = await readRows(ctx, 'orders', { column: ['status'], uniqueCount: [''] });
  expect(rows.length).toBeGreaterThan(1);
  expect(rows.reduce((n, r) => n + Number(r['Unique Count']), 0)).toBe(450);
  const byYear = await readRows(ctx, 'orders', { column: ['created_at'], dateTrunc: [{ column: 'created_at', unit: 'YEAR' }], uniqueCount: [''] });
  expect(byYear.length).toBeGreaterThan(0);
  for (const r of byYear) expect(typeof r['Unique Count']).toBe('number');
});

test('uniqueCount names a joined source by its alias path', async () => {
  const rows = await readRows(createMockCtx(demoFixtures()), 'orders', { uniqueCount: ['', 'customers'] });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveProperty('Unique Count', 450);
  const customers = Number(rows[0]!.customers__unique_count);
  expect(customers).toBeGreaterThan(0);
  expect(customers).toBeLessThanOrEqual(450);
  const nested = await readRows(createMockCtx(demoFixtures()), 'orders', { column: ['status'], uniqueCount: ['customers.countries'] });
  expect(nested[0]).toHaveProperty('customers_countries__unique_count');
});

test('mock ctx serves custom connector summaries for the names asked, ignoring case', async () => {
  const ctx = createMockCtx(demoFixtures());
  const rows = await ctx.owox.getJson<{ name: string }[]>('/api/connectors/custom/summaries', { names: 'fiberytasks,BrexExpenses,Shopify' });
  expect(rows.map((r) => r.name).sort()).toEqual(['BrexExpenses', 'FiberyTasks']);
  const model = await loadModel(ctx);
  expect(model.sources.find((s) => s.key === 'service:fibery.io')).toMatchObject({ name: 'Fibery', martIds: expect.arrayContaining(['fibery_tasks', 'fibery_projects', 'fibery_people']) });
});

test('the mock serves three seeded reports and returns them from /api/search only when REPORT is asked for', async () => {
  const ctx = createMockCtx(demoFixtures());
  const hits = await ctx.owox.getJson<{ entityType: string; entityId: string; report?: { dataMart: { id: string } } }[]>('/api/search', { q: 'paid orders', entityTypes: 'DATA_MART,REPORT' });
  expect(hits.find((h) => h.entityId === 'mock-report-orders-paid')).toMatchObject({ entityType: 'REPORT', report: { dataMart: { id: 'orders' } } });
  expect(hits.some((h) => h.entityType === 'DATA_MART')).toBe(true);
  const martsOnly = await ctx.owox.getJson<{ entityType: string }[]>('/api/search', { q: 'paid orders', entityTypes: 'DATA_MART' });
  expect(martsOnly.every((h) => h.entityType === 'DATA_MART')).toBe(true);
  const report = await ctx.owox.getJson<{ title: string; dataMart: { id: string } }>('/api/reports/mock-report-campaigns');
  expect(report).toMatchObject({ title: 'Campaign spend', dataMart: { id: 'campaigns' } });
  const paid = await ctx.owox.getJson<{ filterConfig: unknown; sortConfig: unknown; aggregationConfig: unknown; dateTruncConfig: unknown }>('/api/reports/mock-report-orders-paid');
  for (const c of [paid.filterConfig, paid.sortConfig, paid.aggregationConfig, paid.dateTruncConfig]) expect(Array.isArray(c)).toBe(true);
});
