import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });

test('default focus, badges and icons render', async ({ page }) => {
  await expect(page.getByText('Orders', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Data quality: Passed').first()).toBeVisible();
  await expect(page.getByLabel('Open in OWOX').first()).toBeVisible();
});

test('search narrows the canvas', async ({ page }) => {
  await page.getByLabel('Search data marts').fill('campaign');
  await expect(page.getByText('Campaigns', { exact: true })).toBeVisible();
  await expect(page.getByText('Orders', { exact: true })).toHaveCount(0);
});

test('explore, filter, reset, columns, record', async ({ page }) => {
  await page.getByText('Orders', { exact: true }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('row')).toHaveCount(201);
  await panel.getByLabel('Filter id').click();
  await page.getByLabel('Operator').selectOption('lte');
  await page.getByLabel('Value').fill('3');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(panel.getByRole('row')).toHaveCount(4);
  await panel.getByRole('button', { name: 'Reset' }).click();
  await expect(panel.getByRole('row')).toHaveCount(201);
  await panel.getByRole('button', { name: /Columns/ }).click();
  await page.getByLabel(/amount/i).check();
  await expect(panel.getByRole('columnheader')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await panel.getByRole('row').nth(1).click();
  await expect(page.getByRole('tab').last()).toHaveText(/^Orders: 1/);
  await page.screenshot({ path: 'tmp/e2e-record.png' });
});
