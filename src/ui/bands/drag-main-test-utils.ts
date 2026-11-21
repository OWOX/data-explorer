import { fireEvent } from '@testing-library/react';

/**
 * Makes a card the main data mart the way a member does without the old card button: drags it onto the main card.
 * jsdom has no layout, so the main card is what `elementFromPoint` answers while the drag is on.
 */
export function dragOntoMain(card: Element, main: Element) {
  const pointer = (type: string, target: Window | Node, x: number) =>
    fireEvent(target, new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: 0 }));
  (document as { elementFromPoint?: unknown }).elementFromPoint = () => main;
  try {
    pointer('pointerdown', card, 0);
    pointer('pointermove', window, 30);
    pointer('pointerup', window, 30);
  } finally {
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  }
}
