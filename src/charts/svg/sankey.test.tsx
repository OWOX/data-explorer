import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, vi } from 'vitest';
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

test('a column title that is cut shows its full text in the shared tooltip and as its name; one that fits has neither', async () => {
  const long = 'A very long column title that cannot fit';
  const { container } = draw({ titles: ['One', long, 'Three'] });
  const cut = [...container.querySelectorAll('text.dm-chart-axis-title')].find((t) => t.getAttribute('aria-label') === long)!;
  expect(cut.textContent).not.toBe(long);
  expect(container.querySelector('text.dm-chart-axis-title:not([aria-label])')?.textContent).toBe('One');
  await userEvent.hover(cut);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(long);
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
  const columns = [[{ key: 'a', value: 10 }], [{ key: 'x', value: 8 }, { key: 'y', value: 8 }]];
  // The ribbons' widths at the source end, and the node's height.
  const measure = (fit: boolean) => {
    const { container, unmount } = draw({ titles: ['One', 'Two'], flows: fan, fit, columns });
    const h = Number(container.querySelector('rect[data-node="0|a"]')!.getAttribute('height'));
    const widths = [...container.querySelectorAll('path[data-link]')].map((l) => { const nums = l.getAttribute('d')!.match(/-?\d+\.?\d*/g)!.map(Number); return nums[nums.length - 1]! - nums[1]!; });
    const links = [...container.querySelectorAll('path[data-link]')];
    return { h, widths, links, unmount };
  };
  const off = measure(false);
  off.unmount();
  const on = measure(true);
  // Without fit the node grows to hold 16; with fit it is its column total (10) and the ribbons add up to exactly that.
  expect(on.h / off.h).toBeCloseTo(10 / 16, 1);
  expect(off.widths[0]! + off.widths[1]!).toBeCloseTo(off.h, 0);
  expect(on.widths).toHaveLength(2);
  expect(on.widths[0]! + on.widths[1]!).toBeCloseTo(on.h, 0);
  await userEvent.hover(on.links[0]!);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('a → x: $8 (50%)');
});

// A tooltip the pointer can enter outlives its trigger's unhover (jsdom has no layout for Radix's grace area), so Escape closes it before the next one.
const closeTip = async () => { await userEvent.keyboard('{Escape}'); await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull()); };
const tip = async (el: Element) => { await userEvent.hover(el); const text = (await screen.findByRole('tooltip')).textContent; await closeTip(); return text; };

test('a node tooltip gives its share of its drawn column: a node bigger than its flows, with (blank) and Other in the total', async () => {
  // Column 0 totals 10 + 2 + 3 = 15; its flows are smaller than node a.
  draw({ columns: [[{ key: 'a', value: 10 }, { key: BLANK_KEY, value: 2 }, { key: OTHER_KEY, value: 3 }], [{ key: 'x', value: 7 }, { key: OTHER_KEY, value: 3 }], [{ key: 'z', value: 7 }]] });
  expect(await tip(byAttr('data-node', '0|a')!)).toBe('a: $10 (67%)');
  await userEvent.unhover(byAttr('data-node', '0|a')!);
  expect(await tip(byAttr('data-node', `0|${BLANK_KEY}`)!)).toBe('(blank): $2 (13%)');
  await userEvent.unhover(byAttr('data-node', `0|${BLANK_KEY}`)!);
  expect(await tip(byAttr('data-node', `0|${OTHER_KEY}`)!)).toBe('Other: $3 (20%)');
});

test('with flows only, a node tooltip gives its share of the column its flows make, each column against its own total', async () => {
  const two: Flow[][] = [[{ source: 'a', target: 'x', value: 6 }, { source: 'b', target: 'x', value: 2 }, { source: 'b', target: 'y', value: 2 }], [{ source: 'x', target: 'z', value: 3 }, { source: 'y', target: 'z', value: 1 }]];
  draw({ flows: two });
  // Column 0 totals 10, column 1 totals 10 (x 8, y 2), column 2 totals 4: one node, 100%.
  expect(await tip(byAttr('data-node', '0|a')!)).toBe('a: $6 (60%)');
  await userEvent.unhover(byAttr('data-node', '0|a')!);
  expect(await tip(byAttr('data-node', '1|x')!)).toBe('x: $8 (80%)');
  await userEvent.unhover(byAttr('data-node', '1|x')!);
  expect(await tip(byAttr('data-node', '2|z')!)).toBe('z: $4 (100%)');
});

test('two columns with different totals are each their own denominator', async () => {
  draw({ titles: ['One', 'Two'], flows: [[{ source: 'a', target: 'x', value: 2 }]], columns: [[{ key: 'a', value: 2 }, { key: 'b', value: 8 }], [{ key: 'x', value: 2 }, { key: 'y', value: 2 }]] });
  expect(await tip(byAttr('data-node', '0|a')!)).toBe('a: $2 (20%)');
  await userEvent.unhover(byAttr('data-node', '0|a')!);
  expect(await tip(byAttr('data-node', '1|x')!)).toBe('x: $2 (50%)');
});

