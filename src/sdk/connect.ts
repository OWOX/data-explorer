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

// type check only: fails to compile if the SDK context stops satisfying Ctx's models shape
export async function _typeCheck() {
  const owox = (await connect()).owox;
  const _check: Pick<Ctx['owox']['models'], 'getEdges'> = owox.models;
  const _destinations: Ctx['owox']['destinations'] = owox.destinations;
  const _put: Ctx['owox']['putJson'] = owox.putJson.bind(owox);
  const sdk = await connect();
  const _route: Ctx['route'] = sdk.route;
  const _copy: Ctx['ui']['copyLink'] = sdk.ui.copyLink.bind(sdk.ui);
  const _setRoute: Ctx['ui']['setRoute'] = sdk.ui.setRoute.bind(sdk.ui);
  const _credentials: Ctx['credentials'] = sdk.credentials;
  return [_check, _destinations, _put, _route, _copy, _setRoute, _credentials] as const;
}
