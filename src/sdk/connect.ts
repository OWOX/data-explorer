import { connect } from '@owox/plugin-sdk';
import type { Ctx } from './types';

export async function bootContext(): Promise<Ctx | 'outside-host'> {
  const params = new URLSearchParams(location.search);
  if (params.has('mock')) {
    const { createMockCtx } = await import('./mock/ctx');
    const { demoFixtures } = await import('./mock/fixtures');
    const sheets = params.get('sheets');
    // ?latency=3000 slows every read, as a real API does (default 250 ms).
    const latency = Number(params.get('latency') ?? 250);
    // ?ai=0 is a project with no AI configured. ?keyshown opens the orders grid with its key column (the e2e specs about that column use it).
    return createMockCtx(demoFixtures({ sheets: sheets === '0' || sheets === '1' ? Number(sheets) as 0 | 1 : 2 }), { latencyMs: Number.isFinite(latency) ? Math.max(0, latency) : 250, ai: params.get('ai') !== '0', keyShown: params.has('keyshown') });
  }
  try {
    return (await connect()) as unknown as Ctx;
  } catch {
    return 'outside-host';
  }
}

// Compile-time check only: fails to compile if the SDK context stops satisfying the members of Ctx the plugin uses.
type Sdk = Awaited<ReturnType<typeof connect>>;
type Used = Pick<Ctx, 'route' | 'credentials'> & { ui: Pick<Ctx['ui'], 'copyLink' | 'setRoute' | 'link'>; owox: Pick<Ctx['owox'], 'models' | 'destinations' | 'putJson' | 'deleteJson'> };
type Assert<T extends true> = T;
export type SdkFitsCtx = Assert<Sdk extends Used ? true : false>;
