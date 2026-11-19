import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { createPreferences } from '../../api/preferences';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

test('the Data Marts band opens in Grid, switches to Canvas, and saves the choice', async () => {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  await screen.findByText('Customers');
  const band = document.getElementById('band-marts')!;
  const group = within(band).getByRole('radiogroup', { name: 'Show data marts as' });
  expect(within(group).getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
  await userEvent.click(within(group).getByRole('radio', { name: 'Canvas' }));
  expect(within(group).getByRole('radio', { name: 'Canvas' })).toHaveAttribute('aria-checked', 'true');
  expect(within(band).getByTestId('marts-canvas')).toBeInTheDocument();
  await vi.waitFor(async () => expect(await createPreferences(ctx).loadMartsView()).toBe('canvas'));
});
