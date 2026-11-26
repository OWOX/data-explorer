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

test('the Export menu and a Storage filter menu are never open together', async ({ page }) => {
  await page.goto('/?mock');
  const data = page.locator('#band-data');
  await expect(data.getByRole('row')).toHaveCount(202);
  const storage = page.locator('#band-marts details.dm-filter', { hasText: 'Storage' });
  const storageOpen = async () => storage.evaluate((d: HTMLDetailsElement) => d.open);
  const exportOpen = () => page.getByRole('menu', { name: 'Export' }).count();
  // Opening Export from the keyboard closes an open Storage menu (a press would only close the Storage menu).
  await storage.locator('summary').click();
  expect(await storageOpen()).toBe(true);
  await data.getByText('Export', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(storageOpen).toBe(false);
  await expect.poll(exportOpen).toBe(1);
  // Opening a Storage menu from the keyboard closes the Export menu.
  await storage.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect.poll(storageOpen).toBe(true);
  await expect.poll(exportOpen).toBe(0);
});
