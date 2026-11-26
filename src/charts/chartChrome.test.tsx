import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ChartMenu } from './ChartMenu';
import { ChartPanel } from './ChartPanel';


test('every ⋮ button carries the dots class, so it is Sheets grey and can be revealed by its chart', () => {
  render(<ChartMenu name="Pie" items={[]} />);
  expect(screen.getByRole('button', { name: 'Pie options' })).toHaveClass('dm-menu-dots');
});

test('the panel keeps its content in a body that follows its height', () => {
  const { container } = render(<ChartPanel title="T" name="Pie" items={[]} width="min(100%, 26rem)" loading={false} error={null} onRetry={() => {}}><i data-x /></ChartPanel>);
  expect(container.querySelector('.dm-chart-body .dm-chart-fit [data-x]')).not.toBeNull();
  expect(container.querySelector('section')?.getAttribute('style')).toContain('min(100%, 26rem)');
});
