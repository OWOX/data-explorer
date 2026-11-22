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
  // A mart outside the report that can join it is full strength with a dashed border.
  await expect(marts.locator('article#dm-countries')).toHaveClass(/dm-offpath/);
  await expect(marts.locator('article#dm-countries')).not.toHaveClass(/dm-faded/);
  await expect(marts.locator('article#dm-countries')).toHaveCSS('border-top-style', 'dashed');
  await expect(marts.locator('article#dm-countries')).toHaveCSS('opacity', '1');

  // The x on the joined card takes it out.
  await customers.getByRole('button', { name: 'Remove Customers from the report' }).click();
  await expect(data.locator('th[data-group="customers"]')).toHaveCount(0);
});

test('cards: only path cards have a white background in Grid; hover leaves the border alone, only the selected card has a 2px one, and it does not move', async ({ page }) => {
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
  // Every card has a 1px border; hovering does not thicken it and does not move the card.
  // Let the cards' entrance animation (250ms) finish, or the first measure can be mid-motion.
  await page.waitForTimeout(400);
  const border = (l: typeof main) => l.evaluate((e) => getComputedStyle(e).borderTopWidth);
  const before = await other.boundingBox();
  await other.hover();
  expect(await other.boundingBox()).toEqual(before);
  expect(await border(other)).toBe('1px');
  expect(await border(main)).toBe('1px');
  // Only the selected card (the focused one) has 2px, from the padding's share: its box keeps its size, and it shows no keyboard ring.
  const mainBefore = await main.boundingBox();
  await main.click();
  await expect(main).toHaveAttribute('data-focused', '');
  expect(await border(main)).toBe('2px');
  expect(await main.boundingBox()).toEqual(mainBefore);
  expect(await main.evaluate((e) => getComputedStyle(e).boxShadow)).toBe('none');
  expect(await border(other)).toBe('1px');
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