test('a cut label carries the same share as its node', async () => {
  const name = 'A rather long node name indeed';
  const { container } = draw({ titles: ['One', 'Two'], flows: [[{ source: name, target: 'x', value: 3 }, { source: 'b', target: 'x', value: 1 }]] });
  const cut = [...container.querySelectorAll('text.dm-chart-text')].find((t) => t.textContent?.endsWith('…'))!;
  expect(cut).toBeTruthy();
  expect(await tip(cut)).toBe(`${name} $3 (75%)`);
});

test('a node that grew past its exact total to hold its flows has a share of the drawn column, never above 100%', async () => {
  // Without fit, a (exact 10) grows to its 16 of ribbons: the tooltip prints $16, so 16 of the column's 16.
  draw({ titles: ['One', 'Two'], flows: [[{ source: 'a', target: 'x', value: 8 }, { source: 'a', target: 'y', value: 8 }]], columns: [[{ key: 'a', value: 10 }], [{ key: 'x', value: 8 }, { key: 'y', value: 8 }]] });
  expect(await tip(byAttr('data-node', '0|a')!)).toBe('a: $16 (100%)');
  await userEvent.unhover(byAttr('data-node', '0|a')!);
  expect(await tip(byAttr('data-node', '1|x')!)).toBe('x: $8 (50%)');
});

const pairFlows = (name: string): Flow[][] => [[{ source: name, target: 'x', value: 3 }, { source: 'b', target: 'x', value: 1 }]];
const LONG = 'A rather long node name indeed';

test('a node always has its share of the drawn column, a column that overlaps (ribbonShare false) included, in fit mode too', async () => {
  for (const fit of [false, true]) {
    const { unmount } = draw({ titles: ['One', 'Two'], flows: pairFlows('a'), columns: [[{ key: 'a', value: 3 }, { key: 'b', value: 1 }], [{ key: 'x', value: 4 }]], fit, ribbonShare: [true, false] });
    expect(await tip(byAttr('data-node', '0|a')!)).toBe('a: $3 (75%)');
    await userEvent.unhover(byAttr('data-node', '0|a')!);
    expect(await tip(byAttr('data-node', '1|x')!)).toBe('x: $4 (100%)');
    unmount();
  }
});

test('ribbonShare false keeps the share on the cut label tooltip too', async () => {
  const { container } = draw({ titles: ['One', 'Two'], flows: pairFlows(LONG), ribbonShare: [false, true] });
  const cut = [...container.querySelectorAll('text.dm-chart-text')].find((t) => t.textContent?.endsWith('…'))!;
  expect(await tip(cut)).toBe(`${LONG} $3 (75%)`);
});

test('a visible label that fits keeps exactly its name and value, and the share stays out of the cut decision', () => {
  // Room is 21 characters: "abcdefghijklmnopqr $3" is 21 and fits; with its share it would not.
  const name = 'abcdefghijklmnopqr';
  const { container } = draw({ titles: ['One', 'Two'], flows: pairFlows(name) });
  const texts = [...container.querySelectorAll('text.dm-chart-text')].map((t) => t.textContent);
  expect(texts).toContain(`${name} $3`);
  // A label that is not cut stays out of the pointer's way: it is not wrapped in a tooltip, so it has pointer-events none.
  expect([...container.querySelectorAll('text.dm-chart-text')].find((t) => t.textContent === `${name} $3`)!.getAttribute('pointer-events')).toBe('none');
  expect(texts.some((t) => t?.includes('…'))).toBe(false);
  expect(texts.some((t) => t?.includes('%'))).toBe(false);
});

test('a cut label shows its clipped text only, with no share', () => {
  const { container } = draw({ titles: ['One', 'Two'], flows: pairFlows(LONG) });
  const cut = [...container.querySelectorAll('text.dm-chart-text')].find((t) => t.textContent?.endsWith('…'))!;
  expect(cut.textContent).toBe(`${`${LONG} $3`.slice(0, 20)}…`);
});

test('the shares follow new flows: a rerender with other values prints the new percent', async () => {
  const props = { titles: ['One', 'Two'], ariaLabel: 'S', text: (v: number) => `$${v}` };
  const mk = (a: number) => <TooltipProvider><Sankey {...props} flows={[[{ source: 'a', target: 'x', value: a }, { source: 'b', target: 'x', value: 1 }]]} /></TooltipProvider>;
  const { rerender } = render(mk(3));
  expect(await tip(byAttr('data-node', '0|a')!)).toBe('a: $3 (75%)');
  await userEvent.unhover(byAttr('data-node', '0|a')!);
  rerender(mk(1));
  expect(await tip(byAttr('data-node', '0|a')!)).toBe('a: $1 (50%)');
});

