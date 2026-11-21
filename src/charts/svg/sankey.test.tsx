import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { TooltipProvider } from '../../ui/Tooltip';
import { BLANK_KEY, OTHER_KEY } from '../blank';
import type { Flow } from '../sankeyLayout';
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
  for (const t of ['One', 'Two', 'Three']) expect(screen.getByText(t)).toBeInTheDocument();
  expect(byAttr('data-node', `0|${BLANK_KEY}`)).not.toBeNull();
});

test('labels name the node and its value, with a title for the full text', () => {
  const { container } = draw();
  expect(container.querySelector('text title')).not.toBeNull();
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

test('hovering a node lights its ribbons and dims the rest', async () => {
  const { container } = draw({ onPickNode: () => {} });
  await userEvent.hover(container.querySelector('rect[data-node="1|x"]')!);
  const op = (id: string) => Number(byAttr('data-link', id)!.getAttribute('fill-opacity'));
  expect(op('0|a|x')).toBeGreaterThan(op(`0|a|${OTHER_KEY}`));
});

test('a screen reader gets a table of the flows', () => {
  const { container } = draw();
  const rows = [...container.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent));
  expect(rows).toContainEqual(['One → Two', 'a', 'x', '$5']);
  expect(rows).toContainEqual(['Two → Three', 'x', 'z', '$7']);
  expect([...container.querySelectorAll('thead th')].map((c) => c.textContent)).toEqual(['Columns', 'From', 'To', 'Value']);
});
