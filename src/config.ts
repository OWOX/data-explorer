export const OWOX_APP_URL = 'https://app.owox.com';
export const PAGE_SIZE = 200;
/** The most marts a smart search names, in its answer and in a view link. */
export const MAX_FOUND = 5;
export const COUNT_CONCURRENCY = 4;
export const IN_LIST_MAX = 500;
// The backend caps each base64url query parameter at 8192 encoded chars; 6000 raw JSON chars stays under it.
export const IN_LIST_MAX_CHARS = 6000;

export function martAppUrl(projectId: string, martId: string): string {
  return `${OWOX_APP_URL}/ui/${encodeURIComponent(projectId)}/data-marts/${encodeURIComponent(martId)}/overview`;
}

/** How long a view link waits for the main mart's fields before it stops pruning the grid. */
export const VIEW_LINK_WAIT_MS = import.meta.env.MODE === 'test' ? 0 : 5000;

/** How long a full load bar stays on screen, pale green, before the bands' bodies replace it. */
export const LOADED_HOLD_MS = import.meta.env.MODE === 'test' ? 0 : 450;
