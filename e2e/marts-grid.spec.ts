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
