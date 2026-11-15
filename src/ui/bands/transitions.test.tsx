import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useCardTransitions } from './transitions';

function List({ ids }: { ids: string[] }) {
  const { items, transitionOf } = useCardTransitions(ids, (id) => id);
  return <ul>{items.map((id) => { const t = transitionOf(id); return <li key={id} data-testid={id} className={t.className} data-leaving={t.leaving ? '' : undefined}>{id}</li>; })}</ul>;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('the first render animates nothing', () => {
  render(<List ids={['a', 'b']} />);
  expect(screen.getByTestId('a').className).toBe('');
});

test('a card that joins grows in, one that goes keeps its place while it shrinks, then both settle', () => {
  const { rerender } = render(<List ids={['a', 'b', 'c']} />);
  rerender(<List ids={['a', 'd', 'c']} />);
  expect(screen.getByTestId('d')).toHaveClass('dm-turning'); // took the cell b left: a replacement, not a leave and an arrival
  expect(screen.queryByTestId('b')).toBeNull();
  rerender(<List ids={['a', 'd', 'c', 'e']} />);
  expect(screen.getByTestId('e')).toHaveClass('dm-entering');
  rerender(<List ids={['a', 'd', 'e']} />);
  const c = screen.getByTestId('c');
  expect(c).toHaveClass('dm-leaving');
  expect(c).toHaveAttribute('data-leaving');
  expect(screen.getAllByRole('listitem').map((x) => x.textContent)).toEqual(['a', 'd', 'c', 'e']);
  act(() => { vi.advanceTimersByTime(300); });
  expect(screen.queryByTestId('c')).toBeNull();
  expect(screen.getByTestId('e').className).toBe('');
});
