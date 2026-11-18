import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { useWidth } from './useWidth';

let fire: (w: number) => void;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: ResizeObserverCallback) { fire = (w) => cb([{ contentRect: { width: w } } as ResizeObserverEntry], this as never); }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => vi.unstubAllGlobals());

function setup(active: boolean) {
  const renders = { n: 0, width: 0 };
  function Probe({ on }: { on: boolean }) {
    const { ref, width } = useWidth<HTMLDivElement>(on);
    renders.n += 1;
    renders.width = width;
    return <div ref={ref} />;
  }
  const view = render(<Probe on={active} />);
  return { renders, again: (on: boolean) => view.rerender(<Probe on={on} />) };
}

test('inactive: a resize does not re-render; turning active on yields the latest width', () => {
  const { renders, again } = setup(false);
  const before = renders.n;
  act(() => fire(300));
  act(() => fire(420));
  expect(renders.n).toBe(before);
  again(true);
  expect(renders.width).toBe(420);
});

test('active (the default) follows every resize', () => {
  const { renders } = setup(true);
  act(() => fire(300));
  expect(renders.width).toBe(300);
});
