import { expect, test, type Locator, type Page } from '@playwright/test';
import { configButton } from './config-menu';

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });
const data = (page: Page) => page.locator('#band-data');

// Left and right edges of the visible controls in the Data band header, left to right.
async function boxes(page: Page) {
  const head = data(page).locator('.dm-band-actions');
  await head.getByRole('button', { name: 'Reset' }).waitFor();
  const targets = [head.getByRole('button', { name: 'Reset' }), head.getByRole('button', { name: 'Refresh' }), head.locator('.dm-export > summary'), head.getByRole('button', { name: 'Full screen' })];
  const out: { x: number; r: number }[] = [];
  for (const t of targets) {
    const b = await t.boundingBox();
    if (b) out.push({ x: b.x, r: b.x + b.width });
  }
  return out;
}

for (const mode of ['Table', 'Charts']) {
  test(`${mode}: the Data band toolbar buttons are evenly spaced`, async ({ page }) => {
    await data(page).getByRole('radio', { name: mode }).click();
    const b = await boxes(page);
    expect(b.length).toBe(4);
    const gaps = b.slice(1).map((c, i) => c.x - b[i]!.r);
    gaps.forEach((g) => expect(Math.abs(g - gaps[0]!)).toBeLessThanOrEqual(1));
    expect(Math.abs(gaps[0]! - 8)).toBeLessThanOrEqual(1);
    // The chevron is a borderless round button: its icon, not its box, sets the visible gap.
    const icon = await data(page).locator('.dm-band-fold svg').boundingBox();
    expect(Math.abs(icon!.x - b[b.length - 1]!.r - 8)).toBeLessThanOrEqual(1);
  });
}

// Charts mode loads no rows, so the badge is absent there (as before); only Table can assert the order.
for (const width of [1440, 800]) {
  test(`Table at ${width}px: the records badge sits between the Data title and its hint`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await expect(data(page).locator('.dm-band-count')).toBeVisible();
    const title = await data(page).locator('.dm-band-title').boundingBox();
    const badge = await data(page).locator('.dm-band-count').boundingBox();
    const hint = await data(page).locator('.dm-band-titlegroup .dm-hint').boundingBox();
    expect(badge!.x).toBeGreaterThan(title!.x + title!.width);
    expect(hint!.x).toBeGreaterThan(badge!.x + badge!.width);
  });
}

// The switch clips what does not fit, so a squeezed switch hides "Charts" without overflowing anything.
// 641 is the tightest page with the wide padding: at 640 the page padding shrinks and the header is wider again.
for (const width of [641, 520, 480, 400, 320]) {
  test(`at ${width}px the Table / Charts switch is whole and Configure sits beside or under it`, async ({ page }) => {
    const view = data(page).getByRole('radiogroup', { name: 'Show data as' });
    await expect(view).toBeVisible();
    await expect(data(page).locator('.dm-band-count')).toBeVisible();
    // A long count, as a big table has.
    await data(page).locator('.dm-band-count').evaluate((el) => { el.textContent = '200 of 1,234,567 records'; });
    await page.setViewportSize({ width, height: 900 });
    const right = (l: Locator) => l.evaluate((el) => el.getBoundingClientRect().right);
    const contentRight = (band: Locator) => band.locator('.dm-band-head').evaluate((el) => el.getBoundingClientRect().right - parseFloat(getComputedStyle(el).paddingRight));
    const whole = async (band: Locator, group: Locator) =>
      (await group.evaluate((el) => el.scrollLeft === 0 && el.scrollWidth <= el.clientWidth)) && (await right(group)) <= (await contentRight(band)) + 1;
    await expect.poll(() => whole(data(page), view)).toBe(true);
    const marts = page.locator('#band-marts');
    await expect.poll(() => whole(marts, marts.getByRole('radiogroup', { name: 'Show data marts as' }))).toBe(true);
    // Configure is inside the header, and clear of the switch.
    const c = (await configButton(page).boundingBox())!;
    const v = (await view.boundingBox())!;
    expect(c.x + c.width).toBeLessThanOrEqual((await contentRight(data(page))) + 1);
    expect(c.x >= v.x + v.width || c.y >= v.y + v.height).toBe(true);
    // The count stays on one line, and the title and icon are not squeezed.
    expect((await data(page).locator('.dm-band-count').boundingBox())!.height).toBeLessThan(28);
    expect((await data(page).locator('.dm-band-icon').boundingBox())!.width).toBeCloseTo(28, 0);
    expect(await data(page).locator('.dm-band-title').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
}

for (const width of [1000, 640, 400]) {
  test(`at ${width}px a long Row title stays on one line and ends in an ellipsis`, async ({ page }) => {
    const row = page.locator('#band-row');
    // The records count is only on the loaded page: before it the header is the loading one, which is replaced.
    await expect(data(page).locator('.dm-band-count')).toBeVisible();
    await expect(row.locator('.dm-band-title')).toBeVisible();
    await page.setViewportSize({ width, height: 900 });
    await row.locator('.dm-band-title').evaluate((el) => { el.textContent = `Orders · ${'3f2504e0-4f89-11d3-9a0c-0305e82c3301 '.repeat(5)}`; });
    const title = row.locator('.dm-band-title');
    await expect.poll(() => title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await expect(title).toHaveCSS('text-overflow', 'ellipsis');
    const mid = async (l: Locator) => { const b = (await l.boundingBox())!; return b.y + b.height / 2; };
    const line = await mid(row.locator('.dm-band-icon'));
    expect(Math.abs((await mid(title)) - line)).toBeLessThanOrEqual(2);
    expect(Math.abs((await mid(row.locator('.dm-band-titlegroup .dm-hint').first())) - line)).toBeLessThanOrEqual(2);
  });
}
