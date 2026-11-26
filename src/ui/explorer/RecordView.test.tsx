import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { stubCtx, traversalOf } from '../../api/test-ctx';
import type { Model } from '../../model/types';
import { rememberRow, SEEN_LIMIT, seenRow } from '../../records/seen-rows';
import type { Ctx, Row } from '../../sdk/types';
import { AppServices, StoreProvider } from '../../state/store';
import { RecordView } from './RecordView';

const model: Model = { marts: new Map(), sources: [], edges: [], contexts: [], storages: [], failedStorages: [] };
const fields = [{ name: 'id', type: 'INTEGER', isPrimaryKey: true }, { name: 'name', type: 'STRING' }, { name: 'city', type: 'STRING' }];
const pk = { id: 1 };

function setup(readRow: Row, gate?: Promise<void>) {
  const traverseData = vi.fn(async () => { await gate; return traversalOf([readRow]); });
  const base = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const ctx: Ctx = { ...base, owox: { ...base.owox, getJson: vi.fn(async () => ({ schema: { fields } })) } as Ctx['owox'] };
  const ui = <AppServices ctx={ctx}><StoreProvider><RecordView martId="m" pk={pk} model={model} /></StoreProvider></AppServices>;
  return { ctx, traverseData, ui };
}

test('no seed: one read', async () => {
  const { traverseData, ui } = setup({ id: 1, name: 'Read', city: 'Oslo' });
  render(ui);
  expect(await screen.findByText('Read')).toBeInTheDocument();
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('a seed with every field shows with no read, and Refresh reads once', async () => {
  const { ctx, traverseData, ui } = setup({ id: 1, name: 'Read', city: 'Oslo' });
  rememberRow(ctx, 'm', pk, { row: { id: 1, name: 'Seeded', city: 'Rome' }, columns: ['id', 'name', 'city'], stamp: 0 });
  render(ui);
  expect(await screen.findByText('Seeded')).toBeInTheDocument();
  expect(screen.getByText('Rome')).toBeInTheDocument();
  expect(traverseData).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
  expect(await screen.findByText('Read')).toBeInTheDocument();
  expect(traverseData).toHaveBeenCalledTimes(1);
  // a later open of this record (Undo, Redo) must not show the older grid row
  expect(seenRow(ctx, 'm', pk, 0)).toBeUndefined();
});

test('a seed with some fields shows them before the read resolves, then the read replaces them', async () => {
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  const { ctx, traverseData, ui } = setup({ id: 1, name: 'Read', city: 'Oslo' }, gate);
  rememberRow(ctx, 'm', pk, { row: { id: 1, name: 'Seeded' }, columns: ['id', 'name'], stamp: 0 });
  render(ui);
  expect(await screen.findByText('Seeded')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
  expect(screen.queryByText('Oslo')).toBeNull();
  // The seeded values are shown dimmed and busy until the read lands.
  const list = screen.getByText('Seeded').closest('dl')!;
  const values = screen.getByText('Seeded').closest('dd')!;
  expect(values).toHaveClass('dm-stale');
  expect(list).toHaveAttribute('aria-busy', 'true');
  expect(list.querySelector('dt.dm-stale')).toBeNull();
  open();
  expect(await screen.findByText('Oslo')).toBeInTheDocument();
  expect(screen.getByText('Oslo').closest('dd')).not.toHaveClass('dm-stale');
  expect(list).not.toHaveAttribute('aria-busy');
  expect(screen.getByText('Read')).toBeInTheDocument();
  expect(screen.queryByText('Seeded')).toBeNull();
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('a seed from another model version is not used', async () => {
  const { ctx, traverseData, ui } = setup({ id: 1, name: 'Read', city: 'Oslo' });
  rememberRow(ctx, 'm', pk, { row: { id: 1, name: 'Seeded', city: 'Rome' }, columns: ['id', 'name', 'city'], stamp: 3 });
  render(ui);
  expect(await screen.findByText('Read')).toBeInTheDocument();
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('the store keeps the newest SEEN_LIMIT rows', () => {
  const { ctx } = setup({});
  for (let i = 0; i <= SEEN_LIMIT; i++) rememberRow(ctx, 'm', { id: i }, { row: { id: i }, columns: ['id'], stamp: 0 });
  expect(seenRow(ctx, 'm', { id: 0 }, 0)).toBeUndefined();
  expect(seenRow(ctx, 'm', { id: SEEN_LIMIT }, 0)).toBeDefined();
});
