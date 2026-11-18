import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { TooltipProvider } from '../../ui/Tooltip';
import { ChartPanel } from '../ChartPanel';
import { BarChart, type Series } from './BarChart';
import { PieChart } from './PieChart';
import { Sparkline, type Point } from './Sparkline';

const pt = (i: number, y: number | null): Point => ({ x: `2026-0${i}`, y, label: `M${i}`, valueText: y === null ? '' : `v${y}` });
const wrap = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

test('Sparkline renders one path with the aria label, and a table of the values', () => {
  const { container } = wrap(<Sparkline points={[pt(1, 1), pt(2, 5), pt(3, 3)]} ariaLabel="Orders by month" />);
  expect(container.querySelectorAll('path')).toHaveLength(1);
  expect(screen.getByRole('img', { name: 'Orders by month' })).toBeInTheDocument();
  expect(container.querySelector('table')).toHaveTextContent('v5');
});

const two: Series[] = [
  { name: 'A', color: 'red', points: [pt(1, 1), pt(2, 2), pt(3, null)] },
  { name: 'B', color: 'blue', points: [pt(1, 3), pt(2, 4), pt(3, 5)] },
];

test('BarChart: 2 series x 3 x give 5 rects (null y draws none), a legend, and the values in a table', () => {
  const { container } = wrap(<BarChart series={two} orientation="vertical" ariaLabel="b" formatTick={(n) => `${n}`} />);
  expect(container.querySelectorAll('rect[data-series]')).toHaveLength(5);
  expect(container.querySelector('svg')).toHaveAttribute('data-orientation', 'vertical');
  expect(screen.getByText('A', { selector: 'li' })).toBeInTheDocument();
  expect(container.querySelector('table')).toHaveTextContent('v4');
});

test('BarChart horizontal: rows are 20px with a 2px gap, no legend for one series', () => {
  const { container } = wrap(<BarChart series={[two[1]!]} orientation="horizontal" ariaLabel="b" formatTick={(n) => `${n}`} />);
  expect(container.querySelector('svg')).toHaveAttribute('data-orientation', 'horizontal');
  const rects = [...container.querySelectorAll('rect[data-series]')];
  expect(rects).toHaveLength(3);
  expect(rects.every((r) => r.getAttribute('height') === '18')).toBe(true);
  expect(container.querySelector('.dm-chart-legend')).toBeNull();
});

test('BarChart: hovering a bucket band lists every series with its text and share', async () => {
  const { container } = wrap(<BarChart series={two} orientation="vertical" ariaLabel="b" formatTick={(n) => `${n}`} />);
  const band = container.querySelector('rect[data-bucket="2026-01"]')!;
  fireEvent.focus(band);
  expect((await screen.findAllByText(/A: v1 \(25%\)/)).length).toBeGreaterThan(0);
  expect((await screen.findAllByText(/B: v3 \(75%\)/)).length).toBeGreaterThan(0);
});

test('BarChart: a negative value does not push bars off the plot', () => {
  const s: Series[] = [
    { name: 'A', color: 'red', points: [pt(1, 10)] },
    { name: 'B', color: 'blue', points: [pt(1, -5)] },
  ];
  const { container } = wrap(<BarChart series={s} orientation="vertical" ariaLabel="b" formatTick={(n) => `${n}`} />);
  const rects = [...container.querySelectorAll('rect[data-series]')];
  expect(rects.length).toBeGreaterThan(0);
  for (const r of rects) {
    const y = Number(r.getAttribute('y')); const h = Number(r.getAttribute('height'));
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y + h).toBeLessThanOrEqual(8 + 240);
  }
});

test('PieChart: 3 slices give 3 paths; one slice at 100% is a circle', () => {
  const slices = [1, 2, 3].map((n) => ({ name: `S${n}`, value: n, valueText: `t${n}`, color: 'red' }));
  const { container, unmount } = wrap(<PieChart slices={slices} ariaLabel="p" />);
  expect(container.querySelectorAll('path[data-slice]')).toHaveLength(3);
  expect(container.querySelector('table')).toHaveTextContent('t3');
  unmount();
  const one = wrap(<PieChart slices={[slices[0]!]} ariaLabel="p" />);
  expect(one.container.querySelectorAll('circle[data-slice]')).toHaveLength(1);
  expect(one.container.querySelectorAll('path[data-slice]')).toHaveLength(0);
});

test('ChartPanel shows the error and Retry calls onRetry; empty and note texts show', () => {
  const onRetry = vi.fn();
  const { rerender } = wrap(<ChartPanel title="T" loading={false} error={new Error('nope')} onRetry={onRetry}>x</ChartPanel>);
  expect(screen.getByRole('alert')).toHaveTextContent('nope');
  fireEvent.click(screen.getByText('Retry'));
  expect(onRetry).toHaveBeenCalled();
  rerender(<TooltipProvider><ChartPanel title="T" loading={false} error={null} onRetry={onRetry} empty="No rows">x</ChartPanel></TooltipProvider>);
  expect(screen.getByText('No rows')).toBeInTheDocument();
  rerender(<TooltipProvider><ChartPanel title="T" loading={false} error={null} onRetry={onRetry} note="Top 8">kid</ChartPanel></TooltipProvider>);
  expect(screen.getByText('kid')).toBeInTheDocument();
  expect(screen.getByText('Top 8')).toBeInTheDocument();
});
