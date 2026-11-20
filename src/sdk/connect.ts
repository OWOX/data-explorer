import { connect } from '@owox/plugin-sdk';
import type { Ctx } from './types';

export async function bootContext(): Promise<Ctx | 'outside-host'> {
  if (new URLSearchParams(location.search).has('mock')) {
    const { createMockCtx } = await import('./mock/ctx');
    const { demoFixtures } = await import('./mock/fixtures');
    const sheets = new URLSearchParams(location.search).get('sheets');
    // ?ai=0 is a project with no AI configured.
    return createMockCtx(demoFixtures({ sheets: sheets === '0' || sheets === '1' ? Number(sheets) as 0 | 1 : 2 }), { latencyMs: 250, ai: new URLSearchParams(location.search).get('ai') !== '0' });
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
