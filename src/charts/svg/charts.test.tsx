import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { TooltipProvider } from '../../ui/Tooltip';
import { ChartPanel } from '../ChartPanel';
import { BarChart, type Series } from './BarChart';
import { PieChart } from './PieChart';
import { LineChart } from './LineChart';
import { Heatmap } from './Heatmap';
import { Scatter } from './Scatter';
import { SpreadChart } from './SpreadChart';
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

test('BarChart shows the X field name under the bucket labels, and nothing without it', () => {
  const { container, rerender } = wrap(<BarChart series={two} orientation="vertical" ariaLabel="b" formatTick={(n) => `${n}`} xTitle="Order date" />);
  const title = container.querySelector('.dm-chart-axis-title');
  expect(title).toHaveTextContent('Order date');
  const labelY = Number(container.querySelector('text.dm-chart-text[text-anchor="middle"]')!.getAttribute('y'));
  // 18px below the labels' baseline was the old gap; 8px more keeps the title off them.
  expect(Number(title!.getAttribute('y')) - labelY).toBeGreaterThanOrEqual(26);
  rerender(<TooltipProvider><BarChart series={two} orientation="vertical" ariaLabel="b" formatTick={(n) => `${n}`} /></TooltipProvider>);
  expect(container.querySelector('.dm-chart-axis-title')).toBeNull();
});

