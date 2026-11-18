import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

const data = () => document.getElementById('band-data')!;
const radio = (name: string) => within(data()).getByRole('radio', { name });

async function setup() {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const puts: unknown[] = [];
  const ctx = { ...base, collections: <T,>(name: string) => { const c = base.collections<T>(name); return name === 'grid-columns' ? { get: c.get, put: async (id: string, d: T) => { puts.push(d); return c.put(id, d); } } : c; } };
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true));
  return puts;
}

test('a mart opens on Table; Charts switches, Undo brings Table back, the member store gets no view', async () => {
  const puts = await setup();
  expect(radio('Table')).toHaveAttribute('aria-checked', 'true');
  expect(radio('Charts')).toHaveAttribute('aria-checked', 'false');
  await userEvent.click(radio('Charts'));
  await waitFor(() => expect(radio('Charts')).toHaveAttribute('aria-checked', 'true'));
  expect(radio('Table')).toHaveAttribute('aria-checked', 'false');
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(radio('Table')).toHaveAttribute('aria-checked', 'true'));
  expect(radio('Charts')).toHaveAttribute('aria-checked', 'false');
  expect(JSON.stringify(puts)).not.toContain('view');
});

test('arrow keys move between the two', async () => {
  await setup();
  radio('Table').focus();
  await userEvent.keyboard('{ArrowRight}');
  await waitFor(() => expect(radio('Charts')).toHaveAttribute('aria-checked', 'true'));
  await userEvent.keyboard('{ArrowLeft}');
  await waitFor(() => expect(radio('Table')).toHaveAttribute('aria-checked', 'true'));
});
