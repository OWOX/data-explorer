import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { TooltipProvider } from '../../ui/Tooltip';
import { BLANK_KEY, OTHER_KEY } from '../blank';
import { REST_ORIGIN, type Flow } from '../sankeyLayout';
import { Sankey } from './Sankey';

const flows: Flow[][] = [
  [{ source: 'a', target: 'x', value: 5 }, { source: BLANK_KEY, target: 'x', value: 2 }, { source: 'a', target: OTHER_KEY, value: 3 }],
  [{ source: 'x', target: 'z', value: 7 }],
];
const draw = (props: Partial<Parameters<typeof Sankey>[0]> = {}) => render(<TooltipProvider><Sankey titles={['One', 'Two', 'Three']} flows={flows} ariaLabel="S" text={(v) => `$${v}`} {...props} /></TooltipProvider>);

// Keys carry a NUL, which a CSS attribute selector cannot hold.
const byAttr = (attr: string, value: string) => [...document.querySelectorAll(`[${attr}]`)].find((el) => el.getAttribute(attr) === value) ?? null;

test('draws a node per value and a filled ribbon per flow, with the column titles', () => {
  const { container } = draw();
  expect(container.querySelectorAll('rect[data-node]')).toHaveLength(5);
  expect(container.querySelectorAll('path[data-link]')).toHaveLength(4);
  const ribbon = container.querySelector('path[data-link]')!;
  expect(ribbon.getAttribute('fill')).toMatch(/^var\(--/);
  expect(ribbon.getAttribute('stroke')).toBeNull();
  for (const t of ['One', 'Two', 'Three']) expect(screen.getAllByText(t, { selector: 'text.dm-chart-axis-title' })).toHaveLength(1);
  // No native hover title: the shared tooltip carries the full text.
  expect(container.querySelector('title')).toBeNull();
  expect(byAttr('data-node', `0|${BLANK_KEY}`)).not.toBeNull();
});

test('a column title shows its full text in the shared tooltip', async () => {
  draw({ titles: ['One', 'Two', 'Three'] });
  await userEvent.hover(screen.getByText('Two', { selector: 'text.dm-chart-axis-title' }));
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Two');
});

test('labels name the node and its value', () => {
  const { container } = draw();
  expect(container.querySelector('title')).toBeNull();
  expect([...container.querySelectorAll('text')].some((t) => t.textContent?.includes('(blank) $2'))).toBe(true);
});

test('a node picks its column and key by keyboard; Other is not pickable', async () => {
  const onPickNode = vi.fn();
  draw({ onPickNode });
  screen.getByRole('button', { name: 'Filter to One: a' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(onPickNode).toHaveBeenCalledWith(0, 'a');
  screen.getByRole('button', { name: 'Filter to One: (blank)' }).focus();
  await userEvent.keyboard(' ');
  expect(onPickNode).toHaveBeenLastCalledWith(0, BLANK_KEY);
  expect(screen.queryByRole('button', { name: 'Filter to One: Other' })).toBeNull();
  expect(byAttr('data-node', `1|${OTHER_KEY}`)!.getAttribute('role')).toBeNull();
});

test('a ribbon picks its pair and both values by click, never through Other, and is not a tab stop', async () => {
  const onPickLink = vi.fn();
  draw({ onPickLink });
  await userEvent.click(byAttr('data-link', '0|a|x')!);
  expect(onPickLink).toHaveBeenCalledWith(0, 'a', 'x');
  await userEvent.click(byAttr('data-link', '1|x|z|x')!);
  expect(onPickLink).toHaveBeenLastCalledWith(1, 'x', 'z');
  await userEvent.click(byAttr('data-link', `0|a|${OTHER_KEY}`)!);
  expect(onPickLink).toHaveBeenCalledTimes(2);
  expect(document.querySelectorAll('path[data-link][tabindex]')).toHaveLength(0);
  expect(screen.queryAllByRole('button', { name: /→/ })).toHaveLength(0);
});

test('nodes are the only tab stops, and their labels name the column', () => {
  draw({ onPickNode: () => {}, onPickLink: () => {} });
  expect(screen.getByRole('button', { name: 'Filter to Two: x' })).toHaveAttribute('tabindex', '0');
  expect(screen.getByRole('button', { name: 'Filter to Three: z' })).toBeInTheDocument();
  expect(document.querySelectorAll('[tabindex]').length).toBe(document.querySelectorAll('rect[data-node][role="button"]').length);
});

test('exact column totals size a node beyond its flows', () => {
  draw({ columns: [[{ key: 'a', value: 50 }, { key: 'q', value: 20 }], [{ key: 'x', value: 7 }], [{ key: 'z', value: 7 }]] });
  expect(byAttr('data-node', '0|q')).not.toBeNull();
  const label = [...document.querySelectorAll('text')].some((t) => t.textContent?.includes('q $20'));
  expect(label).toBe(true);
});

test('hovering a node lights its ribbons through the DOM (data-hot, is-on) and leaves them when it ends', async () => {
  const { container } = draw({ onPickNode: () => {} });
  const svg = container.querySelector('svg')!;
  expect(svg.hasAttribute('data-hot')).toBe(false);
  await userEvent.hover(container.querySelector('rect[data-node="1|x"]')!);
  expect(svg.hasAttribute('data-hot')).toBe(true);
  expect(byAttr('data-link', '0|a|x')!.classList.contains('is-on')).toBe(true);
  expect(byAttr('data-link', `0|a|${OTHER_KEY}`)!.classList.contains('is-on')).toBe(false);
  expect(container.querySelector('rect[data-node="1|x"]')!.classList.contains('is-hot')).toBe(true);
  await userEvent.unhover(container.querySelector('rect[data-node="1|x"]')!);
  expect(svg.hasAttribute('data-hot')).toBe(false);
  expect(container.querySelectorAll('.is-on, .is-hot')).toHaveLength(0);
});

test('a new layout clears the lit state, so a hover the old layout left behind cannot dim the chart', async () => {
  const props = { titles: ['One', 'Two', 'Three'], ariaLabel: 'S', text: (v: number) => `$${v}`, onPickNode: () => {} };
  const { container, rerender } = render(<TooltipProvider><Sankey {...props} flows={flows} /></TooltipProvider>);
  const svg = container.querySelector('svg')!;
  await userEvent.hover(container.querySelector('rect[data-node="1|x"]')!);
  expect(svg.hasAttribute('data-hot')).toBe(true);
  rerender(<TooltipProvider><Sankey {...props} flows={flows.map((p) => [...p])} /></TooltipProvider>);
  expect(svg.hasAttribute('data-hot')).toBe(false);
  expect(container.querySelectorAll('.is-on, .is-hot')).toHaveLength(0);
});

test('hovering a ribbon lights that ribbon alone', async () => {
  const { container } = draw();
  await userEvent.hover(byAttr('data-link', '0|a|x')!);
  expect([...container.querySelectorAll('.is-on')]).toEqual([byAttr('data-link', '0|a|x')]);
});

test('hover does not re-render the ribbons: their elements are the same nodes and none is added or lost', async () => {
  const { container } = draw();
  const before = [...container.querySelectorAll('path[data-link]')];
  await userEvent.hover(before[0]!);
  await userEvent.unhover(before[0]!);
  expect([...container.querySelectorAll('path[data-link]')]).toEqual(before);
});

test('a screen reader gets a table of the flows', () => {
  const { container } = draw();
  const rows = [...container.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent));
  expect(rows).toContainEqual(['One → Two', 'a', 'a', 'x', '$5']);
  // A later pair names the column-1 node the flow started from.
  expect(rows).toContainEqual(['Two → Three', 'x', 'x', 'z', '$7']);
  expect([...container.querySelectorAll('thead th')].map((c) => c.textContent)).toEqual(['Columns', 'From (column 1)', 'From', 'To', 'Value']);
});

test('many small ribbons of one pair are merged into one rest ribbon per (source, target), keeping the total', () => {
  const many: Flow[] = Array.from({ length: 300 }, (_, i) => ({ source: 'x', target: 'z', origin: `o${i}`, value: 1 }));
  const big: Flow[] = [{ source: 'x', target: 'z', origin: 'big', value: 5000 }];
  const { container } = draw({ flows: [[{ source: 'big', target: 'x', value: 5000 }, ...many.map((f) => ({ source: f.origin!, target: 'x', value: 1 }))], [...big, ...many]] });
  const pair1 = [...container.querySelectorAll('path[data-link]')].filter((p) => p.getAttribute('data-link')!.startsWith('1|'));
  expect(pair1).toHaveLength(2);
  const rest = pair1.find((p) => p.getAttribute('data-link')!.includes(REST_ORIGIN))!;
  expect(rest.parentElement).not.toBeNull();
  expect([...container.querySelectorAll('tbody tr')].some((tr) => tr.textContent === `Two → ThreeOther originsxz$300`)).toBe(true);
});

test('a blank node is filled with the hatch pattern and has no stroke', () => {
  const { container } = draw();
  const blank = byAttr('data-node', `0|${BLANK_KEY}`)!;
  expect(blank.getAttribute('fill')).toMatch(/^url\(#dm-blank-/);
  expect(blank.getAttribute('stroke')).toBeNull();
  expect(container.querySelector('pattern')).not.toBeNull();
});

test('fan-out: ribbons that add up to more than their node are scaled to fit it; the tooltip keeps the exact value', async () => {
  const fan: Flow[][] = [[{ source: 'a', target: 'x', value: 8, origin: 'a' }, { source: 'a', target: 'y', value: 8, origin: 'a' }]];
  const { container } = draw({ titles: ['One', 'Two'], flows: fan, fit: true, columns: [[{ key: 'a', value: 10 }], [{ key: 'x', value: 8 }, { key: 'y', value: 8 }]] });
  const node = container.querySelector('rect[data-node="0|a"]')!;
  const h = Number(node.getAttribute('height'));
  const links = [...container.querySelectorAll('path[data-link]')];
  expect(links).toHaveLength(2);
  const heights = links.map((l) => { const nums = l.getAttribute('d')!.match(/-?\d+\.?\d*/g)!.map(Number); return nums[1]! ; });
  expect(heights[1]! - heights[0]!).toBeLessThanOrEqual(h / 2 + 0.01);
  await userEvent.hover(links[0]!);
  expect(await screen.findAllByText(/8/)).not.toHaveLength(0);
});
