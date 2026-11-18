import { useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { Toast, TOAST_MS } from './Toast';

test('a toast is a status in the page corner with its action and a dismiss button', async () => {
  const onDismiss = vi.fn();
  render(<Toast onDismiss={onDismiss} stamp="a" action={<button type="button">Show prompt</button>}>Prompt copied</Toast>);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Prompt copied');
  // Only the text is announced, not the buttons.
  expect(status).not.toContainElement(screen.getByRole('button', { name: 'Dismiss' }));
  expect(document.getElementById('dm-toast-stack')).toHaveClass('fixed');
  expect(screen.getByRole('button', { name: 'Show prompt' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

test('the timer only hides the toast: onDismiss is for the Dismiss button', () => {
  vi.useFakeTimers();
  try {
    const onDismiss = vi.fn();
    render(<Toast onDismiss={onDismiss} stamp="a">Copied 3 rows</Toast>);
    act(() => { vi.advanceTimersByTime(TOAST_MS - 1); });
    expect(screen.getByText('Copied 3 rows')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByText('Copied 3 rows')).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

test('the status region stays mounted while the text comes and goes', () => {
  const { rerender } = render(<Toast onDismiss={() => undefined} stamp="a">{null}</Toast>);
  const region = screen.getByRole('status');
  expect(region).toBeEmptyDOMElement();
  rerender(<Toast onDismiss={() => undefined} stamp="b">Copied</Toast>);
  expect(screen.getByRole('status')).toBe(region);
  expect(region).toHaveTextContent('Copied');
});

test('hover or focus holds the timer until the pointer or focus leaves', () => {
  vi.useFakeTimers();
  try {
    render(<Toast onDismiss={() => undefined} stamp="a" action={<button type="button">Show prompt</button>}>Prompt copied</Toast>);
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
    const { rerender } = render(<Toast onDismiss={() => undefined} stamp="a" action={<button type="button">Show prompt</button>}>A</Toast>);
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

test('a Dismiss with the pointer over the card does not leave the next message paused', async () => {
  vi.useFakeTimers();
  try {
    const Host = () => { const [m, setM] = useState<string | null>('first'); return <><Toast onDismiss={() => setM(null)} stamp={m}>{m}</Toast><button type="button" onClick={() => setM('second')}>Again</button></>; };
    render(<Host />);
    const card = screen.getByText('first').parentElement!;
    fireEvent.mouseEnter(card);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('first')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Again' }));
    expect(screen.getByText('second')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(TOAST_MS); });
    expect(screen.queryByText('second')).toBeNull();
  } finally { vi.useRealTimers(); }
});

test('a new stamp clears a focus pause left by the previous message', () => {
  vi.useFakeTimers();
  try {
    const { rerender } = render(<Toast onDismiss={() => undefined} stamp="a" action={<button type="button">Act</button>}>A</Toast>);
    fireEvent.focus(screen.getByRole('button', { name: 'Act' }));
    rerender(<Toast onDismiss={() => undefined} stamp="b">B</Toast>);
    act(() => { vi.advanceTimersByTime(TOAST_MS); });
    expect(screen.queryByText('B')).toBeNull();
  } finally { vi.useRealTimers(); }
});

test('the timer does not restart when the parent renders again with the same stamp', () => {
  vi.useFakeTimers();
  try {
    const { rerender } = render(<Toast onDismiss={() => undefined} stamp="a">A</Toast>);
    act(() => { vi.advanceTimersByTime(TOAST_MS - 100); });
    rerender(<Toast onDismiss={() => undefined} stamp="a">A</Toast>);
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.queryByText('A')).toBeNull();
  } finally { vi.useRealTimers(); }
});

test('Dismiss gives focus back to what had it before the toast, else to returnTo', async () => {
  const Host = ({ back }: { back?: boolean }) => { const [m, setM] = useState<string | null>('hi'); const ref = useRef<HTMLButtonElement>(null); return <><button type="button">Before</button><button type="button" ref={ref}>Grid</button>{m && <Toast onDismiss={() => setM(null)} stamp={m} {...(back ? { returnTo: () => ref.current } : {})}>{m}</Toast>}</>; };
  const { unmount } = render(<Host />);
  screen.getByRole('button', { name: 'Before' }).focus();
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
  unmount();
  render(<Host back />);
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.getByRole('button', { name: 'Grid' })).toHaveFocus();
});

test('two toasts at once share one stack, so neither covers the other', () => {
  render(<><Toast onDismiss={() => undefined} stamp="a">First</Toast><Toast onDismiss={() => undefined} stamp="b">Second</Toast></>);
  const stack = document.getElementById('dm-toast-stack')!;
  expect(stack).toContainElement(screen.getByText('First'));
  expect(stack).toContainElement(screen.getByText('Second'));
  expect(stack).toHaveClass('flex-col');
  expect(screen.getByText('First').parentElement).not.toBe(screen.getByText('Second').parentElement);
});
