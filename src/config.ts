export const OWOX_APP_URL = 'https://app.owox.com';
export const VISIBLE_BUDGET = 12;
export const PAGE_SIZE = 200;
export const SCHEMA_CONCURRENCY = 6;
export const COUNT_CONCURRENCY = 4;
export const IN_LIST_MAX = 500;
// The backend caps each base64url query parameter at 8192 encoded chars; 6000 raw JSON chars stays under it.
export const IN_LIST_MAX_CHARS = 6000;

export function martAppUrl(projectId: string, martId: string): string {
  return `${OWOX_APP_URL}/ui/${encodeURIComponent(projectId)}/data-marts/${encodeURIComponent(martId)}/overview`;
}
