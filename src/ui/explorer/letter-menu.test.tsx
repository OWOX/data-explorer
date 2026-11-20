import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

const data = () => document.getElementById('band-data')!;
const letter = (t: string) => [...data().querySelectorAll<HTMLElement>('th.dm-letter')].find((h) => h.textContent === t)!;
const menus = () => screen.queryAllByRole('menu').filter((m) => m.hasAttribute('data-column-menu'));

describe('column letter context menu', () => {
  test('right-clicking a letter leaves the browser menu alone and opens no column menu', async () => {
    render(<AppServices ctx={createMockCtx(demoFixtures(), { latencyMs: 0 })}><StoreProvider><App /></StoreProvider></AppServices>);
    await waitFor(() => expect(data().querySelectorAll('[data-menu-icon]').length).toBeGreaterThan(1));
    const ev = fireEvent.contextMenu(letter('B'));
    expect(ev).toBe(true);
    expect(menus()).toHaveLength(0);
  });
});
