import { EyeOff } from 'lucide-react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { internals } from './copyImage';
import { ChartPanel } from './ChartPanel';
import { TooltipProvider } from '../ui/Tooltip';

test('Copy to clipboard on a loading chart says there is nothing to copy and renders no image', async () => {
  const spy = vi.spyOn(internals, 'render');
  render(<ChartPanel title="T" name="Pie" items={[{ kind: 'action', label: 'Hide', icon: EyeOff, onPick: () => {} }]} ready hasFilters={false} width="26rem" loading>x</ChartPanel>);
  await userEvent.click(screen.getByRole('button', { name: 'Pie options' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Copy to clipboard' }));
  expect(await screen.findByText('Nothing to copy yet')).toBeTruthy();
  expect(spy).not.toHaveBeenCalled();
});

test('empty true shows the standard text for the filters, and a failure shows the error with its retry', async () => {
  const retry = vi.fn();
  const panel = (props: Partial<Parameters<typeof ChartPanel>[0]>) => <TooltipProvider><ChartPanel title="T" name="Pie" items={[]} ready hasFilters={false} width="26rem" loading={false} {...props}>x</ChartPanel></TooltipProvider>;
  const { rerender } = render(panel({ hasFilters: true, empty: true }));
  expect(screen.getByText('No rows match the filters.')).toBeTruthy();
  rerender(panel({ empty: true }));
  expect(screen.getByText('This data mart has no rows.')).toBeTruthy();
  rerender(panel({ failed: { error: new Error('boom'), retry } }));
  await userEvent.click(screen.getByText('Retry'));
  expect(retry).toHaveBeenCalled();
});

describe('a reload keeps the last drawing', () => {
  const panel = (props: Partial<Parameters<typeof ChartPanel>[0]>, body: string) => <TooltipProvider><ChartPanel title="T" name="Pie" items={[]} ready hasFilters={false} width="26rem" loading={false} {...props}>{body}</ChartPanel></TooltipProvider>;
  test('the old body stays dimmed and busy while loading, then the new one shows', () => {
    const { rerender, container } = render(panel({}, 'old'));
    rerender(panel({ loading: true }, 'new'));
    expect(screen.getByText('old').closest('[aria-busy="true"]')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Loading chart' })).toBeTruthy();
    expect(screen.queryByLabelText('Loading')).toBeNull();
    rerender(panel({}, 'new'));
    expect(screen.getByText('new')).toBeTruthy();
    expect(screen.queryByText('old')).toBeNull();
    expect(container.querySelector('[aria-busy]')).toBeNull();
  });
  test('loading after an error or an empty result, or in another kind, shows a skeleton', () => {
    const a = render(panel({}, 'old'));
    a.rerender(panel({ failed: { error: new Error('x'), retry: () => {} } }, 'old'));
    a.rerender(panel({ loading: true }, 'old'));
    expect(a.queryByLabelText('Loading')).toBeTruthy();
    expect(screen.queryByText('old')).toBeNull();
    a.unmount();
    const b = render(panel({}, 'old'));
    b.rerender(panel({ empty: true }, 'old'));
    b.rerender(panel({ loading: true }, 'old'));
    expect(b.queryByLabelText('Loading')).toBeTruthy();
    b.unmount();
    const c = render(panel({}, 'old'));
    c.rerender(panel({ loading: true, name: 'Bar' }, 'old'));
    expect(c.queryByLabelText('Loading')).toBeTruthy();
  });
  test('Copy to clipboard on the stale drawing says there is nothing to copy', async () => {
    const spy = vi.spyOn(internals, 'render');
    const items = [{ kind: 'action' as const, label: 'Hide', icon: EyeOff, onPick: () => {} }];
    const { rerender } = render(panel({ items }, 'old'));
    rerender(panel({ items, loading: true }, 'old'));
    await userEvent.click(screen.getByRole('button', { name: 'Pie options' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy to clipboard' }));
    expect(await screen.findByText('Nothing to copy yet')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });
});
