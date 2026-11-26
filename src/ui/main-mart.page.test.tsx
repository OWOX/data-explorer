import { useEffect, type Dispatch } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { Ctx } from '../sdk/types';
import { createMockCtx } from '../sdk/mock/ctx';
import { demoFixtures } from '../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore, type Action, type State } from '../state/store';
import { encodeViewLink } from '../state/view-link';
import userEvent from '@testing-library/user-event';
import { App } from './App';

const box: { latest: State; dispatch: Dispatch<Action> } = { latest: undefined as never, dispatch: undefined as never };
function Probe() {
  const [s, dispatch] = useStore();
  useEffect(() => { box.latest = s; box.dispatch = dispatch; });
  return null;
}
const pick = (id: string) => act(() => box.dispatch({ type: 'selectMart', id, sourceOf: () => null }));
const quiet = () => new Promise((r) => setTimeout(r, 150));

// The demo marts' own source keys: orders, customers and returns come from Shopify, sessions from Google Analytics.
const SHOPIFY = 'Shopify';
const GA4 = 'GoogleAnalytics4';
type Saved = { martId: string; sourceKey?: string | null };
// `fail` makes reading the stored mart throw; `delayMs` holds that read back; `route` opens a view link; `sources.gone` makes the next model read list every mart without a connector.
async function setup(saved?: unknown, opts: { fail?: boolean; delayMs?: number; route?: string; sources?: { gone: boolean }; slowModel?: boolean } = {}) {
  const real = createMockCtx(demoFixtures(), { latencyMs: 0 });
  if (saved !== undefined) await real.collections('preferences').put('main-mart', saved as never);
  const puts: unknown[] = [];
  const ctx: Ctx = {
    ...real,
    route: opts.route,
    owox: { ...real.owox, dataMarts: { ...real.owox.dataMarts, list: async () => (opts.slowModel ? await new Promise((r) => setTimeout(r, 0)) : undefined, await real.owox.dataMarts.list()).map((m) => (opts.sources?.gone ? { ...m, definitionType: 'SQL' as const } : m)) } },
    collections: <T,>(name: string) => {
      const c = real.collections<T>(name);
      const get = async (id: string) => {
        if (name === 'preferences' && id === 'main-mart') {
          if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
          if (opts.fail) throw new Error('storage down');
        }
        return c.get(id);
      };
      return { get, put: (id: string, d: T) => { if (name === 'preferences' && id === 'main-mart') puts.push(d); return c.put(id, d); } };
    },
  };
  render(<AppServices ctx={ctx}><StoreProvider><App /><Probe /></StoreProvider></AppServices>);
  return { ctx, puts };
}
const settled = () => waitFor(() => expect(document.querySelector('.dm-loadbar')).toBeNull());
const stored = (ctx: Ctx) => ctx.collections<Saved>('preferences').get('main-mart').then((d) => d?.document);

