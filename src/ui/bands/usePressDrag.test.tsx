import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { usePressDrag, type PressDragOptions } from './usePressDrag';

const fire = (target: EventTarget, type: string, init: PointerEventInit) => act(() => { target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...init })); });

function Host({ options }: { options: PressDragOptions<{ x: number }> }) {
  const root = useRef<HTMLDivElement>(null);
  const drag = usePressDrag(root, options);
  return <div ref={root}><div data-card="a" onClick={() => clicked()}><button type="button">x</button></div>{drag && <span data-testid="drag">{drag.x}</span>}</div>;
}
const clicked = vi.fn();
const options = (drop = vi.fn()): PressDragOptions<{ x: number }> => ({
  pick: (t) => (t.closest('[data-card]') ? { path: 'a' } : null),
  canDrag: () => true,
  over: () => true,
  view: (_p, e) => ({ x: e.clientX }),
  drop,
});

describe('usePressDrag', () => {
  it('keeps a press that moves under 5 px a click', () => {
    const drop = vi.fn();
    const { container } = render(<Host options={options(drop)} />);
    const card = container.querySelector('[data-card]')!;
    fire(card, 'pointerdown', { button: 0, clientX: 0, clientY: 0 });
    fire(window, 'pointermove', { buttons: 1, clientX: 3, clientY: 0 });
    fire(window, 'pointerup', { clientX: 3, clientY: 0 });
    expect(drop).not.toHaveBeenCalled();
  });
  it('drops after a move past 5 px', () => {
    const drop = vi.fn();
    const { container } = render(<Host options={options(drop)} />);
    const card = container.querySelector('[data-card]')!;
    fire(card, 'pointerdown', { button: 0, clientX: 0, clientY: 0 });
    fire(window, 'pointermove', { buttons: 1, clientX: 20, clientY: 0 });
    fire(window, 'pointerup', { clientX: 20, clientY: 0 });
    expect(drop).toHaveBeenCalledTimes(1);
  });
  it('does not drop or click after Escape ends the drag', () => {
    clicked.mockClear();
    const drop = vi.fn();
    const { container } = render(<Host options={options(drop)} />);
    const card = container.querySelector('[data-card]')! as HTMLElement;
    fire(card, 'pointerdown', { button: 0, clientX: 0, clientY: 0 });
    fire(window, 'pointermove', { buttons: 1, clientX: 20, clientY: 0 });
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    fire(window, 'pointerup', { clientX: 20, clientY: 0 });
    act(() => { card.click(); });
    expect(drop).not.toHaveBeenCalled();
    expect(clicked).not.toHaveBeenCalled();
  });
  it('ignores a press on a button inside a card', () => {
    const drop = vi.fn();
    const { container } = render(<Host options={options(drop)} />);
    const button = container.querySelector('[data-card] button')!;
    fire(button, 'pointerdown', { button: 0, clientX: 0, clientY: 0 });
    fire(window, 'pointermove', { buttons: 1, clientX: 20, clientY: 0 });
    expect(container.querySelector('[data-testid="drag"]')).toBeNull();
    fire(window, 'pointerup', { clientX: 20, clientY: 0 });
    expect(drop).not.toHaveBeenCalled();
  });
});
