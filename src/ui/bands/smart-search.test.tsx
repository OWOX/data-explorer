import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import type { Ctx } from '../../sdk/types';
import { AppServices, StoreProvider } from '../../state/store';
import { decodeViewLink } from '../../state/view-link';
import { App } from '../App';

type Mock = ReturnType<typeof createMockCtx>;

// A loaded CI runner must not turn a slow model into a timeout, so the AI budget is large unless a test is about the timeout.
function setup(opts: { ai?: boolean; wrap?: (ctx: Mock) => Ctx; ctx?: Ctx; aiTimeoutMs?: number } = {}) {
  const ctx = opts.ctx ?? (opts.wrap ?? ((c: Mock): Ctx => c))(createMockCtx(demoFixtures(), { latencyMs: 0, ai: opts.ai }));
  const view = () => render(<AppServices ctx={ctx} aiTimeoutMs={opts.aiTimeoutMs ?? 60_000}><StoreProvider><App /></StoreProvider></AppServices>);
  return { ctx, view };
}
const band = (id: string) => document.getElementById(id)!;
const data = () => band('band-data');
const marts = () => band('band-marts');
const headings = () => within(data()).queryAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup').map((h) => h.textContent!).join(' + ');
const cardTitles = () => [...marts().querySelectorAll('article .dm-node-title')].map((t) => t.textContent!);
const ready = async () => {
  await waitFor(() => expect(document.getElementById('band-data')).not.toBeNull());
  await waitFor(() => expect(document.querySelector('.dm-loadbar')).toBeNull());
  await within(data()).findByRole('table');
  await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => !!r.querySelector('td')?.textContent)).toBe(true));
};
const openSearch = async () => { await userEvent.click(screen.getByRole('button', { name: 'Search data marts' })); return screen.getByRole('textbox', { name: 'Search data marts' }); };
const search = async (q: string) => { const box = await openSearch(); await userEvent.type(box, `${q}{Enter}`); };
const undo = () => userEvent.click(screen.getByRole('button', { name: 'Undo' }));
const Z = (title: string) => within(marts()).getByText(title).closest('article')!;

