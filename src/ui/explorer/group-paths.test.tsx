import { render, waitFor, within } from '@testing-library/react';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore, type State } from '../../state/store';
import { App } from '../App';

const data = () => document.getElementById('band-data')!;

test('two adjacent paths of one mart are two column groups, each titled by its path', async () => {
  let state!: State;
  let dispatch!: ReturnType<typeof useStore>[1];
  function Probe() { const [s, d] = useStore(); state = s; dispatch = d; return null; }
  render(<AppServices ctx={createMockCtx(demoFixtures(), { latencyMs: 0 })}><StoreProvider><App /><Probe /></StoreProvider></AppServices>);
  await waitFor(() => expect(state.grids.orders).toBeTruthy());
  const own = state.grids.orders!.columns;
  const columns = [...own, 'customers__name', 'customers__countries__name', 'stores__countries__name'];
  dispatch({ type: 'editGrid', martId: 'orders', grid: { ...state.grids.orders!, columns } });
  await waitFor(() => expect(data().querySelectorAll('th[data-group-path]').length).toBe(4));
  const heads = Array.from(data().querySelectorAll<HTMLElement>('th[data-group-path]'));
  expect(heads.map((h) => h.dataset.groupPath)).toEqual(['', 'customers', 'customers.countries', 'stores.countries']);
  const countries = heads.filter((h) => h.dataset.group === 'countries');
  expect(countries).toHaveLength(2);
  const labels = countries.map((h) => h.querySelector('.truncate')!.textContent);
  expect(new Set(labels).size).toBe(2);
  expect(within(data()).getAllByRole('button', { name: /^Remove .* from the grid$/ }).length).toBeGreaterThan(2);
});
