export const OWOX_APP_URL = 'https://app.owox.com';
export const VISIBLE_BUDGET = 12;
export const PAGE_SIZE = 200;
export const SCHEMA_CONCURRENCY = 6;
export const IN_LIST_MAX = 500;

export function martAppUrl(projectId: string, martId: string): string {
  return `${OWOX_APP_URL}/ui/${encodeURIComponent(projectId)}/data-marts/${encodeURIComponent(martId)}/overview`;
}