describe('the search box', () => {
  test('lives in the page header, left of Undo, Redo and Copy link, not in the Data Marts band', async () => {
    setup().view();
    await ready();
    const header = document.querySelector('header.dm-page-header') as HTMLElement;
    const names = within(header).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names.slice(0, 3)).toEqual(['Search data marts', 'Undo', 'Redo']);
    expect(within(marts()).queryByRole('button', { name: 'Search data marts' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Search data marts' }));
    expect(within(header).getByRole('textbox', { name: 'Search data marts' })).toBeInTheDocument();
    expect(within(marts()).queryByRole('textbox')).toBeNull();
    expect(within(header).getAllByRole('button').map((b) => b.getAttribute('aria-label')).indexOf('Undo')).toBeGreaterThan(0);
  });

  test('is an icon button; clicking opens an input with a go button, Escape closes it and nothing is applied', async () => {
    setup().view();
    await ready();
    expect(screen.queryByRole('textbox')).toBeNull();
    const box = await openSearch();
    expect(box).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    await userEvent.type(box, 'ord');
    expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    // nothing was run: the band is as it was, and the icon is back
    expect(screen.getByRole('button', { name: 'Search data marts' })).toBeInTheDocument();
    expect(within(marts()).getByText('Customers')).toBeInTheDocument();
  });

  test('opens from the keyboard', async () => {
    setup().view();
    await ready();
    screen.getByRole('button', { name: 'Search data marts' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Search data marts' })).toHaveFocus();
  });

  test('go is off while the box is empty, the input stops at the backend limit of 256, and one character is a title match with no search call', async () => {
    const t = setup();
    t.view();
    await ready();
    const spy = vi.spyOn(t.ctx.owox, 'getJson');
    const box = await openSearch();
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    expect(box).toHaveAttribute('maxlength', '256');
    await userEvent.type(box, 'p{Enter}');
    await waitFor(() => expect(within(marts()).queryByText('Customers')).toBeNull());
    expect(within(marts()).getByText('Orders')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalledWith('/api/search', expect.anything());
  });

  test('typing GA4 still lists every mart with that title after the found ones', async () => {
    const fx = demoFixtures();
    fx.marts.find((m) => m.id === 'sessions')!.title = 'Sessions GA4';
    fx.marts.find((m) => m.id === 'campaigns')!.title = 'Campaigns GA4';
    const ctx = createMockCtx(fx, { latencyMs: 0, ai: false });
    setup({ ctx }).view();
    await ready();
    await search('ga4');
    await waitFor(() => expect(cardTitles()).toEqual(expect.arrayContaining(['Sessions GA4', 'Campaigns GA4'])));
  });

  test('Enter and the go button both run the search; the query stays on screen with an x that clears it and restores the band', async () => {
    setup({ ai: false }).view();
    await ready();
    await search('customers');
    await waitFor(() => expect(headings()).toBe('Customers'));
    expect(screen.getByRole('textbox', { name: 'Search data marts' })).toHaveValue('customers');
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('textbox', { name: 'Search data marts' })).toHaveValue('');
    // the band shows the main mart's neighbours again
    expect(await within(marts()).findByText('Orders')).toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: 'Search data marts' });
    await userEvent.type(box, 'products');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(headings()).toBe('Products'));
  });

  test('Escape after a search closes the box but keeps the applied query visible, with its x', async () => {
    setup({ ai: false }).view();
    await ready();
    await search('customers');
    await waitFor(() => expect(headings()).toBe('Customers'));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Search data marts: customers' })).toHaveTextContent('customers');
    expect(headings()).toBe('Customers');
    await userEvent.click(screen.getByRole('button', { name: 'Search data marts: customers' }));
    expect(screen.getByRole('textbox')).toHaveValue('customers');
  });
});

describe('the pipeline', () => {
  test('the OWOX search ranks the marts: they show first, in rank order, five at most, and the best becomes the main mart', async () => {
    const t = setup({ ai: false });
    t.view();
    await ready();
    const spy = vi.spyOn(t.ctx.owox, 'getJson');
    await search('orders');
    await waitFor(() => expect(headings()).toBe('Orders'));
    expect(spy).toHaveBeenCalledWith('/api/search', { q: 'orders', entityTypes: 'DATA_MART', excludeDrafts: 'true', limit: '10' });
    // the engine ranks a title hit above a description hit (the mock scores a title word 20, a description word 8); cards that leave are gone once their transition ends
    await waitFor(() => expect(cardTitles()).toHaveLength(5));
    expect(cardTitles()).toEqual(['Orders', 'Order Items', 'Customers', 'Returns', 'Payments']);
    await waitFor(() => expect(within(marts()).queryByText('Stores')).toBeNull());
    expect(Z('Orders')).toHaveAttribute('aria-pressed', 'true');
  });

  test('an empty endpoint goes to the AI, which finds the marts by meaning; the best becomes the main mart', async () => {
    const t = setup({});
    t.view();
    await ready();
    await search('who are our buyers');
    await waitFor(() => expect(headings()).toBe('Customers'));
    await waitFor(() => expect(within(marts()).queryByText('Stores')).toBeNull());
    expect(within(marts()).queryByText(/No data marts match/)).toBeNull();
  });

  test('the AI sets up the best mart view: its filters are applied, validated, and the grid loads with them', async () => {
    const t = setup({});
    const rows: unknown[] = [];
    const real = t.ctx.owox.dataMarts.traverseData.bind(t.ctx.owox.dataMarts);
    vi.spyOn(t.ctx.owox.dataMarts, 'traverseData').mockImplementation((id, o) => { rows.push({ id, o }); return real(id, o); });
    t.view();
    await ready();
    await search('paid orders last month');
    await waitFor(() => expect(within(data()).getByLabelText('Filter created_at')).toHaveClass('dm-ctl-on'));
    expect(within(data()).getByLabelText('Filter status')).toHaveClass('dm-ctl-on');
    // rows arrive through the normal grid load, with the filters on the query
    await waitFor(() => expect(rows.some((r) => JSON.stringify(r).includes('relative_date') && JSON.stringify(r).includes('"paid"'))).toBe(true));
  });

  test('a view the AI got wrong in parts keeps the good parts: unknown fields and operators are dropped', async () => {
    const t = setup({ wrap: (c) => ({ ...c, credentials: { ai: (() => {
      const m = { doGenerate: async () => ({ content: [{ type: 'text', text: JSON.stringify({ columns: ['id', 'ghost', 'status'], filters: [{ field: 'ghost', op: 'eq', value: 1 }, { field: 'status', op: 'gt', value: 'x' }, { field: 'status', op: 'eq', value: 'paid' }] }) }] }) };
      return { ...m, fast: m, reasoning: m };
    })() } }) });
    t.view();
    await ready();
    await search('orders please');
    await waitFor(() => expect(within(data()).getByLabelText('Filter status')).toHaveClass('dm-ctl-on'));
    expect(within(data()).queryByLabelText('Filter ghost')).toBeNull();
  });

  test('the whole result is one Undo step: the main mart and its filters come back together', async () => {
    const t = setup({});
    t.view();
    await ready();
    await search('who are our buyers');
    await waitFor(() => expect(headings()).toBe('Customers'));
    await undo();
    await waitFor(() => expect(headings()).toBe('Orders'));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  test('one Undo takes the AI filters off the same mart too', async () => {
    const t = setup({});
    t.view();
    await ready();
    await search('paid orders last month');
    await waitFor(() => expect(within(data()).getByLabelText('Filter status')).toHaveClass('dm-ctl-on'));
    await undo();
    await waitFor(() => expect(within(data()).queryByLabelText('Filter status')).toBeNull());
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  test('nothing found anywhere says so and falls back to the title match', async () => {
    const t = setup({});
    t.view();
    await ready();
    await search('zzzzqq');
    expect(await within(marts()).findByText('No data marts match.')).toBeInTheDocument();
    expect(headings()).toBe('Orders');
    // the title match found nothing, so only the selected mart stays
    await waitFor(() => expect(within(marts()).queryByText('Customers')).toBeNull());
  });

  test('a failing endpoint does not show an error: the AI answers, or the title match does', async () => {
    const t = setup({ wrap: (c) => ({ ...c, owox: { ...c.owox, getJson: ((path: string, q?: Record<string, string>) => (path === '/api/search' ? Promise.reject(new Error('503')) : c.owox.getJson(path, q))) as Ctx['owox']['getJson'] } }) });
    t.view();
    await ready();
    await search('who are our buyers');
    await waitFor(() => expect(headings()).toBe('Customers'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('a model that never answers is treated as no AI for that run: the endpoint result shows, no error, no hint', async () => {
    const hang = { doGenerate: () => new Promise<never>(() => {}) };
    const t = setup({ aiTimeoutMs: 300, wrap: (c) => ({ ...c, credentials: { ai: { ...hang, fast: hang, reasoning: hang } } }) });
    t.view();
    await ready();
    await search('customers');
    await waitFor(() => expect(headings()).toBe('Customers'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('note', { name: 'AI search hint' })).toBeNull();
  });

  test('a new search while one runs cancels the first', async () => {
    let first: AbortSignal | undefined;
    const slow = { doGenerate: (o: { abortSignal?: AbortSignal }) => { first ??= o.abortSignal; return new Promise<never>(() => {}); } };
    const t = setup({ wrap: (c) => ({ ...c, credentials: { ai: { ...slow, fast: slow, reasoning: slow } } }) });
    t.view();
    await ready();
    const box = await openSearch();
    await userEvent.type(box, 'customers{Enter}');
    await waitFor(() => expect(first).toBeDefined());
    // go stays enabled while a search runs: a new query cancels it
    expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled();
    await userEvent.clear(box);
    await userEvent.type(box, 'products{Enter}');
    await waitFor(() => expect(first!.aborted).toBe(true));
  });
});

describe('no AI configured', () => {
  test('the endpoint result alone, no error, and a quiet hint that can be dismissed and stays dismissed', async () => {
    const t = setup({ ai: false });
    const first = t.view();
    await ready();
    expect(screen.queryByRole('note', { name: 'AI search hint' })).toBeNull();
    await search('customers');
    await waitFor(() => expect(headings()).toBe('Customers'));
    const hint = screen.getByRole('note', { name: 'AI search hint' });
    expect(hint).toHaveTextContent("Connect AI in this plugin's settings to also find data marts by meaning and apply filters.");
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(within(hint).getByRole('button', { name: 'Dismiss the AI hint' }));
    expect(screen.queryByRole('note', { name: 'AI search hint' })).toBeNull();
    // remembered: a new page load on the same project does not bring it back
    first.unmount();
    t.view();
    await ready();
    await search('products');
    await waitFor(() => expect(headings()).toBe('Products'));
    expect(screen.queryByRole('note', { name: 'AI search hint' })).toBeNull();
    expect((await t.ctx.collections<{ aiHintDismissed: boolean }>('preferences').get('search'))?.document).toEqual({ aiHintDismissed: true });
  });

  test('with AI configured the hint never shows', async () => {
    setup({}).view();
    await ready();
    await search('customers');
    await waitFor(() => expect(headings()).toBe('Customers'));
    expect(screen.queryByRole('note', { name: 'AI search hint' })).toBeNull();
  });

  test('nothing found without AI says "No data marts match."', async () => {
    setup({ ai: false }).view();
    await ready();
    await search('zzzzqq');
    expect(await within(marts()).findByText('No data marts match.')).toBeInTheDocument();
  });
});

test('the search itself never reads rows: only the grid load after applying does', async () => {
  const t = setup({});
  const reads: string[] = [];
  const real = t.ctx.owox.dataMarts.traverseData.bind(t.ctx.owox.dataMarts);
  vi.spyOn(t.ctx.owox.dataMarts, 'traverseData').mockImplementation((id, o) => { reads.push(id); return real(id, o); });
  t.view();
  await ready();
  const before = reads.length;
  fireEvent.click(await openSearch());
  await userEvent.type(screen.getByRole('textbox', { name: 'Search data marts' }), 'who are our buyers{Enter}');
  await waitFor(() => expect(headings()).toBe('Customers'));
  await waitFor(() => expect(reads.slice(before).every((id) => id === 'customers' || id === 'orders')).toBe(true));
  expect(reads.slice(before).filter((id) => id !== 'customers')).toEqual([]);
});

test('the copied link carries the found marts, so opening it does not filter titles by the question', async () => {
  setup({ ai: false }).view();
  await ready();
  await search('paid orders last month');
  await waitFor(() => expect(headings()).toBe('Orders'));
  await userEvent.click(screen.getByRole('button', { name: /copy link/i }));
  await waitFor(() => expect(window.__copiedLink).toBeDefined());
  const view = await decodeViewLink(window.__copiedLink!);
  expect(typeof view).toBe('object');
  expect((view as { found: string[] }).found[0]).toBe('orders');
  expect((view as { found: string[] }).found.length).toBeGreaterThan(1);
});

test('submitting the query that is already running changes nothing: no restart, no second AI call', async () => {
  let calls = 0;
  const slow = { doGenerate: () => { calls += 1; return new Promise<never>(() => {}); } };
  const t = setup({ wrap: (c) => ({ ...c, credentials: { ai: { ...slow, fast: slow, reasoning: slow } } }) });
  const gets = vi.spyOn(t.ctx.owox, 'getJson');
  t.view();
  await ready();
  const box = await openSearch();
  await userEvent.type(box, 'customers{Enter}');
  await waitFor(() => expect(calls).toBe(1));
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  await userEvent.type(box, '{Enter}');
  expect(calls).toBe(1);
  expect(gets.mock.calls.filter(([p]) => p === '/api/search')).toHaveLength(1);
});