describe('the remembered main data mart', () => {
  test('with nothing remembered, the first load picks the focus mart and does not save it; a later pick is saved', async () => {
    const { ctx, puts } = await setup();
    await settled();
    await waitFor(() => expect(box.latest.selection.martId).not.toBeNull());
    await quiet();
    expect(puts).toEqual([]);
    await pick('customers');
    await waitFor(async () => expect((await stored(ctx))?.martId).toBe('customers'));
  });

  test('a remembered mart opens on first load, with its source', async () => {
    const { ctx, puts } = await setup({ martId: 'returns', sourceKey: 'Shopify' });
    await settled();
    await waitFor(() => expect(box.latest.selection.martId).toBe('returns'));
    expect(box.latest.selection.sourceKey).toBe(SHOPIFY);
    expect(box.latest.history).toEqual([]);
    await quiet();
    expect(puts).toEqual([]);
    expect((await stored(ctx))?.martId).toBe('returns');
  });

  test('a remembered mart is not written back again unchanged', async () => {
    const { puts } = await setup({ martId: 'returns', sourceKey: null });
    await settled();
    await waitFor(() => expect(box.latest.selection.martId).toBe('returns'));
    await new Promise((r) => setTimeout(r, 100));
    expect(puts).toEqual([]);
  });

  test('a remembered mart that is gone falls back to the focus mart', async () => {
    await setup({ martId: 'deleted_mart', sourceKey: null });
    await settled();
    await waitFor(() => expect(box.latest.selection.martId).not.toBeNull());
    expect(box.latest.selection.martId).not.toBe('deleted_mart');
  });

  test('a remembered mart the member cannot open falls back to the focus mart', async () => {
    const { puts } = await setup({ martId: 'secret_ledger', sourceKey: null });
    await settled();
    await waitFor(() => expect(box.latest.selection.martId).not.toBeNull());
    expect(box.latest.selection.martId).not.toBe('secret_ledger');
    await quiet();
    expect(puts).toEqual([]);
  });

  test('a remembered source that does not feed the mart is dropped', async () => {
    // GA4 exists, but it does not feed returns.
    const { puts } = await setup({ martId: 'returns', sourceKey: GA4 });
    await settled();
    await waitFor(() => expect(box.latest.selection.martId).toBe('returns'));
    expect(box.latest.selection.sourceKey).toBeNull();
    await quiet();
    expect(puts).toEqual([]);
  });

  test('an empty selection after the first load does not reopen the remembered mart', async () => {
    await setup({ martId: 'returns', sourceKey: SHOPIFY });
    await settled();
    await waitFor(() => expect(box.latest.selection.martId).toBe('returns'));
    // Selecting the source that is already selected clears it, which leaves no mart and no source.
    await act(async () => box.dispatch({ type: 'selectSource', key: SHOPIFY }));
    await waitFor(() => expect(box.latest.selection.martId).not.toBeNull());
    expect(box.latest.selection.martId).not.toBe('returns');
  });

  test('a failed read writes nothing on first load; the first pick the member makes is saved', async () => {
    const { puts } = await setup({ martId: 'returns', sourceKey: null }, { fail: true });
    await settled();
    await waitFor(() => expect(box.latest.selection.martId).not.toBeNull());
    await quiet();
    expect(puts).toEqual([]);
    await pick('customers');
    await waitFor(() => expect(puts).toEqual([{ martId: 'customers', sourceKey: null }]));
  });

  test('the focus fallback does not replace the stored mart; a later pick does', async () => {
    const { ctx, puts } = await setup({ martId: 'deleted_mart', sourceKey: null });
    await settled();
    await waitFor(() => expect(box.latest.selection.martId).not.toBeNull());
    await quiet();
    expect(puts).toEqual([]);
    expect((await stored(ctx))?.martId).toBe('deleted_mart');
    await pick('customers');
    await waitFor(async () => expect((await stored(ctx))?.martId).toBe('customers'));
    expect(puts).toHaveLength(1);
  });

  test('saved preferences that arrive after the model still restore the remembered mart', async () => {
    const { puts } = await setup({ martId: 'returns', sourceKey: SHOPIFY }, { delayMs: 400 });
    // The model loads well inside the delay; the stored mart is not read yet, so nothing is picked.
    await new Promise((r) => setTimeout(r, 250));
    expect(box.latest.selection.martId).toBeNull();
    await waitFor(() => expect(box.latest.selection.martId).toBe('returns'), { timeout: 3000 });
    await quiet();
    expect(puts).toEqual([]);
  });

  const linkView = { sourceKey: null, martId: 'orders', record: null, search: '', contextIds: [], storageIds: null, folded: { sources: true, marts: false, data: false, row: false }, grid: null };

  test('the mart a view link opens is not written', async () => {
    const { puts } = await setup({ martId: 'returns', sourceKey: null }, { route: await encodeViewLink(linkView) });
    await settled();
    await waitFor(() => expect(box.latest.selection.martId).toBe('orders'));
    await quiet();
    expect(puts).toEqual([]);
  });

  test('a view link that opens on a source alone does not swallow the first mart the member picks', async () => {
    const { puts } = await setup({ martId: 'returns', sourceKey: null }, { route: await encodeViewLink({ ...linkView, martId: null, sourceKey: SHOPIFY }) });
    await settled();
    await waitFor(() => expect(box.latest.selection.sourceKey).toBe(SHOPIFY));
    await quiet();
    expect(box.latest.selection.martId).toBeNull();
    expect(puts).toEqual([]);
    await pick('customers');
    await waitFor(() => expect(puts).toEqual([{ martId: 'customers', sourceKey: null }]));
  });

  test('clicking the opened mart off and on again is saved', async () => {
    const { ctx } = await setup({ martId: 'deleted_mart', sourceKey: null });
    await settled();
    await waitFor(() => expect(box.latest.selection.martId).not.toBeNull());
    const focus = box.latest.selection.martId!;
    await act(async () => box.dispatch({ type: 'replace', selection: { sourceKey: null, martId: null, record: null, cleared: true } }));
    await quiet();
    expect(box.latest.selection.martId).toBeNull();
    await pick(focus);
    await waitFor(async () => expect((await stored(ctx))?.martId).toBe(focus));
  });

  test('a source-only link, then toggling the source off, opens the focus mart and not the remembered one', async () => {
    await setup({ martId: 'returns', sourceKey: null }, { route: await encodeViewLink({ ...linkView, martId: null, sourceKey: SHOPIFY }) });
    await settled();
    await waitFor(() => expect(box.latest.selection.sourceKey).toBe(SHOPIFY));
    await act(async () => box.dispatch({ type: 'selectSource', key: SHOPIFY }));
    await waitFor(() => expect(box.latest.selection.martId).not.toBeNull());
    expect(box.latest.selection.martId).not.toBe('returns');
  });

  test('a refresh that takes the selected mart\'s source away drops it without writing', async () => {
    const sources = { gone: false };
    const { puts } = await setup({ martId: 'returns', sourceKey: SHOPIFY }, { sources });
    await settled();
    await waitFor(() => expect(box.latest.selection.sourceKey).toBe(SHOPIFY));
    sources.gone = true;
    await act(async () => box.dispatch({ type: 'refreshModel' }));
    await waitFor(() => expect(box.latest.selection.sourceKey).toBeNull());
    expect(box.latest.selection.martId).toBe('returns');
    await quiet();
    expect(puts).toEqual([]);
  });

  test('preferences ready before the model still open the remembered mart, with no write', async () => {
    const { puts } = await setup({ martId: 'returns', sourceKey: null }, { slowModel: true });
    await settled();
    await waitFor(() => expect(box.latest.selection.martId).toBe('returns'));
    await quiet();
    expect(puts).toEqual([]);
  });
});

