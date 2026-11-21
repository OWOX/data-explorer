import { expect, test } from '@playwright/test';

test('a click on a band header with the column menu open only closes the menu', async ({ page }) => {
  await page.goto('/?mock');
  const data = page.locator('#band-data');
  await expect(data.getByRole('row')).toHaveCount(202);
  await data.getByLabel('Column menu status').click();
  await expect(page.getByRole('menu', { name: 'Menu of status' })).toBeVisible();
  await data.locator('.dm-band-title').click();
  await expect(page.getByRole('menu', { name: 'Menu of status' })).toHaveCount(0);
  await expect(data.getByRole('table')).toBeVisible();
  // The next click is not swallowed: it folds the band.
  await data.locator('.dm-band-title').click();
  await expect(data.getByRole('table')).toHaveCount(0);
});
