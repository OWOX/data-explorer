import { connect } from '@owox/plugin-sdk';
import type { Ctx } from './types';

export async function bootContext(): Promise<Ctx | 'outside-host'> {
  if (new URLSearchParams(location.search).has('mock')) {
    const { createMockCtx } = await import('./mock/ctx');
    const { demoFixtures } = await import('./mock/fixtures');
    return createMockCtx(demoFixtures(), { latencyMs: 250 });
  }
  try {
    return (await connect()) as unknown as Ctx;
  } catch {
    return 'outside-host';
  }
}

// type check only: fails to compile if the SDK context stops satisfying Ctx's models shape
export async function _typeCheck() {
  const _check: Pick<Ctx['owox']['models'], 'getEdges'> = (await connect()).owox.models;
  return _check;
}
