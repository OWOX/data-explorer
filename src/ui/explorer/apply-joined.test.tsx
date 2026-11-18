import { StrictMode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GRID_COLUMNS_COLLECTION } from '../../api/grid-columns';
import type { BlendableSchemaDto, TraverseOptions } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore } from '../../state/store';
import { App } from '../App';
import { openSubmenu } from './menu-test-utils';

async function setup(saved: string[], post?: string[]) {
  const base0 = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const realGet = base0.owox.getJson.bind(base0.owox);
  const base = post ? { ...base0, owox: { ...base0.owox, getJson: (async (path: string, q?: Record<string, string>) => { const dto = await realGet<BlendableSchemaDto>(path, q); if (path.endsWith('/blendable-schema')) dto.blendedFields = dto.blendedFields?.map((f) => ({ ...f, postJoinAggregations: post })); return dto; }) as typeof base0.owox.getJson } } : base0;
  const queries: TraverseOptions[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const ctx = { ...base, owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (id: string, o: TraverseOptions) => { queries.push(o); return real(id, o); } } } };
  await base.collections<{ columns: string[]; at: string }>(GRID_COLUMNS_COLLECTION).put('orders', { columns: saved, at: 'then' });
  render(<StrictMode><AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices></StrictMode>);
  return queries;
}
const data = () => document.getElementById('band-data')!;
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent);

test.each([
  ['main', 'status', 'status'],
  ['joined', 'Customers · email', 'customers__email'],
])('Aggregate Apply on a %s column groups the rows and the request carries it', async (_k, title, name) => {
  const queries = await setup(['id', 'status', 'customers__email']);
  await waitFor(() => expect(headers()).toHaveLength(3));
  await openSubmenu(within(data()), title, 'Aggregate');
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByLabelText('Count Unique'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(queries.at(-1)?.aggregation).toEqual([{ column: name, function: 'COUNT_DISTINCT' }]));
  await waitFor(() => expect(headers().some((h) => h?.includes('Count Unique'))).toBe(true));
});

test.each([
  ['main', 'status', 'status'],
  ['joined', 'Customers · email', 'customers__email'],
])('Filter Apply on a %s column shows the filter and the request carries it', async (_k, title, name) => {
  const queries = await setup(['id', 'status', 'customers__email']);
  await waitFor(() => expect(headers()).toHaveLength(3));
  await openSubmenu(within(data()), title, 'Filter');
  const dialog = await screen.findByRole('dialog');
  await userEvent.selectOptions(within(dialog).getByLabelText('Operator'), 'eq');
  await userEvent.type(within(dialog).getByLabelText('Value'), 'x');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(queries.at(-1)?.filter).toEqual([{ column: name, operator: 'eq', value: 'x' }]));
  expect(await within(data()).findByRole('button', { name: `Filter ${title}` })).toBeInTheDocument();
});

test('a filter on main, then Count Unique + Combined on a joined column', async () => {
  const queries = await setup(['id', 'status', 'customers__email']);
  await waitFor(() => expect(headers()).toHaveLength(3));
  await openSubmenu(within(data()), 'status', 'Filter');
  let dialog = await screen.findByRole('dialog');
  await userEvent.selectOptions(within(dialog).getByLabelText('Operator'), 'eq');
  await userEvent.type(within(dialog).getByLabelText('Value'), 'paid');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(queries.at(-1)?.filter).toEqual([{ column: 'status', operator: 'eq', value: 'paid' }]));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await openSubmenu(within(data()), 'Customers · email', 'Aggregate');
  dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByLabelText('Count Unique'));
  await userEvent.click(within(dialog).getByLabelText('Combined'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(queries.at(-1)?.aggregation).toEqual([{ column: 'customers__email', function: 'COUNT_DISTINCT' }, { column: 'customers__email', function: 'STRING_AGG' }]));
  expect(queries.at(-1)?.filter).toEqual([{ column: 'status', operator: 'eq', value: 'paid' }]);
  await waitFor(() => expect(headers().filter((h) => h?.includes('email')).length).toBe(2));
});

