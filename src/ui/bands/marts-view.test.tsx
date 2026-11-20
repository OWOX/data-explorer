import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { createPreferences } from '../../api/preferences';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

test('the Data Marts band opens in Grid, switches to Graph, and saves the choice', async () => {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  await screen.findByText('Customers');
  const band = document.getElementById('band-marts')!;
  const group = within(band).getByRole('radiogroup', { name: 'Show data marts as' });
  expect(within(group).getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
  await userEvent.click(within(group).getByRole('radio', { name: 'Graph' }));
  expect(within(group).getByRole('radio', { name: 'Graph' })).toHaveAttribute('aria-checked', 'true');
  expect(within(band).getByTestId('marts-canvas')).toBeInTheDocument();
  await vi.waitFor(async () => expect(await createPreferences(ctx).loadMartsView()).toBe('canvas'));
});

test('a click on a Data Sources card switches Graph to Grid and saves it; on Grid nothing changes', async () => {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  await screen.findByText('Customers');
  const band = document.getElementById('band-marts')!;
  const group = within(band).getByRole('radiogroup', { name: 'Show data marts as' });
  const source = () => within(document.getElementById('band-sources')!).getByText('Shopify').closest('article')!;
  await userEvent.click(source());
  expect(within(group).getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
  await userEvent.click(within(group).getByRole('radio', { name: 'Graph' }));
  await vi.waitFor(async () => expect(await createPreferences(ctx).loadMartsView()).toBe('canvas'));
  await userEvent.click(source());
  expect(within(group).getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
  await vi.waitFor(async () => expect(await createPreferences(ctx).loadMartsView()).toBe('grid'));
});
