import { expect, test, type Page } from '@playwright/test';

// Grid: a joined card is dragged to rejoin under the closest mart it can join; a card in the band is not dragged, and no drag makes a mart main.
async function joinThree(page: Page) {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  await expect(marts.locator('article#dm-orders')).toBeVisible();
  await marts.locator('article#dm-customers').click();
  await expect(marts.locator('[id="dm-customers@customers"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await marts.locator('article#dm-stores').click();
  await expect(marts.locator('[id="dm-stores@stores"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await marts.locator('[id="dm-customers@customers"]').click();
  await marts.locator('article#dm-countries').click();
  await expect(marts.locator('[id="dm-countries@customers.countries"]')).toBeVisible();
  await page.keyboard.press('Escape');
  return marts;
}

const centre = async (loc: ReturnType<Page['locator']>) => { const b = (await loc.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

test('grid: dragging a joined card shows solid and dashed lines, dims the rest, and a drop on a closer mart rejoins it', async ({ page }) => {
  const marts = await joinThree(page);
  const held = marts.locator('[id="dm-countries@customers.countries"]');
  const from = await centre(held);
  const stores = await centre(marts.locator('[id="dm-stores@stores"]'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
  await page.mouse.move(stores.x, stores.y, { steps: 8 });
  const lines = page.locator('svg#drag-line path');
  await expect(lines).toHaveCount(2);
  await expect(page.locator('svg#drag-line path.joined')).toHaveAttribute('data-target', 'customers');
  await expect(page.locator('svg#drag-line path.ghost')).toHaveAttribute('data-target', 'stores');
  await expect(page.locator('svg#drag-line path.closest')).toHaveAttribute('data-target', 'stores');
  await expect(marts.locator('article#dm-orders')).toHaveClass(/dm-faded/);
  await expect(marts.locator('[id="dm-stores@stores"]')).not.toHaveClass(/dm-faded/);
  await expect(marts.locator('[id="dm-customers@customers"]')).not.toHaveClass(/dm-faded/);
  await page.mouse.up();
  await expect(page.locator('svg#drag-line')).toHaveCount(0);
  await expect(marts.locator('[id="dm-countries@stores.countries"]')).toBeVisible();
  await expect(marts.locator('[id="dm-countries@customers.countries"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(marts.locator('[id="dm-countries@customers.countries"]')).toBeVisible();
});

test('grid: a card in the band is not dragged, and a drop on the main card makes nothing main', async ({ page }) => {
  const marts = await joinThree(page);
  const band = await centre(marts.locator('article#dm-products'));
  const main = await centre(marts.locator('article#dm-orders'));
  await page.mouse.move(band.x, band.y);
  await page.mouse.down();
  await page.mouse.move(band.x + 12, band.y + 12, { steps: 4 });
  await page.mouse.move(main.x, main.y, { steps: 8 });
  await expect(page.locator('svg#drag-line')).toHaveCount(0);
  await expect(page.locator('.dm-drag-ghost')).toHaveCount(0);
  await page.mouse.up();
  await expect(marts.locator('article#dm-orders')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#band-data th[data-group="orders"]')).toHaveCount(1);
});
