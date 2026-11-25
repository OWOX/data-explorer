import { connect } from '@owox/plugin-sdk';
import type { Ctx } from './types';

export async function bootContext(): Promise<Ctx | 'outside-host'> {
  if (new URLSearchParams(location.search).has('mock')) {
    const { createMockCtx } = await import('./mock/ctx');
    const { demoFixtures } = await import('./mock/fixtures');
    const sheets = new URLSearchParams(location.search).get('sheets');
    // ?latency=3000 slows every read, as a real API does (default 250 ms).
    const latency = Number(new URLSearchParams(location.search).get('latency') ?? 250);
    const demo = demoFixtures({ sheets: sheets === '0' || sheets === '1' ? Number(sheets) as 0 | 1 : 2 });
    // ?urls makes every order's status a URL, and records the URLs the plugin opens in `window.__opened` (the e2e specs about links use it).
    const urls = new URLSearchParams(location.search).has('urls');
    const { withUrls, recordOpened } = urls ? await import('./mock/urls') : { withUrls: (f: typeof demo) => f, recordOpened: <T,>(c: T) => c };
    // ?ai=0 is a project with no AI configured.
    const base = createMockCtx(withUrls(demo), { latencyMs: Number.isFinite(latency) ? Math.max(0, latency) : 250, ai: new URLSearchParams(location.search).get('ai') !== '0' });
    const ctx = recordOpened(base);
    // ?keyshown opens the orders grid with its key column, as it was before the key left the default columns (the e2e specs about that column use it).
    if (new URLSearchParams(location.search).has('keyshown')) (await import('./mock/key-shown')).keyShown(ctx);
    return ctx;
  }
  try {
    return (await connect()) as unknown as Ctx;
  } catch {
    return 'outside-host';
  }
}

// Compile-time check only, never called: fails to compile if the SDK context stops satisfying the members of Ctx the plugin uses.
type Sdk = Awaited<ReturnType<typeof connect>>;
export const _sdkFitsCtx = (s: Sdk): Pick<Ctx, 'route' | 'credentials'> & { ui: Pick<Ctx['ui'], 'copyLink' | 'setRoute'>; owox: Pick<Ctx['owox'], 'models' | 'destinations' | 'putJson' | 'deleteJson'> } => s;