test('a joined mart added from its card: Aggregate then Filter on its column both stick', async () => {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const queries: TraverseOptions[] = [];
  const real = ctx.owox.dataMarts.traverseData.bind(ctx.owox.dataMarts);
  const spied = { ...ctx, owox: { ...ctx.owox, dataMarts: { ...ctx.owox.dataMarts, traverseData: (id: string, o: TraverseOptions) => { if (!o.uniqueCount) queries.push(o); return real(id, o); } } } };
  render(<StrictMode><AppServices ctx={spied}><StoreProvider><App /></StoreProvider></AppServices></StrictMode>);
  await waitFor(() => expect(headers()).toHaveLength(5));
  const marts = document.getElementById('band-marts')!;
  await within(marts).findByText('Customers');
  await userEvent.click(within(marts).getByText('Customers').closest('article')!);
  await waitFor(() => expect(headers()).toHaveLength(6));
  const col = headers().at(-1)!;
  await openSubmenu(within(data()), `Customers · ${col}`, 'Aggregate');
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByLabelText('Count Unique'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await new Promise((r) => setTimeout(r, 300));
  await waitFor(() => expect(queries.at(-1)?.aggregation?.length).toBe(1));
});

test('after aggregating a joined column, its Filter and a second Aggregate both apply', async () => {
  const queries = await setup(['id', 'status', 'customers__email']);
  await waitFor(() => expect(headers()).toHaveLength(3));
  await openSubmenu(within(data()), 'Customers · email', 'Aggregate');
  let dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByLabelText('Count Unique'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(queries.at(-1)?.aggregation).toHaveLength(1));
  await openSubmenu(within(data()), 'Customers · email', 'Filter');
  dialog = await screen.findByRole('dialog');
  await userEvent.selectOptions(within(dialog).getByLabelText('Operator'), 'contains');
  await userEvent.type(within(dialog).getByLabelText('Value'), 'a');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(queries.at(-1)?.filter).toEqual([{ column: 'customers__email', operator: 'contains', value: 'a' }]));
  expect(queries.at(-1)?.aggregation).toHaveLength(1);
});

test('a joined field whose analyst allows only Count Unique and Combined: Apply sticks and the request carries both', async () => {
  const queries = await setup(['id', 'status', 'customers__email'], ['COUNT_DISTINCT', 'STRING_AGG']);
  await waitFor(() => expect(headers()).toHaveLength(3));
  await openSubmenu(within(data()), 'Customers · email', 'Aggregate');
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getAllByRole('option')).toHaveLength(2);
  await userEvent.click(within(dialog).getByLabelText('Count Unique'));
  await userEvent.click(within(dialog).getByLabelText('Combined'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(queries.at(-1)?.aggregation).toHaveLength(2));
  await waitFor(() => expect(headers().filter((h) => h?.includes('email')).length).toBe(2));
});

test('the applied state is still there after the saves settle (no revert from the store)', async () => {
  const queries = await setup(['id', 'status', 'customers__email']);
  await waitFor(() => expect(headers()).toHaveLength(3));
  await openSubmenu(within(data()), 'Customers · email', 'Aggregate');
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByLabelText('Count Unique'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(queries.at(-1)?.aggregation).toHaveLength(1));
  await new Promise((r) => setTimeout(r, 1500));
  expect(headers().some((h) => h?.includes('Count Unique'))).toBe(true);
  expect(queries.at(-1)?.aggregation).toHaveLength(1);
});

test('a rejected rows request shows its error in the grid and keeps the edit visible', async () => {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const ctx = { ...base, owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (id: string, o: TraverseOptions) => (o.aggregation?.length ? Promise.reject(new Error('HAVING on joined sleeve not supported')) : real(id, o)) } } };
  await base.collections<{ columns: string[]; at: string }>(GRID_COLUMNS_COLLECTION).put('orders', { columns: ['id', 'status', 'customers__email'], at: 'then' });
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  await waitFor(() => expect(headers()).toHaveLength(3));
  await openSubmenu(within(data()), 'Customers · email', 'Aggregate');
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByLabelText('Count Unique'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  expect(await within(data()).findByText(/HAVING on joined sleeve/)).toBeInTheDocument();
  expect(headers().some((h) => h?.includes('Count Unique'))).toBe(true);
  expect(within(data()).getByRole('button', { name: 'Aggregate Customers · email' })).toBeInTheDocument();
});

test.each([
  ['postJoinAggregations SUM/AVG/MIN/MAX', { postJoinAggregations: ['SUM', 'AVG', 'MIN', 'MAX'] }],
  ['no governance lists at all', { postJoinAggregations: undefined }],
])('a joined INTEGER field (%s) offers the numeric functions, never the string list', async (_n, extra) => {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const realGet = base.owox.getJson.bind(base.owox);
  const ctx = { ...base, owox: { ...base.owox, getJson: (async (path: string, q?: Record<string, string>) => { const dto = await realGet<BlendableSchemaDto>(path, q); if (path.endsWith('/blendable-schema')) dto.blendedFields = dto.blendedFields?.map((f) => (f.name === 'customers__email' ? { ...f, type: 'INTEGER', alias: 'Sessions before signup', ...extra } : f)); return dto; }) as typeof base.owox.getJson } };
  await base.collections<{ columns: string[]; at: string }>(GRID_COLUMNS_COLLECTION).put('orders', { columns: ['id', 'status', 'customers__email'], at: 'then' });
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  await waitFor(() => expect(headers()).toHaveLength(3));
  await openSubmenu(within(data()), 'Customers · Sessions before signup', 'Aggregate');
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(['Sum', 'Average', 'Min', 'Max']);
});