test('BarChart truncates a long X field name and keeps the full name in a title', () => {
  const long = 'a_very_long_field_name_'.repeat(8);
  const { container } = wrap(<BarChart series={two} orientation="horizontal" ariaLabel="b" formatTick={(n) => `${n}`} xTitle={long} />);
  const el = container.querySelector('.dm-chart-axis-title')!;
  const shown = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
  expect(shown).toMatch(/…$/);
  expect(shown.length).toBeLessThan(long.length);
  expect(el.querySelector('title')).toHaveTextContent(long);
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
  const swatch = document.body.querySelector('[role="tooltip"] .dm-chart-swatch, .dm-hint-body .dm-chart-swatch') as HTMLElement;
  expect(swatch).toHaveClass('dm-chart-swatch');
  expect(swatch.style.background).toBe('red');
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

test('ChartPanel shows the error and Retry calls onRetry; empty text shows; the note is the (i) by the title', () => {
  const onRetry = vi.fn();
  const { rerender } = wrap(<ChartPanel title="T" name="T" items={null} width="20rem" loading={false} error={new Error('nope')} onRetry={onRetry}>x</ChartPanel>);
  expect(screen.getByRole('alert')).toHaveTextContent('nope');
  fireEvent.click(screen.getByText('Retry'));
  expect(onRetry).toHaveBeenCalled();
  rerender(<TooltipProvider><ChartPanel title="T" name="T" items={null} width="20rem" loading={false} error={null} onRetry={onRetry} empty="No rows">x</ChartPanel></TooltipProvider>);
  expect(screen.getByText('No rows')).toBeInTheDocument();
  rerender(<TooltipProvider><ChartPanel title="T" name="T" items={null} width="20rem" loading={false} error={null} onRetry={onRetry} note="Top 8">kid</ChartPanel></TooltipProvider>);
  expect(screen.getByText('kid')).toBeInTheDocument();
  expect(screen.queryByText('Top 8')).toBeNull();
  expect(screen.getByRole('note', { name: 'About T' }).closest('.dm-chart-head')).not.toBeNull();
});

const px = (x: string, y: number): Point => ({ x, y, label: x, valueText: `v${y}` });

test('BarChart: with clickable buckets the svg is a group and every band is the tab stop; a blank bucket is not clickable; segments are mouse only', () => {
  const s: Series[] = [
    { name: 'A', color: 'red', points: [px('2026-01-01', 1), px('null', 2)] },
    { name: 'B', color: 'blue', points: [px('2026-01-01', 3), px('null', 4)] },
  ];
  const { container } = wrap(<BarChart series={s} orientation="vertical" ariaLabel="b" formatTick={(n) => `${n}`} onPick={() => {}} canPick={(x) => x !== 'null'} stacked />);
  expect(container.querySelector('svg')).toHaveAttribute('role', 'group');
  expect(container.querySelector('svg')).toHaveAttribute('aria-label', 'b');
  const band = container.querySelector('rect[data-bucket="2026-01-01"]')!;
  expect(band).toHaveAttribute('tabindex', '0');
  expect(band.getAttribute('aria-label')).toMatch(/^Filter to /);
  const blank = container.querySelector('rect[data-bucket="null"]')!;
  expect(blank.hasAttribute('tabindex')).toBe(false);
  expect(blank.hasAttribute('role')).toBe(false);
  expect(container.querySelectorAll('rect[data-series][tabindex]')).toHaveLength(0);
});

test('BarChart: a single stacked series still counts as stacked when the caller says so; no onPick keeps role img', () => {
  const one: Series[] = [{ name: 'A', color: 'red', points: [px('2026-01-01', 1)] }];
  const a = wrap(<BarChart series={one} orientation="vertical" ariaLabel="b" formatTick={(n) => `${n}`} />);
  expect(a.container.querySelector('svg')).toHaveAttribute('role', 'img');
  a.unmount();
  const b = wrap(<BarChart series={one} orientation="vertical" ariaLabel="b" formatTick={(n) => `${n}`} onPick={() => {}} stacked />);
  expect(b.container.querySelector('svg')).toHaveAttribute('role', 'group');
  expect(b.container.querySelectorAll('rect[data-series][tabindex]')).toHaveLength(0);
});

test('PieChart: clickable slices make the svg a group; share can be hidden', async () => {
  const slices = [{ name: 'a', value: 1, valueText: 'v1', color: 'red' }, { name: 'b', value: 3, valueText: 'v3', color: 'blue' }];
  const g = wrap(<PieChart slices={slices} ariaLabel="p" onPick={() => {}} showShare={false} />);
  expect(g.container.querySelector('svg')).toHaveAttribute('role', 'group');
  fireEvent.focus(g.container.querySelector('[data-slice="a"]')!);
  expect((await screen.findAllByText('a: v1')).length).toBeGreaterThan(0);
  expect(screen.queryByText(/25%/)).toBeNull();
  g.unmount();
  const i = wrap(<PieChart slices={slices} ariaLabel="p" />);
  expect(i.container.querySelector('svg')).toHaveAttribute('role', 'img');
});


const pts = (ys: (number | null)[]) => ys.map((y, i) => ({ x: `2026-0${i + 1}-01`, label: `M${i + 1}`, y, valueText: String(y) }));

test('LineChart draws one path per series, a right axis for the second measure and area fills when asked', () => {
  const { container } = wrap(<LineChart left={[{ name: 'A', color: 'red', points: pts([1, 3, 2]) }]} right={{ name: 'B', color: 'blue', points: pts([100, 50, 80]) }}
    area ariaLabel="A and B" formatLeft={String} formatRight={(n) => `${n}%`} />);
  expect(container.querySelectorAll('path[data-line]')).toHaveLength(2);
  expect(container.querySelectorAll('path[data-area]')).toHaveLength(2);
  expect(container.querySelector('[data-axis="right"]')).not.toBeNull();
  expect(screen.getByRole('img', { name: 'A and B' })).toBeTruthy();
});

test('LineChart: a null value breaks the line; a bucket is pickable by keyboard', async () => {
  const onPick = vi.fn();
  const { container } = wrap(<LineChart left={[{ name: 'A', color: 'red', points: pts([1, null, 2]) }]} area={false} ariaLabel="A" formatLeft={String} onPick={onPick} />);
  expect(container.querySelector('path[data-line]')!.getAttribute('d')!.match(/M/g)).toHaveLength(2);
  const first = screen.getByRole('button', { name: 'Filter to M1' });
  first.focus();
  await userEvent.keyboard('{Enter}');
  expect(onPick).toHaveBeenCalledWith('2026-01-01');
});

test('LineChart aligns a second series by bucket, not by position', () => {
  const left = [{ name: 'A', color: 'red', points: [{ x: '2026-01-01', label: 'M1', y: 1, valueText: 'a1' }, { x: '2026-02-01', label: 'M2', y: 2, valueText: 'a2' }] }];
  const right = { name: 'B', color: 'blue', points: [{ x: '2026-02-01', label: 'M2', y: 20, valueText: 'b2' }, { x: '2026-03-01', label: 'M3', y: 30, valueText: 'b3' }] };
  const { container } = wrap(<LineChart left={left} right={right} area={false} ariaLabel="x" formatLeft={String} />);
  const rows = [...container.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent));
  expect(rows).toEqual([['M1', 'a1', ''], ['M2', 'a2', 'b2'], ['M3', '', 'b3']]);
});

test('Heatmap draws a cell per pair with a value, darker for larger values, and picks a cell by keyboard', async () => {
  const onPick = vi.fn();
  const values: Record<string, number> = { 'x1|y1': 1, 'x2|y1': 4 };
  wrap(<Heatmap xs={[{ key: 'x1', label: 'X1' }, { key: 'x2', label: 'X2' }]} ys={[{ key: 'y1', label: 'Y1' }]} ariaLabel="H"
    cell={(x, y) => (values[`${x}|${y}`] === undefined ? undefined : { value: values[`${x}|${y}`]!, text: String(values[`${x}|${y}`]) })} onPick={onPick} />);
  const cells = document.querySelectorAll('rect[data-cell]');
  expect(cells).toHaveLength(2);
  expect(Number(cells[1]!.getAttribute('fill-opacity'))).toBeGreaterThan(Number(cells[0]!.getAttribute('fill-opacity')));
  screen.getByRole('button', { name: 'Filter to X2, Y1' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(onPick).toHaveBeenCalledWith('x2', 'y1');
});

test('Scatter draws one dot per point and picks one by keyboard', async () => {
  const onPick = vi.fn();
  wrap(<Scatter ariaLabel="S" xTitle="X" yTitle="Y" formatX={String} formatY={String} onPick={onPick}
    points={[{ key: 'p', label: 'P', x: 1, y: 2, xText: '1', yText: '2' }, { key: 'q', label: 'Q', x: 3, y: 1, xText: '3', yText: '1' }]} />);
  expect(document.querySelectorAll('circle[data-dot]')).toHaveLength(2);
  screen.getByRole('button', { name: 'Filter to Q' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(onPick).toHaveBeenCalledWith('q');
});

test('SpreadChart draws a box and a median per row, whiskers only with min and max', () => {
  wrap(<SpreadChart ariaLabel="Sp" formatTick={String} rows={[
    { key: 'a', label: 'A', p25: 2, p50: 3, p75: 5, min: 1, max: 9, text: 'median 3' },
    { key: 'b', label: 'B', p25: 1, p50: 2, p75: 3, min: null, max: null, text: 'median 2' },
  ]} />);
  expect(document.querySelectorAll('rect[data-box]')).toHaveLength(2);
  expect(document.querySelectorAll('line[data-median]')).toHaveLength(2);
  expect(document.querySelectorAll('line[data-whisker]')).toHaveLength(1);
});

const tickTexts = (container: HTMLElement, y: string) => [...container.querySelectorAll('svg text')].filter((t) => t.getAttribute('y') === y);

test('Heatmap with 60 buckets keeps every cell inside the svg width', () => {
  const xs = Array.from({ length: 60 }, (_, i) => ({ key: `x${i}`, label: `X${i}` }));
  const { container } = wrap(<Heatmap xs={xs} ys={[{ key: 'y1', label: 'Y1' }]} ariaLabel="H" cell={() => ({ value: 1, text: '1' })} />);
  const vbWidth = Number(container.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[2]);
  const cells = [...container.querySelectorAll('rect[data-cell]')];
  expect(cells).toHaveLength(60);
  for (const c of cells) expect(Number(c.getAttribute('x')) + Number(c.getAttribute('width'))).toBeLessThanOrEqual(vbWidth);
});

test('a ranked bar anchors its first tick start and its last tick end', () => {
  const { container } = wrap(<BarChart series={[two[1]!]} orientation="horizontal" ariaLabel="b" formatTick={(n) => `${n}`} />);
  const ticks = [...container.querySelectorAll('g.dm-chart-tick text')];
  expect(ticks.map((t) => t.getAttribute('text-anchor'))).toEqual(['start', 'middle', 'middle', 'end']);
});

test('Scatter anchors its first x tick start and its last end', () => {
  const { container } = wrap(<Scatter ariaLabel="S" xTitle="X" yTitle="Y" formatX={String} formatY={String}
    points={[{ key: 'p', label: 'P', x: 1, y: 2, xText: '1', yText: '2' }, { key: 'q', label: 'Q', x: 3, y: 1, xText: '3', yText: '1' }]} />);
  const xt = tickTexts(container, String(8 + 220 + 14));
  expect(xt.length).toBe(4);
  expect(xt[0]).toHaveAttribute('text-anchor', 'start');
  expect(xt[3]).toHaveAttribute('text-anchor', 'end');
});

test('SpreadChart anchors its first tick start and its last end', () => {
  const { container } = wrap(<SpreadChart ariaLabel="Sp" formatTick={String} rows={[{ key: 'a', label: 'A', p25: 2, p50: 3, p75: 5, min: 1, max: 9, text: 'm' }]} />);
  const xt = [...container.querySelectorAll('svg g > text')].filter((t) => !t.hasAttribute('dominant-baseline'));
  expect(xt[0]).toHaveAttribute('text-anchor', 'start');
  expect(xt.at(-1)).toHaveAttribute('text-anchor', 'end');
});

test('BarChart: a count axis shows whole-number ticks only', () => {
  const counts: Series[] = [{ name: 'n', color: 'red', points: [pt(1, 24), pt(2, 73)] }];
  const { container } = wrap(<BarChart series={counts} orientation="vertical" ariaLabel="b" formatTick={(n) => `${n}`} integer />);
  const ticks = [...container.querySelectorAll('.dm-chart-tick text')].map((t) => t.textContent);
  expect(ticks).toEqual(['0', '20', '40', '60', '80']);
});

test('the X title keeps 8px more room under the tick labels in the line, scatter and heatmap too', () => {
  const lines = wrap(<LineChart left={two} area={false} ariaLabel="l" formatLeft={(n) => `${n}`} xTitle="Date" />).container;
  const tick = (c: HTMLElement) => Number(c.querySelector('text.dm-chart-text[text-anchor="middle"]')!.getAttribute('y'));
  expect(Number(lines.querySelector('.dm-chart-axis-title')!.getAttribute('y')) - tick(lines)).toBeGreaterThanOrEqual(26);
  const heat = wrap(<Heatmap xs={[{ key: 'a', label: 'A' }]} ys={[{ key: 'r', label: 'R' }]} cell={() => ({ value: 1, text: '1' })} ariaLabel="h" xTitle="Col" />).container;
  expect(Number(heat.querySelector('.dm-chart-axis-title')!.getAttribute('y')) - tick(heat)).toBeGreaterThanOrEqual(26);
});

const yTitles = (c: HTMLElement) => [...c.querySelectorAll('[data-y-title]')].map((t) => ({ text: t.querySelector('title')!.textContent, rotated: t.getAttribute('transform')?.startsWith('rotate(-90') }));

test('every chart with a Y axis draws its title vertically beside the ticks', () => {
  const bar = wrap(<BarChart series={two} orientation="vertical" ariaLabel="b" formatTick={(n) => `${n}`} xTitle="Date" yTitle="Amount · Sum" />).container;
  expect(yTitles(bar)).toEqual([{ text: 'Amount · Sum', rotated: true }]);
  expect(bar.querySelector('.dm-chart-axis-title:not([data-y-title])')).toHaveTextContent('Date');
  const line = wrap(<LineChart left={two} right={two[1]} area={false} ariaLabel="l" formatLeft={(n) => `${n}`} yTitle="Left" yTitleRight="Right" />).container;
  expect(yTitles(line).map((t) => t.text)).toEqual(['Left', 'Right']);
  const heat = wrap(<Heatmap xs={[{ key: 'a', label: 'A' }]} ys={[{ key: 'r', label: 'R' }]} cell={() => ({ value: 1, text: '1' })} ariaLabel="h" yTitle="Rows" />).container;
  expect(yTitles(heat)).toEqual([{ text: 'Rows', rotated: true }]);
  const spread = wrap(<SpreadChart rows={[{ key: 'a', label: 'A', p25: 1, p50: 2, p75: 3, min: null, max: null, text: 't' }]} ariaLabel="s" formatTick={(n) => `${n}`} yTitle="Channel" />).container;
  expect(yTitles(spread)).toEqual([{ text: 'Channel', rotated: true }]);
  const dots = wrap(<Scatter points={[{ key: 'a', label: 'A', x: 1, y: 2, xText: '1', yText: '2' }]} ariaLabel="sc" xTitle="X" yTitle="Y" formatX={(n) => `${n}`} formatY={(n) => `${n}`} />).container;
  expect(yTitles(dots)).toEqual([{ text: 'Y', rotated: true }]);
});

test('a horizontal bar puts the measure under the value ticks and the category beside its labels', () => {
  const { container } = wrap(<BarChart series={two} orientation="horizontal" ariaLabel="b" formatTick={(n) => `${n}`} xTitle="Channel" yTitle="Amount · Sum" />);
  expect(yTitles(container)).toEqual([{ text: 'Channel', rotated: true }]);
  expect(container.querySelector('.dm-chart-axis-title:not([data-y-title])')).toHaveTextContent('Amount · Sum');
});

test('PieChart: the blank slice and a real value named "(blank)" are separate elements (keyed by category, not by name)', () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const slices = [
    { key: '\u0000blank', name: '(blank)', value: 1, valueText: 't1', color: 'red', blank: true },
    { key: '(blank)', name: '(blank)', value: 2, valueText: 't2', color: 'blue' },
    { key: '\u0000other', name: 'Other', value: 3, valueText: 't3', color: 'grey', other: true },
    { key: 'Other', name: 'Other', value: 4, valueText: 't4', color: 'green' },
  ];
  const { container } = wrap(<PieChart slices={slices} ariaLabel="p" />);
  expect(container.querySelectorAll('path[data-slice]')).toHaveLength(4);
  expect(err.mock.calls.filter((c) => String(c[0]).includes('same key'))).toHaveLength(0);
  err.mockRestore();
});
