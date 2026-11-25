import { expect, test, type Locator, type Page } from '@playwright/test';
import { closeConfig, configButton, openFields } from './config-menu';

const CELL = 24;
test.beforeEach(async ({ page }) => {
  await page.goto('/?mock');
  await expect(page.locator('#band-data').getByRole('row')).toHaveCount(202);
  for (const name of ['is_gift', /created_at/i]) { await openFields(page, 'Orders'); await page.getByRole('option', { name }).click(); await closeConfig(page); }
  await page.locator('#band-data').getByRole('radio', { name: 'Charts' }).click();
  await expect(page.locator('#band-data section.dm-chart')).toHaveCount(2);
});
const data = (page: Page) => page.locator('#band-data');
const panel = (page: Page, kind: string) => data(page).locator(`section[data-chart-kind="${kind}"]`);
const size = async (l: Locator) => { const b = (await l.boundingBox())!; return [Math.round(b.width), Math.round(b.height)]; };
/** The size once its transition is over. */
const settled = async (l: Locator) => { let last = ''; await expect.poll(async () => { const s = JSON.stringify(await size(l)); const same = s === last; last = s; return same; }, { intervals: [150] }).toBe(true); return size(l); };
async function resizeMode(page: Page, kind: string) {
  await panel(page, kind).scrollIntoViewIfNeeded();
  await panel(page, kind).hover();
  await panel(page, kind).getByRole('button', { name: `${kind} options` }).click();
  await page.getByRole('menuitem', { name: 'Resize', exact: true }).click();
}
async function drag(page: Page, handle: Locator, dx: number, dy: number, shot?: string) {
  await handle.scrollIntoViewIfNeeded();
  const b = (await handle.boundingBox())!;
  const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  if (shot) await page.screenshot({ path: `tmp/${shot}.png` });
  await page.mouse.up();
}

test('every panel sits on whole cells, and a drag moves its width and height by whole cells', async ({ page }) => {
  await expect(panel(page, 'Pie').locator('.dm-pie-slice').first()).toBeVisible();
  for (const kind of ['Pie', 'Time series']) { const s = await settled(panel(page, kind)); expect(s.map((n) => n % CELL)).toEqual([0, 0]); }
  await resizeMode(page, 'Pie');
  const before = await settled(panel(page, 'Pie'));
  await expect(panel(page, 'Time series').locator('[data-edge="e"]')).toHaveCSS('cursor', 'ew-resize');
  // The grid is virtual: resize mode draws nothing behind the charts.
  await expect(data(page).locator('[data-chart-panels]')).toHaveCSS('background-image', 'none');
  await drag(page, panel(page, 'Pie').locator('[data-edge="se"]'), 100, 110, 'resize-drag');
  const after = await settled(panel(page, 'Pie'));
  expect(after).toEqual([before[0]! + 4 * CELL, before[1]! + 5 * CELL]);
  // The pie grows with its panel; nothing spills out of it.
  const [box, svg] = [(await panel(page, 'Pie').boundingBox())!, (await panel(page, 'Pie').locator('.dm-pie svg').boundingBox())!];
  expect(svg.height).toBeGreaterThan(180);
  expect(svg.y + svg.height).toBeLessThanOrEqual(box.y + box.height);
  await page.keyboard.press('Escape');
  await expect(panel(page, 'Pie').locator('[data-edge]')).toHaveCount(0);
  // The size outlives the body: Charts read it back from the store.
  await data(page).getByRole('radio', { name: 'Table' }).click();
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  await expect(panel(page, 'Pie').locator('.dm-pie-slice').first()).toBeVisible();
  expect(await settled(panel(page, 'Pie'))).toEqual(after);
  await panel(page, 'Pie').hover();
  await panel(page, 'Pie').getByRole('button', { name: 'Pie options' }).click();
  await page.getByRole('menuitem', { name: 'Reset size' }).click();
  expect(await settled(panel(page, 'Pie'))).toEqual(before);
});

test('resize mode stays on when the mouse leaves the charts; a press outside them ends it', async ({ page }) => {
  await resizeMode(page, 'Pie');
  const handles = data(page).locator('.dm-resize');
  await panel(page, 'Pie').hover();
  await page.mouse.move(400, 40, { steps: 5 });
  await page.waitForTimeout(1500);
  await expect(handles.first()).toBeAttached();
  await page.mouse.click(400, 40);
  await expect(handles).toHaveCount(0);
});

test('a width stops at the whole cells the band has', async ({ page }) => {
  await resizeMode(page, 'Pie');
  await drag(page, panel(page, 'Pie').locator('[data-edge="e"]'), 1200, 0);
  await drag(page, panel(page, 'Pie').locator('[data-edge="e"]'), 600, 0);
  const [w] = await settled(panel(page, 'Pie'));
  const band = (await data(page).locator('[data-chart-panels]').boundingBox())!;
  expect(w! % CELL).toBe(0);
  expect(w!).toBeLessThanOrEqual(band.width - CELL);
});

for (const kind of ['Bar chart', 'Ranked bar', 'Line', 'Heatmap', 'Sankey', 'Scatter', 'Time series']) {
  test(`${kind} fills the height it is given`, async ({ page }) => {
    // The time series is a default chart; the others are added.
    if ((await panel(page, kind).count()) === 0) {
      await configButton(page).click();
      await page.getByRole('menuitem', { name: 'Add chart' }).click();
      await page.getByRole('menuitemradio', { name: kind, exact: true }).click();
    }
    const p = panel(page, kind);
    await expect(p.locator('svg[role]').first()).toBeVisible();
    await settled(p);
    await resizeMode(page, kind);
    const handle = p.locator('[data-edge="se"]');
    await handle.focus();
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown');
    const [, h] = await settled(p);
    expect(h! % CELL).toBe(0);
    const parts = await p.evaluate((el) => { const r = (q: string) => el.querySelector(q)!.getBoundingClientRect().height; return { svg: r('svg[role]'), plot: r('.dm-chart-plot') }; });
    // Rows share the plot in whole pixels, so a few may be left over.
    expect(parts.plot - parts.svg).toBeLessThan(24);
    expect(parts.svg - parts.plot).toBeLessThanOrEqual(1);
    await p.screenshot({ path: `tmp/resize-${kind.replace(/ /g, '-')}.png` });
  });
}