async function renderWith(wrap: (base: ReturnType<typeof createMockCtx>) => ReturnType<typeof createMockCtx>, columns = ['id', 'status', 'customers__city']) {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  await base.collections<{ columns: string[]; at: string }>(GRID_COLUMNS_COLLECTION).put('orders', { columns, at: 'then' });
  render(<AppServices ctx={wrap(base)}><StoreProvider><App /></StoreProvider></AppServices>);
  await waitFor(() => expect(headers()).toHaveLength(columns.length));
}
test('the mock mirrors the backend: a joined string field offers the string defaults of its effective type', async () => {
  await renderWith((b) => b);
  await openSubmenu(within(data()), 'Customers · city', 'Aggregate');
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(['Count', 'Count Unique', 'Combined', 'Sample']);
});

test('the backend refusing a function shows its message in the grid, as a plain object too', async () => {
  const refusing = (reject: (m: string) => unknown) => (base: ReturnType<typeof createMockCtx>) => {
    const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
    return { ...base, owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (id: string, o: TraverseOptions) => (o.aggregation?.some((a) => a.function === 'STRING_AGG') ? Promise.reject(reject('Aggregation STRING_AGG is not allowed for field customers__city')) : real(id, o)) } } };
  };
  await renderWith(refusing((m) => ({ message: m, status: 400 })), ['id', 'status', 'customers__email']);
  await openSubmenu(within(data()), 'Customers · email', 'Aggregate');
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByLabelText('Combined'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  expect(await within(data()).findByText('Aggregation STRING_AGG is not allowed for field customers__city')).toBeInTheDocument();
});

test('the mock traverse refuses a function the field does not allow, like the backend', async () => {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  await expect(ctx.owox.dataMarts.traverseData('orders', { column: ['id', 'customers__city'], aggregation: [{ column: 'customers__city', function: 'SUM' }] })).rejects.toThrow('Aggregation SUM is not allowed for field customers__city');
});

test('a joined filter adopted from the store before the joined marts load is applied once they arrive', async () => {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const realGet = base.owox.getJson.bind(base.owox);
  const queries: TraverseOptions[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const ctx = { ...base, owox: { ...base.owox, getJson: (async (path: string, q?: Record<string, string>) => { if (path.endsWith('/blendable-schema')) await gate; return realGet(path, q); }) as typeof base.owox.getJson, dataMarts: { ...base.owox.dataMarts, traverseData: (id: string, o: TraverseOptions) => { queries.push(o); return real(id, o); } } } };
  await base.collections<{ columns: string[]; at: string }>(GRID_COLUMNS_COLLECTION).put('orders', { columns: ['id', 'status'], at: 'then' });
  let dispatch!: ReturnType<typeof useStore>[1];
  const Probe = () => { dispatch = useStore()[1]; return null; };
  render(<AppServices ctx={ctx}><StoreProvider><Probe /><App /></StoreProvider></AppServices>);
  await waitFor(() => expect(headers()).toHaveLength(2));
  act(() => dispatch({ type: 'saveGrid', martId: 'orders', grid: { columns: ['id', 'status'], filters: { customers__email: { field: 'customers__email', op: 'contains', value: 'a' } }, sorts: null, limit: 50 } }));
  await new Promise((r) => setTimeout(r, 50));
  expect(queries.every((q) => !q.filter?.length)).toBe(true);
  release();
  await waitFor(() => expect(queries.at(-1)?.filter).toEqual([{ column: 'customers__email', operator: 'contains', value: 'a' }]));
});

// The blendable schema the backend serves changes between reads: Join Settings narrowed the list for customers__email.
async function renderNarrowing() {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const realGet = base.owox.getJson.bind(base.owox);
  const state = { reads: 0, post: ['COUNT', 'COUNT_DISTINCT', 'STRING_AGG'] };
  const queries: TraverseOptions[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const ctx = { ...base, owox: { ...base.owox, getJson: (async (path: string, q?: Record<string, string>) => {
    const dto = await realGet<BlendableSchemaDto>(path, q);
    if (path.endsWith('/blendable-schema')) { state.reads += 1; dto.blendedFields = dto.blendedFields?.map((f) => (f.name === 'customers__email' ? { ...f, postJoinAggregations: state.post } : f)); }
    return dto;
  }) as typeof base.owox.getJson, dataMarts: { ...base.owox.dataMarts, traverseData: (id: string, o: TraverseOptions) => { queries.push(o); return real(id, o); } } } };
  await base.collections<{ columns: string[]; at: string }>(GRID_COLUMNS_COLLECTION).put('orders', { columns: ['id', 'status', 'customers__email'], at: 'then' });
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  await waitFor(() => expect(headers()).toHaveLength(3));
  return { state, queries };
}

test('Refresh reads the joined marts again, so a Join Settings change is picked up', async () => {
  const { state } = await renderNarrowing();
  const before = state.reads;
  state.post = ['COUNT'];
  await userEvent.click(within(data()).getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(state.reads).toBeGreaterThan(before));
  await openSubmenu(within(data()), 'Customers · email', 'Aggregate');
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(['Count']);
});
