import type { Ctx } from '../types';
import type { Fixtures } from './fixtures';

/** Test helper (`?urls`): every order's status is a URL, and a URL the plugin opens is recorded in `window.__opened` instead of opening a tab. */
export function withUrls(f: Fixtures): Fixtures {
  f.marts.find((m) => m.id === 'orders')!.rows.forEach((r) => { r.status = `https://example.com/orders/${r.id}/items?tab=details`; });
  return f;
}

export function recordOpened<T extends Ctx>(ctx: T): T {
  const w = window as unknown as { __opened: string[] };
  w.__opened = [];
  return { ...ctx, ui: { ...ctx.ui, openExternal: async (url: string) => { w.__opened.push(url); } } };
}
