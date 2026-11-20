import { render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

// Counts every render of a grid cell's value (the record view wraps its own) and of a header's controls, so a selection change can be held to the cells it touches.
const renders = vi.hoisted(() => ({ cells: 0, controls: 0 }));
vi.mock('./CellValue', async () => {
  const real = await vi.importActual<typeof import('./CellValue')>('./CellValue');
  return { ...real, CellValue: (props: Parameters<typeof real.CellValue>[0]) => { if (!props.wrap) renders.cells += 1; return real.CellValue(props); } };
});
vi.mock('./ColumnMenu', async () => {
  const real = await vi.importActual<typeof import('./ColumnMenu')>('./ColumnMenu');
  return { ...real, ColumnControls: (props: Parameters<typeof real.ColumnControls>[0]) => { renders.controls += 1; return real.ColumnControls(props); } };
});

const data = () => document.getElementById('band-data')!;
const dataRows = () => within(data()).getAllByRole('row').filter((r) => r.querySelector('td'));
const cellsOf = (r: HTMLElement) => Array.from(r.querySelectorAll(':scope > td:not([aria-hidden])')) as HTMLElement[];

async function ready() {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  await waitFor(() => expect(dataRows().length).toBeGreaterThan(10));
  // Let the first reads and saves settle, so nothing but the selection renders below.
  await waitFor(() => { const before = renders.cells; return new Promise<void>((done) => setTimeout(() => { expect(renders.cells).toBe(before); done(); }, 150)); });
}

test('a selection change renders only the cells of the rows it touches, and no header controls', async () => {
  await ready();
  const rows = dataRows();
  const columns = cellsOf(rows[0]!).length;
  expect(rows.length).toBeGreaterThan(10);
  const cellsBefore = renders.cells;
  const controlsBefore = renders.controls;
  await userEvent.click(cellsOf(rows[2]!)[1]!);
  expect(cellsOf(rows[2]!)[1]!).toHaveAttribute('data-selected');
  // One row gained a selected cell.
  expect(renders.cells - cellsBefore).toBeLessThanOrEqual(columns);
  await userEvent.keyboard('{ArrowDown}');
  expect(cellsOf(rows[3]!)[1]!).toHaveAttribute('data-selected');
  // The row that lost the selection and the row that gained it.
  expect(renders.cells - cellsBefore).toBeLessThanOrEqual(3 * columns);
  expect(renders.controls).toBe(controlsBefore);
});
