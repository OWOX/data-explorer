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
    await page.screenshot({ path: `tmp/band-toolbar-${mode}.png`, clip: { x: 700, y: 0, width: 740, height: 200 } });
    const b = await boxes(page);
    console.log(mode, JSON.stringify(b));
    expect(b.length).toBe(4);
    const gaps = b.slice(1).map((c, i) => c.x - b[i]!.r);
    gaps.forEach((g) => expect(Math.abs(g - gaps[0]!)).toBeLessThanOrEqual(1));
    expect(Math.abs(gaps[0]! - 8)).toBeLessThanOrEqual(1);
    // The chevron is a borderless round button: its icon, not its box, sets the visible gap.
    const icon = await data(page).locator('.dm-band-fold svg').boundingBox();
    expect(Math.abs(icon!.x - b[b.length - 1]!.r - 8)).toBeLessThanOrEqual(1);
  });
}
