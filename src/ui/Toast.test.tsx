import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { Toast, TOAST_MS } from './Toast';

test('a toast is a status in the page corner with its action and a dismiss button', async () => {
  const onDismiss = vi.fn();
  render(<Toast onDismiss={onDismiss} action={<button type="button">Show prompt</button>}>Prompt copied</Toast>);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Prompt copied');
  expect(status).toHaveClass('fixed');
  expect(screen.getByRole('button', { name: 'Show prompt' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

test('the timer only hides the toast: onDismiss is for the Dismiss button', () => {
  vi.useFakeTimers();
  try {
    const onDismiss = vi.fn();
    render(<Toast onDismiss={onDismiss}>Copied 3 rows</Toast>);
    act(() => { vi.advanceTimersByTime(TOAST_MS - 1); });
    expect(screen.getByText('Copied 3 rows')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByText('Copied 3 rows')).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

test('the status region stays mounted while the text comes and goes', () => {
  const { rerender } = render(<Toast onDismiss={() => undefined}>{null}</Toast>);
  const region = screen.getByRole('status');
  expect(region).toBeEmptyDOMElement();
  rerender(<Toast onDismiss={() => undefined}>Copied</Toast>);
  expect(screen.getByRole('status')).toBe(region);
  expect(region).toHaveTextContent('Copied');
});

test('hover or focus holds the timer until the pointer or focus leaves', () => {
  vi.useFakeTimers();
  try {
    render(<Toast onDismiss={() => undefined} action={<button type="button">Show prompt</button>}>Prompt copied</Toast>);
    const card = screen.getByText('Prompt copied').parentElement!;
    fireEvent.mouseEnter(card);
    act(() => { vi.advanceTimersByTime(TOAST_MS * 3); });
    expect(screen.getByText('Prompt copied')).toBeInTheDocument();
    fireEvent.mouseLeave(card);
    act(() => { vi.advanceTimersByTime(TOAST_MS); });
    expect(screen.queryByText('Prompt copied')).toBeNull();
  } finally { vi.useRealTimers(); }
});

test('focus inside holds the timer; a held or persistent toast never hides', () => {
  vi.useFakeTimers();
  try {
    const { rerender } = render(<Toast onDismiss={() => undefined} action={<button type="button">Show prompt</button>}>A</Toast>);
    fireEvent.focus(screen.getByRole('button', { name: 'Show prompt' }));
    act(() => { vi.advanceTimersByTime(TOAST_MS * 3); });
    expect(screen.getByText('A')).toBeInTheDocument();
    rerender(<Toast onDismiss={() => undefined} hold stamp="b">B</Toast>);
    act(() => { vi.advanceTimersByTime(TOAST_MS * 3); });
    expect(screen.getByText('B')).toBeInTheDocument();
    rerender(<Toast onDismiss={() => undefined} persistent stamp="c">C</Toast>);
    act(() => { vi.advanceTimersByTime(TOAST_MS * 3); });
    expect(screen.getByText('C')).toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});
