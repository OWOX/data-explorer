import type { Ctx } from './sdk/types';

/** Where OWOX is when the host cannot say: the hosted app. */
const OWOX_APP_URL = 'https://app.owox.com';
export const PAGE_SIZE = 200;
/** The most marts a smart search names, in its answer and in a view link. */
export const MAX_FOUND = 5;
export const COUNT_CONCURRENCY = 4;
/** The most filtered card counts kept per session, least recently used out first. */
export const FILTERED_COUNT_LIMIT = 64;
export const IN_LIST_MAX = 500;

const martAppPath = (projectId: string, martId: string): string => `/ui/${encodeURIComponent(projectId)}/data-marts/${encodeURIComponent(martId)}/overview`;

/** A data mart's page in OWOX: on the host's own origin when the host knows it, else on app.owox.com. */
export function martAppUrl(ctx: Pick<Ctx, 'projectId' | 'ui'>, martId: string): string {
  const path = martAppPath(ctx.projectId, martId);
  return ctx.ui.link(path)?.href ?? `${OWOX_APP_URL}${path}`;
}

/** How long a view link waits for the main mart's fields before it stops pruning the grid. */
export const VIEW_LINK_WAIT_MS = import.meta.env.MODE === 'test' ? 0 : 5000;

/** How long a full load bar stays on screen, pale green, before the bands' bodies replace it. */
export const LOADED_HOLD_MS = import.meta.env.MODE === 'test' ? 0 : 450;
