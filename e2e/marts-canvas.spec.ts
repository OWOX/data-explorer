import { expect, test } from '@playwright/test';

test('canvas: add marts through ghosts, move countries from customers to stores, undo', async ({ page }) => {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  await marts.getByRole('radio', { name: 'Canvas' }).click();
  await expect(marts.locator('article#dm-orders')).toBeVisible();

  // Add customers and stores through the main card's ghosts, then countries through customers.
  await marts.locator('article#dm-orders').hover();
  await marts.locator('article[data-ghost]#dm-customers').click();
  await expect(marts.locator('article[data-ghost]#dm-customers')).toHaveCount(0);
  await marts.locator('article#dm-orders').hover();
  await expect(marts.locator('article[data-ghost]#dm-stores')).toBeVisible();
  await marts.locator('article[data-ghost]#dm-stores').click();
  await expect(marts.locator('article[data-ghost]#dm-stores')).toHaveCount(0);
  await marts.locator('article#dm-customers').hover();
  await expect(marts.locator('article[data-ghost]#dm-countries')).toBeVisible();
  await marts.locator('article[data-ghost]#dm-countries').click();
  await expect(page.locator('#tree-wires path[data-from="dm-customers"][data-to="dm-countries"]')).toHaveCount(1);

  // Drag countries onto stores: a dashed line shows while dragging.
  const from = await marts.locator('article#dm-countries').boundingBox();
  const to = await marts.locator('article#dm-stores').boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + from!.width / 2 + 10, from!.y + from!.height / 2 + 10, { steps: 4 });
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 6 });
  await expect(marts.locator('svg#drag-line path')).toHaveCount(1);
  await page.screenshot({ path: 'tmp/marts-canvas-drag.png' });
  await page.mouse.up();
  await expect(marts.locator('svg#drag-line')).toHaveCount(0);

  // Countries now hangs from stores: its tree wire comes from dm-stores.
  await expect(page.locator('#tree-wires path[data-from="dm-stores"][data-to="dm-countries"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#tree-wires path[data-from="dm-customers"][data-to="dm-countries"]')).toHaveCount(1);
});
