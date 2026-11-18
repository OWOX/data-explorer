import { act, render, screen } from '@testing-library/react';
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

test('a toast dismisses itself after about six seconds', () => {
  vi.useFakeTimers();
  try {
    const onDismiss = vi.fn();
    render(<Toast onDismiss={onDismiss}>Copied 3 rows</Toast>);
    act(() => { vi.advanceTimersByTime(TOAST_MS - 1); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
