import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';

const renders = vi.hoisted(() => ({ count: 0 }));
// ViewSwitch is rendered by CardBands itself, so its render count is CardBands' own.
vi.mock('./ViewSwitch', async (orig) => {
  const real = await orig<typeof import('./ViewSwitch')>();
  return { ...real, ViewSwitch: (p: Parameters<typeof real.ViewSwitch>[0]) => { renders.count += 1; return real.ViewSwitch(p); } };
});

import { App } from '../App';

test('moving the pointer over a line re-renders the wire tip layer, not CardBands', async () => {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  await screen.findByText('Customers');
  const canvas = document.querySelector<HTMLElement>('.dm-canvas')!;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.id = 'wires';
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('data-tip', 'a to b');
  svg.appendChild(path);
  canvas.appendChild(svg);
  // Let the page finish loading, so only the pointer moves are counted.
  await act(() => new Promise<void>((r) => setTimeout(r, 500)));
  const before = renders.count;
  for (let i = 0; i < 5; i++) act(() => { fireEvent.pointerMove(path, { clientX: i, clientY: i }); });
  expect(await screen.findByText('a to b')).toBeInTheDocument();
  expect(renders.count).toBe(before);
});
