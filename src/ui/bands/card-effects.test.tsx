import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { vi } from 'vitest';
import type { Context, Mart } from '../../model/types';
import { TooltipProvider } from '../Tooltip';
import { useLatest } from '../useLatest';
import { WireTipLayer } from './WireTipLayer';
import { MartCard } from './cards';

afterEach(cleanup);

const mart: Mart = {
  id: 'm1', title: 'Orders', description: null, icon: null, storageId: 's',
  contextIds: ['c1'], dataLastUpdatedAt: null, accessible: true, sourceKey: null,
};
const context = (): Context => ({ id: 'c1', name: 'Finance', icon: null });

describe('the contexts row of a card', () => {
  test('keeps one ResizeObserver while the contexts say the same thing, and rebuilds it when they change', () => {
    const made = vi.fn();
    const Real = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class extends Real { constructor(cb: ResizeObserverCallback) { super(cb); made(); } };
    try {
      const card = (contexts: Context[]) => <TooltipProvider><MartCard mart={mart} contexts={contexts} quality={undefined} selected={false} lit={false} onSelect={() => undefined} onOpenApp={() => undefined} /></TooltipProvider>;
      const { rerender } = render(card([context()]));
      const base = made.mock.calls.length;
      expect(base).toBe(1);
      // Each hover re-renders the bands, and the callers hand the card a fresh array with the same contents.
      for (let i = 0; i < 5; i++) rerender(card([context()]));
      expect(made).toHaveBeenCalledTimes(base);
      rerender(card([{ ...context(), name: 'Sales' }]));
      expect(made).toHaveBeenCalledTimes(base + 1);
    } finally {
      globalThis.ResizeObserver = Real;
    }
  });
});

describe('a ghost card', () => {
  test('needs no count, no retry and no count request', () => {
    render(<TooltipProvider><MartCard mart={mart} ghost contexts={[]} quality={undefined} selected={false} lit={false} onSelect={() => undefined} onOpenApp={() => undefined} /></TooltipProvider>);
    const article = document.querySelector('article')!;
    expect(article).toHaveAttribute('data-ghost');
    expect(article.querySelector('.dm-badge-button')).toBeNull();
  });
});

describe('WireTipLayer', () => {
  test('a pointer move over a line re-renders the layer and not the component that holds the cards', () => {
    let renders = 0;
    function Bands() {
      renders += 1;
      const canvas = useRef<HTMLDivElement>(null);
      return (
        <div ref={canvas} data-testid="canvas">
          <svg id="wires"><path data-testid="line" data-tip="id to id" d="M0 0" /></svg>
          <p data-testid="outside">card</p>
          <WireTipLayer canvas={canvas} />
        </div>
      );
    }
    render(<TooltipProvider><Bands /></TooltipProvider>);
    expect(renders).toBe(1);
    const line = screen.getByTestId('line');
    act(() => { fireEvent.pointerMove(line, { clientX: 10, clientY: 20 }); });
    act(() => { fireEvent.pointerMove(line, { clientX: 30, clientY: 40 }); });
    expect(screen.getByText('id to id')).toBeInTheDocument();
    expect(renders).toBe(1);
    act(() => { fireEvent.pointerMove(screen.getByTestId('outside')); });
    expect(screen.queryByText('id to id')).not.toBeInTheDocument();
    act(() => { fireEvent.pointerMove(line, { clientX: 1, clientY: 1 }); });
    act(() => { fireEvent.pointerLeave(screen.getByTestId('canvas')); });
    expect(screen.queryByText('id to id')).not.toBeInTheDocument();
    expect(renders).toBe(1);
  });

  test('a card being dragged over a described line opens no bubble, so the bubble cannot take the drop', () => {
    function Bands() {
      const canvas = useRef<HTMLDivElement>(null);
      return <div ref={canvas}><svg id="wires"><path data-testid="line" data-tip="Last Session" data-more="About" d="M0 0" /></svg><WireTipLayer canvas={canvas} /></div>;
    }
    render(<TooltipProvider><Bands /></TooltipProvider>);
    const line = screen.getByTestId('line');
    act(() => { fireEvent.pointerMove(line); });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // jsdom has no PointerEvent with buttons: a mouse event of that type carries them.
    act(() => { line.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 1 })); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a tip with a description stays where it opened, lets the pointer reach "More", and closes a moment after the pointer leaves it', () => {
    vi.useFakeTimers();
    try {
      function Bands() {
        const canvas = useRef<HTMLDivElement>(null);
        return (
          <div ref={canvas}>
            <svg id="wires"><path data-testid="line" data-tip="Last Session" data-more="The visit before the lead converted" d="M0 0" /></svg>
            <p data-testid="outside">card</p>
            <WireTipLayer canvas={canvas} />
          </div>
        );
      }
      render(<TooltipProvider><Bands /></TooltipProvider>);
      act(() => { fireEvent.pointerMove(screen.getByTestId('line'), { clientX: 10, clientY: 20 }); });
      expect(screen.getByRole('dialog')).toHaveTextContent(/^Last SessionMore$/);
      // Off the line on the way to the bubble: it waits.
      act(() => { fireEvent.pointerMove(screen.getByTestId('outside')); vi.advanceTimersByTime(100); });
      act(() => { fireEvent.pointerMove(screen.getByRole('button', { name: 'More' })); vi.advanceTimersByTime(1000); });
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('The visit before the lead converted');
      act(() => { fireEvent.pointerMove(screen.getByTestId('outside')); vi.advanceTimersByTime(400); });
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useLatest', () => {
  test('a listener set up once reads the props of the latest render', () => {
    const seen: number[] = [];
    function Probe({ value }: { value: number }) {
      const latest = useLatest(value);
      const [, force] = useState(0);
      return <button onClick={() => { seen.push(latest.current); force((n) => n + 1); }}>read</button>;
    }
    const { rerender } = render(<Probe value={1} />);
    rerender(<Probe value={2} />);
    fireEvent.click(screen.getByText('read'));
    expect(seen).toEqual([2]);
  });
});
