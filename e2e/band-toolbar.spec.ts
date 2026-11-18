import { expect, test, type Page } from '@playwright/test';

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