describe('the search box on a first visit', () => {
  const combobox = () => screen.queryByRole('combobox', { name: 'Search data marts' });
  const button = () => screen.queryByRole('button', { name: 'Search data marts' });
  const linkView = { sourceKey: null, martId: 'orders', record: null, search: '', contextIds: [], storageIds: null, folded: { sources: true, marts: false, data: false, row: false }, grid: null };

  test('nothing remembered and no view link: the box is open with the focus in it, and Escape does not reopen it', async () => {
    await setup();
    await settled();
    await waitFor(() => expect(combobox()).toHaveFocus());
    expect(button()).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(combobox()).toBeNull();
    await quiet();
    expect(combobox()).toBeNull();
    expect(button()).not.toBeNull();
  });

  test('a remembered mart that can be opened: the button, not the box', async () => {
    await setup({ martId: 'returns', sourceKey: null });
    await settled();
    await waitFor(() => expect(box.latest.selection.martId).toBe('returns'));
    expect(combobox()).toBeNull();
    expect(button()).not.toBeNull();
  });

  test('a remembered mart that is gone: the box', async () => {
    await setup({ martId: 'no-such-mart', sourceKey: null });
    await settled();
    await waitFor(() => expect(combobox()).toHaveFocus());
  });

  test('a remembered mart the member cannot access: the box', async () => {
    await setup({ martId: 'secret_ledger', sourceKey: null });
    await settled();
    await waitFor(() => expect(combobox()).toHaveFocus());
  });

  test('a preferences read that failed: the box', async () => {
    await setup({ martId: 'returns', sourceKey: null }, { fail: true });
    await settled();
    await waitFor(() => expect(combobox()).toHaveFocus());
  });

  test('the source toggled off after a remembered first load does not open the box mid-session', async () => {
    await setup({ martId: 'returns', sourceKey: SHOPIFY });
    await settled();
    await waitFor(() => expect(box.latest.selection.martId).toBe('returns'));
    await act(async () => box.dispatch({ type: 'selectSource', key: SHOPIFY }));
    await waitFor(() => expect(box.latest.selection.martId).not.toBe('returns'));
    await quiet();
    expect(combobox()).toBeNull();
    expect(button()).not.toBeNull();
  });

  test('a source-only view link: the button, and it stays so when the source is toggled off', async () => {
    await setup(undefined, { route: await encodeViewLink({ ...linkView, martId: null, sourceKey: SHOPIFY }) });
    await settled();
    await waitFor(() => expect(box.latest.selection.sourceKey).toBe(SHOPIFY));
    await quiet();
    expect(combobox()).toBeNull();
    await act(async () => box.dispatch({ type: 'selectSource', key: SHOPIFY }));
    await waitFor(() => expect(box.latest.selection.martId).not.toBeNull());
    await quiet();
    expect(combobox()).toBeNull();
    expect(button()).not.toBeNull();
  });

  test('a mart picked while the preferences load settles the first visit: a source toggled on and off later does not open the box', async () => {
    await setup({ martId: 'returns', sourceKey: SHOPIFY }, { delayMs: 600 });
    await waitFor(() => expect(box.latest.selection.martId).toBeNull());
    await pick('customers');
    await waitFor(() => expect(box.latest.selection.martId).toBe('customers'));
    await settled();
    await quiet();
    await act(async () => box.dispatch({ type: 'selectSource', key: SHOPIFY }));
    await waitFor(() => expect(box.latest.selection.sourceKey).toBe(SHOPIFY));
    expect(combobox()).toBeNull();
    await act(async () => box.dispatch({ type: 'selectSource', key: SHOPIFY }));
    await waitFor(() => expect(box.latest.selection.sourceKey).toBeNull());
    await quiet();
    expect(combobox()).toBeNull();
    expect(button()).not.toBeNull();
  });

  test('a view link: the button', async () => {
    await setup(undefined, { route: await encodeViewLink({ ...linkView, martId: 'returns' }) });
    await settled();
    await waitFor(() => expect(box.latest.selection.martId).toBe('returns'));
    await quiet();
    expect(combobox()).toBeNull();
    expect(button()).not.toBeNull();
  });
});
