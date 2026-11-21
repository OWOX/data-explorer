import { expect, test } from '@playwright/test';

test('grid: a click focuses a card and shows what joins under it, × removes', async ({ page }) => {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  const data = page.locator('#band-data');
  await expect(marts.locator('article#dm-orders')).toBeVisible();
  await marts.locator('article#dm-customers').click();
  await expect(data.locator('th[data-group="customers"]')).toHaveCount(1);

  // A click on the main card removes nothing; it shows what joins under it.
  await marts.locator('article#dm-orders').click();
  await expect(marts.locator('article#dm-orders')).toHaveAttribute('data-focused', '');
  await expect(data.locator('th[data-group="customers"]')).toHaveCount(1);

  // A click on a joined card focuses it and shows its joinable marts; it removes nothing.
  const customers = marts.locator('[id="dm-customers@customers"]');
  await customers.click();
  await expect(customers).toHaveAttribute('data-focused', '');
  await expect(data.locator('th[data-group="customers"]')).toHaveCount(1);
  await expect(marts.locator('article#dm-countries')).not.toHaveClass(/dm-unjoinable/);
  await expect(marts.locator('article#dm-products')).toHaveClass(/dm-unjoinable/);

  // The x on the joined card takes it out.
  await customers.getByRole('button', { name: 'Remove Customers from the report' }).click();
  await expect(data.locator('th[data-group="customers"]')).toHaveCount(0);
});

test('cards: only path cards have a white background in Grid; hover and selection thicken the border without moving the card', async ({ page }) => {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  const main = marts.locator('article#dm-orders');
  await expect(main).toBeVisible();
  const bg = (l: typeof main) => l.evaluate((e) => getComputedStyle(e).backgroundColor);
  const otherId = (await marts.locator('.dm-band-grid > article:not(.dm-in-path)').first().getAttribute('id'))!;
  // By id: hovering puts the card on the path, so a class-based locator would move to the next one.
  const other = marts.locator(`[id="${otherId}"]`);
  await expect(other).toBeVisible();
  expect(await bg(other)).toBe('rgba(0, 0, 0, 0)');
  expect(await bg(main)).not.toBe('rgba(0, 0, 0, 0)');
  // The bold border is a 2px overlay: the box keeps its size.
  const before = await other.boundingBox();
  await other.hover();
  const after = await other.boundingBox();
  expect(after).toEqual(before);
  expect(await other.evaluate((e) => getComputedStyle(e, '::after').borderTopWidth)).toBe('2px');
});

test('the Data band fills the viewport below the bands above it and scrolls inside', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1800 });
  await page.goto('/?mock');
  const data = page.locator('#band-data');
  await expect(data.locator('tbody tr').first()).toBeVisible();
  const box = (await data.boundingBox())!;
  // Tall viewport: the band runs from its top to the bottom of the screen (less the page padding), not to the end of its content.
  expect(box.y + box.height).toBeGreaterThanOrEqual(1800 - 60);
  expect(box.height).toBeGreaterThan(320);
  // A short viewport: the band keeps its 20rem floor.
  await page.setViewportSize({ width: 1440, height: 500 });
  await expect.poll(async () => (await data.boundingBox())!.height).toBeGreaterThanOrEqual(320);
  // The grid scrolls in its own frame.
  expect(await data.locator('.dm-grid-frame').evaluate((e) => getComputedStyle(e).maxHeight)).toBe('none');
});
