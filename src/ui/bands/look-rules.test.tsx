// The look rules, the same in Grid and in Graph: solid is in the report, dashed is a join that can be made, only a hover dims.
import { readFileSync } from 'node:fs';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';
import { martElementId } from './cards';

const css = (readFileSync as (path: string, enc: 'utf8') => string)('src/ui/bands/bands.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (selector: RegExp) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => selector.test(m[1]!.trim())).map((m) => m[2]!).join(' ');

function setup() {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
}
const data = () => document.getElementById('band-data')!;
const marts = () => document.getElementById('band-marts')!;
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent!);
const groupTitles = () => within(data()).queryAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup').map((h) => h.querySelector('.truncate')!.textContent!);
const ready = async () => { await waitFor(() => expect(headers()).toHaveLength(5)); await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true)); };
const el = (id: string, path?: string) => [...marts().querySelectorAll<HTMLElement>('article')].find((a) => a.id === martElementId(id, path) && !a.hasAttribute('data-ghost')) ?? null;
const ghostOf = (id: string) => marts().querySelector<HTMLElement>(`article[data-ghost][data-mart-id="${id}"]`);
const faded = () => [...marts().querySelectorAll<HTMLElement>('article.dm-faded')].map((a) => a.id).sort();
const bandCard = (id: string) => within(marts()).findByText(new RegExp(`^${id}$`)).then((t) => t.closest('article')!);
const wire = (layer: string, from: string, to: string) => document.querySelector<SVGPathElement>(`#${layer} path[data-from="${from}"][data-to="${to}"]`);
const toCanvas = async () => {
  const group = within(marts()).getByRole('radiogroup', { name: 'Show data marts as' });
  await userEvent.click(within(group).getByRole('radio', { name: 'Graph' }));
};
/** Orders, with Customers and Stores joined: the main mart has two children. */
async function joinTwo() {
  await ready();
  fireEvent.click(await bandCard('Customers'));
  await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(await bandCard('Stores'));
  await waitFor(() => expect(el('stores', 'stores')).not.toBeNull());
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Customers', 'Stores']));
}

