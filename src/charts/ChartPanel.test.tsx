import { EyeOff } from 'lucide-react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { internals } from './copyImage';
import { ChartPanel } from './ChartPanel';

test('Copy to clipboard on a loading chart says there is nothing to copy and renders no image', async () => {
  const spy = vi.spyOn(internals, 'render');
  render(<ChartPanel title="T" name="Pie" items={[{ kind: 'action', label: 'Hide', icon: EyeOff, onPick: () => {} }]} width="26rem" loading error={null} onRetry={() => {}}>x</ChartPanel>);
  await userEvent.click(screen.getByRole('button', { name: 'Pie options' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Copy to clipboard' }));
  expect(await screen.findByText('Nothing to copy yet')).toBeTruthy();
  expect(spy).not.toHaveBeenCalled();
});
