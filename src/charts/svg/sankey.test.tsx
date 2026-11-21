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
  screen.getByRole('button', { name: 'Filter to a' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(onPickNode).toHaveBeenCalledWith(0, 'a');
  screen.getByRole('button', { name: 'Filter to (blank)' }).focus();
  await userEvent.keyboard(' ');
  expect(onPickNode).toHaveBeenLastCalledWith(0, BLANK_KEY);
  expect(screen.queryByRole('button', { name: 'Filter to Other' })).toBeNull();
  expect(byAttr('data-node', `1|${OTHER_KEY}`)!.getAttribute('role')).toBeNull();
});

test('a ribbon picks its pair and both values by click and keyboard, never through Other', async () => {
  const onPickLink = vi.fn();
  draw({ onPickLink });
  await userEvent.click(screen.getByRole('button', { name: 'Filter to a → x' }));
  expect(onPickLink).toHaveBeenCalledWith(0, 'a', 'x');
  screen.getByRole('button', { name: 'Filter to x → z' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(onPickLink).toHaveBeenLastCalledWith(1, 'x', 'z');
  expect(screen.queryByRole('button', { name: 'Filter to a → Other' })).toBeNull();
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
  expect(rows).toContainEqual(['a', 'x', '$5']);
});
