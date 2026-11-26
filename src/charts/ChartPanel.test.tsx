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
