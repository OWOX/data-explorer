import { expect, test, type Page } from '@playwright/test';

const band = (page: Page, id: 'marts' | 'data') => page.locator(`#band-${id}`);
const firstGroup = (page: Page) => band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first();

type Sample = { first: string; group: string; top: number; left: number };

test('with slow reads the old main stays first until the new one is main, and the new main is first and top-left from then on', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1400, height: 900 });
  // Every read takes 2 s; the order_items ghost has never been read (no schema, no joins), so making it main is a cold read.
  await page.goto('/?mock&latency=2000');
  await expect(firstGroup(page)).toHaveText('Orders', { timeout: 30000 });
  await band(page, 'marts').locator('article#dm-orders').hover();
  const ghost = band(page, 'marts').locator('article[data-ghost]').first();
  await expect(ghost).toBeVisible();
  const id = (await ghost.getAttribute('id'))!;
  await ghost.click();
  await page.evaluate(() => {
    const w = window as unknown as { samples: Sample[]; sampler: number };
    w.samples = [];
    w.sampler = window.setInterval(() => {
      const first = document.querySelector('#band-marts article:not([data-ghost]):not(.dm-leaving)');
      const box = first?.getBoundingClientRect();
      w.samples.push({ first: first?.id ?? '', group: document.querySelector('#band-data thead tr[data-group-row] th[data-group] .truncate')?.textContent ?? '', top: Math.round(box?.top ?? 0), left: Math.round(box?.left ?? 0) });
    }, 25);
  });
  const started = Date.now();
  await page.getByRole('button', { name: /Make it main/ }).click();
  // The Data band's first group follows the main mart once its grid is read.
  await expect(firstGroup(page)).not.toHaveText('Orders', { timeout: 30000 });
  const waited = Date.now() - started;
  await page.waitForTimeout(600);
  const samples = await page.evaluate(() => {
    const w = window as unknown as { samples: Sample[]; sampler: number };
    window.clearInterval(w.sampler);
    return w.samples;
  });
  // The read was slow: the change took at least one latency.
  expect(waited).toBeGreaterThan(1500);
  const became = samples.findIndex((s) => s.first === id);
  expect(became).toBeGreaterThanOrEqual(0);
  // Before it leads, the old main does; once it leads it never stops.
  expect(samples.slice(0, became).every((s) => s.first === 'dm-orders')).toBe(true);
  expect(samples.slice(became).every((s) => s.first === id)).toBe(true);
  // The card settles at the first cell of the grid.
  const last = samples.at(-1)!;
  const grid = (await band(page, 'marts').locator('.dm-band-grid').boundingBox())!;
  expect(last.top).toBeLessThanOrEqual(grid.y + 24);
  expect(last.left).toBeLessThanOrEqual(grid.x + 24);
});
