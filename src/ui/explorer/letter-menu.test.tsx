import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

const data = () => document.getElementById('band-data')!;
const letter = (t: string) => [...data().querySelectorAll<HTMLElement>('th.dm-letter')].find((h) => h.textContent === t)!;
const titleOf = (i: number) => data().querySelectorAll<HTMLElement>('[data-menu-icon]')[i]!.getAttribute('aria-label')!.replace('Column menu ', '');
const menus = () => screen.queryAllByRole('menu').filter((m) => m.hasAttribute('data-column-menu'));

describe('column letter context menu', () => {
  test('right-clicking a letter opens that column\'s menu; another letter replaces it; Escape closes it', async () => {
    render(<AppServices ctx={createMockCtx(demoFixtures(), { latencyMs: 0 })}><StoreProvider><App /></StoreProvider></AppServices>);
    await waitFor(() => expect(data().querySelectorAll('[data-menu-icon]').length).toBeGreaterThan(1));
    const [a, b] = [titleOf(0), titleOf(1)];
    const ev = fireEvent.contextMenu(letter('B'));
    expect(ev).toBe(false);
    expect(await screen.findByRole('menu', { name: `Menu of ${b}` })).toBeTruthy();
    fireEvent.contextMenu(letter('A'));
    expect(await screen.findByRole('menu', { name: `Menu of ${a}` })).toBeTruthy();
    expect(menus()).toHaveLength(1);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(menus()).toHaveLength(0));
  });
});