test('hovering a node or a ribbon formats no value again: nothing is rebuilt', async () => {
  const text = vi.fn((v: number) => `$${v}`);
  draw({ text });
  const calls = text.mock.calls.length;
  await userEvent.hover(byAttr('data-node', '0|a')!);
  await userEvent.unhover(byAttr('data-node', '0|a')!);
  await userEvent.hover(byAttr('data-link', '0|a|x')!);
  expect(text.mock.calls.length).toBe(calls);
});

const ribbonFlows: Flow[][] = [[{ source: 'a', target: 'x', value: 3 }, { source: 'b', target: 'x', value: 1 }], [{ source: 'x', target: 'z', value: 4 }]];
const ribbonTips = async (ribbonShare?: boolean[]) => {
  const { unmount } = draw({ flows: ribbonFlows, ribbonShare });
  const first = await tip(byAttr('data-link', '0|a|x')!);
  await userEvent.unhover(byAttr('data-link', '0|a|x')!);
  const second = await tip(document.querySelector('[data-link^="1|x|z"]')!);
  unmount();
  return [first, second];
};

test('a ribbon has no percent when its middle column overlaps: neither pair shows one', async () => {
  expect(await ribbonTips([true, false, true])).toEqual(['a → x: $3', 'x → z (from x): $4']);
});

test('a ribbon has a percent only when both its columns show shares: last column overlapping leaves the first pair its percent', async () => {
  expect(await ribbonTips([true, true, false])).toEqual(['a → x: $3 (75%)', 'x → z (from x): $4']);
});

test('a first column that overlaps takes the percent off its pair only', async () => {
  expect(await ribbonTips([false, true, true])).toEqual(['a → x: $3', 'x → z (from x): $4 (100%)']);
});

test('with ribbonShare absent every ribbon shows its percent', async () => {
  expect(await ribbonTips()).toEqual(['a → x: $3 (75%)', 'x → z (from x): $4 (100%)']);
});


// The tooltips of nodes and cut labels carry a copy button; the bubbles of nodes and cut labels open on the right.
const bubble = () => document.querySelector<HTMLElement>('.dm-hint-body')!;
const writeText = vi.fn<(t: string) => Promise<void>>();
beforeEach(() => { writeText.mockReset(); writeText.mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true }); });
afterEach(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); });

test('a node tooltip opens on the right with a copy button, and its hidden text is the plain text', async () => {
  draw();
  await userEvent.hover(byAttr('data-node', '0|a')!);
  const hidden = await screen.findByRole('tooltip');
  expect(hidden.textContent).toBe('a: $8 (80%)');
  expect(hidden.querySelector('button')).toBeNull();
  expect(bubble()).toHaveAttribute('data-side', 'right');
  expect(bubble()).toContainElement(screen.getByRole('button', { name: 'Copy to clipboard' }));
});

test('a cut label tooltip opens on the right with a copy button that copies name, value and share', async () => {
  const { container } = draw({ titles: ['One', 'Two'], flows: pairFlows(LONG) });
  const cut = [...container.querySelectorAll('text.dm-chart-text')].find((t) => t.textContent?.endsWith('…'))!;
  await userEvent.hover(cut);
  await screen.findByRole('tooltip');
  expect(bubble()).toHaveAttribute('data-side', 'right');
  await userEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }));
  expect(writeText).toHaveBeenCalledWith(`${LONG} $3 (75%)`);
});

test('a ribbon tooltip is a plain one: on top, no copy button, not hoverable', async () => {
  draw({ flows: ribbonFlows });
  await userEvent.hover(byAttr('data-link', '0|a|x')!);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('a → x: $3 (75%)');
  expect(bubble()).toHaveAttribute('data-side', 'top');
  expect(screen.queryByRole('button', { name: 'Copy to clipboard' })).toBeNull();
  expect(bubble()).not.toHaveClass('dm-hint-hoverable');
  await userEvent.unhover(byAttr('data-link', '0|a|x')!);
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
});

test('copying from a node tooltip does not pick the node', async () => {
  const onPickNode = vi.fn();
  draw({ onPickNode });
  await userEvent.hover(byAttr('data-node', '0|a')!);
  await screen.findByRole('tooltip');
  await userEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }));
  expect(writeText).toHaveBeenCalledWith('a: $8 (80%)');
  expect(onPickNode).not.toHaveBeenCalled();
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
});

test('keyboard focus on a node opens its tooltip with its text', async () => {
  draw({ onPickNode: vi.fn() });
  screen.getByRole('button', { name: 'Filter to One: a' }).focus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent('a: $8 (80%)');
});

test('no copy button is mounted while no tooltip is open', () => {
  draw();
  expect(screen.queryByRole('button', { name: 'Copy to clipboard' })).toBeNull();
  expect(document.querySelector('.dm-hint-body')).toBeNull();
});