describe('the stylesheet', () => {
  test('one mart dimming: the Grid-wide focus dimming is gone, a faded card is at 30%, the Sources band keeps its own', () => {
    expect(css).not.toMatch(/\.dm-canvas\.focused/);
    expect(rules(/^\.dm-canvas\.sources-focused #band-sources \.dm-node$/)).toContain('opacity: 0.25');
    expect(css).not.toMatch(/dm-unjoinable/);
    expect(rules(/^\.dm-node\.dm-faded$/)).toContain('opacity: 0.3');
  });
  test('a line dims with the card it arrives at, at the same 30%, and only a line that is drawn', () => {
    expect(rules(/^#wires path\.faded:is\(\.lit, \.joined, \.ghost, \.lit\.aside\), #tree-wires path\.faded$/)).toContain('opacity: 0.3');
    // After the rule that holds a drawn line at full strength, so it wins.
    expect(css.indexOf('#tree-wires path.faded')).toBeGreaterThan(css.indexOf('#wires path.relationship.joined, #wires path.relationship.ghost'));
  });
  test('a ghost and an off-path card are dashed at full strength', () => {
    expect(rules(/^\.dm-node\.dm-ghost, \.dm-node\.dm-offpath$/)).toContain('border-style: dashed');
    expect(rules(/^\.dm-node\.dm-ghost/)).not.toContain('opacity');
    expect(rules(/^\.dm-node\.dm-offpath/)).not.toContain('opacity');
  });
  test('both views draw a report line solid and a possible one dashed, at full strength', () => {
    expect(rules(/^#wires \.relationship\.joined, #tree-wires \.relationship\.joined$/)).toContain('stroke-dasharray: none');
    expect(rules(/^#wires \.relationship, #tree-wires \.relationship$/)).toContain('stroke-dasharray: 5 4');
    expect(rules(/\.ghost \{?$|path\.relationship\.ghost$/)).toContain('opacity: 1');
    expect(rules(/^#wires path\.relationship\.joined,/)).toContain('opacity: 1');
    // The Graph restates neither.
    expect(css).not.toMatch(/#tree-wires \.relationship\.ghost \{/);
  });
});

describe('Grid', () => {
  test('lines in the report are solid and drawn; a mart that can join is dashed, full strength, with a dashed border', async () => {
    setup();
    await ready();
    fireEvent.click(await bandCard('Customers'));
    await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(wire('wires', 'dm-orders', 'dm-customers@customers')).not.toBeNull());
    expect(wire('wires', 'dm-orders', 'dm-customers@customers')).toHaveClass('relationship', 'joined');
    expect(wire('wires', 'dm-orders', 'dm-customers@customers')).not.toHaveClass('ghost');
    // Products is outside the report, joinable from the main mart.
    await waitFor(() => expect(wire('wires', 'dm-orders', 'dm-products')).not.toBeNull());
    expect(wire('wires', 'dm-orders', 'dm-products')).toHaveClass('ghost');
    expect(wire('wires', 'dm-orders', 'dm-products')).not.toHaveClass('joined');
    expect(el('products')).toHaveClass('dm-offpath');
    expect(el('products')).toHaveClass('dm-faded'); // nothing hovered or focused can join it
    expect(el('orders')).not.toHaveClass('dm-offpath');
    expect(el('customers', 'customers')).not.toHaveClass('dm-offpath');
  });

  test('a mart reachable only through another outside mart has one dashed line, from that mart, with or without a focus', async () => {
    setup();
    await ready();
    fireEvent.click(await bandCard('Customers'));
    await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
    fireEvent.keyDown(document, { key: 'Escape' });
    // Categories joins through Products, which is outside the report too.
    await waitFor(() => expect(wire('wires', 'dm-products', 'dm-categories')).not.toBeNull());
    expect(wire('wires', 'dm-products', 'dm-categories')).toHaveClass('relationship', 'ghost');
    expect(wire('wires', 'dm-products', 'dm-categories')).not.toHaveClass('joined');
    expect(document.querySelectorAll('#wires path[data-to="dm-categories"].ghost')).toHaveLength(1);
    fireEvent.click(el('customers', 'customers')!);
    await waitFor(() => expect(el('customers', 'customers')).toHaveAttribute('data-focused'));
    expect(wire('wires', 'dm-products', 'dm-categories')).toHaveClass('ghost');
    // Lines between two marts of the report stay solid.
    expect(wire('wires', 'dm-orders', 'dm-customers@customers')).toHaveClass('joined');
  });

  test('hovering a mart fades no Data Sources card, and a pinned mart dims the sources that do not feed it', async () => {
    setup();
    await ready();
    fireEvent.click(await bandCard('Customers'));
    await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
    expect(marts().closest('.dm-canvas')).toHaveClass('sources-focused');
    fireEvent.pointerOver(el('customers', 'customers')!);
    expect(faded().length).toBeGreaterThan(0);
    expect(document.querySelectorAll('#band-sources .dm-faded')).toHaveLength(0);
  });

  test('a focused card has the 2px border, and what it can join is dashed from it', async () => {
    setup();
    await ready();
    fireEvent.click(await bandCard('Customers'));
    await waitFor(() => expect(el('customers', 'customers')).toHaveAttribute('data-focused'));
    expect(marts().querySelectorAll('[data-focused]')).toHaveLength(1);
    await waitFor(() => expect(wire('wires', 'dm-customers@customers', 'dm-countries')).not.toBeNull());
    expect(wire('wires', 'dm-customers@customers', 'dm-countries')).toHaveClass('ghost');
    // Focusing dims no report card; of the cards outside it only what the focused card can join stays at full strength.
    expect(faded()).not.toContain('dm-orders');
    expect(faded()).not.toContain('dm-customers@customers');
    expect(faded()).not.toContain('dm-countries');
    expect(faded()).toContain('dm-products');
  });

  test('hovering a card fades every card that is not it, on a line with it, or a mart it can join; leaving restores them', async () => {
    setup();
    await ready();
    fireEvent.click(await bandCard('Customers'));
    await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
    fireEvent.keyDown(document, { key: 'Escape' });
    // At rest the report is at full strength and every mart outside it is dimmed.
    expect(faded()).toEqual(['dm-categories', 'dm-countries', 'dm-products', 'dm-shipments', 'dm-stores']);
    fireEvent.pointerOver(el('customers', 'customers')!);
    expect(faded()).not.toContain('dm-customers@customers');
    expect(faded()).not.toContain('dm-orders'); // its path neighbour
    expect(faded()).not.toContain('dm-countries'); // joins Customers
    expect(faded()).toContain('dm-products'); // joins Orders, not Customers
    for (const card of marts().querySelectorAll('article.dm-faded')) expect(card).toHaveClass('dm-node');
    fireEvent.pointerLeave(marts().closest('.dm-canvas')!);
    // The marts outside the report are dimmed again once the 400 ms grace has passed.
    await waitFor(() => expect(faded()).toEqual(['dm-categories', 'dm-countries', 'dm-products', 'dm-shipments', 'dm-stores']), { timeout: 2000 });
    // The hovered main card undims what it can join, and the union with a focused card stays undimmed.
    fireEvent.pointerOver(el('orders')!);
    expect(faded()).not.toContain('dm-products');
    expect(faded()).toContain('dm-countries');
    fireEvent.pointerLeave(marts().closest('.dm-canvas')!);
    await waitFor(() => expect(faded()).toContain('dm-products'), { timeout: 2000 });
    fireEvent.click(el('customers', 'customers')!);
    await waitFor(() => expect(el('customers', 'customers')).toHaveAttribute('data-focused'));
    fireEvent.pointerOver(el('orders')!);
    expect(faded()).not.toContain('dm-countries'); // focused card's
    expect(faded()).not.toContain('dm-products'); // hovered card's
    expect(faded()).toContain('dm-categories');
  });

  test('crossing the gap between cards does not blink the marts outside the report; they dim 400 ms after the pointer is gone', async () => {
    setup();
    await ready();
    fireEvent.click(await bandCard('Customers'));
    await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
    fireEvent.keyDown(document, { key: 'Escape' });
    const canvas = marts().closest('.dm-canvas')!;
    fireEvent.pointerOver(el('customers', 'customers')!);
    expect(faded()).not.toContain('dm-countries');
    // The pointer is over the gap: nothing blinks, and the next card takes over.
    fireEvent.pointerLeave(canvas);
    expect(faded()).not.toContain('dm-countries');
    await new Promise((r) => setTimeout(r, 200));
    expect(faded()).not.toContain('dm-countries');
    fireEvent.pointerOver(el('orders')!);
    expect(faded()).not.toContain('dm-products');
    fireEvent.pointerLeave(canvas);
    await new Promise((r) => setTimeout(r, 200));
    expect(faded()).not.toContain('dm-products');
    await waitFor(() => expect(faded()).toEqual(['dm-categories', 'dm-countries', 'dm-products', 'dm-shipments', 'dm-stores']), { timeout: 2000 });
  });

  test('with no main mart nothing is dimmed at rest', async () => {
    setup();
    await ready();
    const shopify = within(document.getElementById('band-sources')!).getByText('Shopify').closest('article')!;
    fireEvent.click(shopify);
    await waitFor(() => expect(marts().querySelector('.dm-offpath')).toBeNull());
    expect(marts().querySelectorAll('article').length).toBeGreaterThan(0);
    expect(faded()).toEqual([]);
  });

  test('a hovered card keeps the marts it can join at full strength, with a dashed line to each', async () => {
    setup();
    await ready();
    fireEvent.click(await bandCard('Customers'));
    await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerOver(el('customers', 'customers')!);
    expect(el('countries')).toHaveClass('dm-offpath');
    expect(el('countries')).not.toHaveClass('dm-faded');
    const line = document.querySelector('#wires path[data-from="dm-customers@customers"][data-to="dm-countries"], #wires path[data-from="dm-customers"][data-to="dm-countries"]');
    expect(line).not.toBeNull();
    expect(line).toHaveClass('relationship');
    expect(line).not.toHaveClass('joined');
  });
});

describe('Graph', () => {
  test('the main mart is the top-left card whatever its children do', async () => {
    setup();
    await joinTwo();
    await toCanvas();
    await waitFor(() => expect(el('stores', 'stores')).not.toBeNull());
    const wrapper = el('orders')!.parentElement!;
    expect([wrapper.style.left, wrapper.style.top]).toEqual(['0px', '0px']);
    const left = (id: string, path: string) => parseFloat(el(id, path)!.parentElement!.style.left);
    expect(left('customers', 'customers')).toBeGreaterThan(0);
  });

  test('report lines are solid, a pinned card has the 2px border, and what can join is dashed at full strength', async () => {
    setup();
    await joinTwo();
    await toCanvas();
    await waitFor(() => expect(el('stores', 'stores')).not.toBeNull());
    expect(wire('tree-wires', 'dm-orders', 'dm-customers@customers')).toHaveClass('relationship', 'joined');
    await userEvent.click(el('orders')!);
    expect(el('orders')).toHaveAttribute('data-focused');
    const ghost = await waitFor(() => { const g = ghostOf('products'); expect(g).not.toBeNull(); return g!; });
    expect(ghost).toHaveClass('dm-ghost');
    expect(ghost).not.toHaveClass('dm-faded');
    const line = document.querySelector<SVGPathElement>(`#tree-wires path[data-to="${ghost.id}"]`)!;
    expect(line).toHaveClass('ghost');
    expect(line).not.toHaveClass('joined');
    expect(faded()).toEqual([]); // a pin dims nothing
  });

  test('hovering a card fades the cards it does not touch, and its (+) shows its ghosts; leaving restores them after the grace', async () => {
    setup();
    await joinTwo();
    await toCanvas();
    await waitFor(() => expect(el('stores', 'stores')).not.toBeNull());
    expect(faded()).toEqual([]);
    await userEvent.hover(el('customers', 'customers')!);
    expect(faded()).toEqual(['dm-stores@stores']);
    expect(ghostOf('countries')).toBeNull();
    await userEvent.hover(el('customers', 'customers')!.querySelector<HTMLElement>('[data-join-plus]')!);
    await waitFor(() => expect(ghostOf('countries')).not.toBeNull());
    expect(faded()).toEqual(['dm-stores@stores']);
    expect(ghostOf('countries')).not.toHaveClass('dm-faded');
    await userEvent.unhover(el('customers', 'customers')!);
    await waitFor(() => expect(faded()).toEqual([]), { timeout: 2000 });
    await waitFor(() => expect(ghostOf('countries')).toBeNull());
  });

  test('moving from a (+) onto its ghost keeps the ghost and its card, and fades the rest', async () => {
    setup();
    await joinTwo();
    await toCanvas();
    await waitFor(() => expect(el('stores', 'stores')).not.toBeNull());
    await userEvent.hover(el('customers', 'customers')!.querySelector<HTMLElement>('[data-join-plus]')!);
    const ghost = await waitFor(() => { const g = ghostOf('countries'); expect(g).not.toBeNull(); return g!; });
    await userEvent.hover(ghost);
    expect(ghost).not.toHaveClass('dm-faded');
    expect(el('customers', 'customers')).not.toHaveClass('dm-faded');
    expect(el('stores', 'stores')).toHaveClass('dm-faded');
  });
});
