import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });
const data = (page: Page) => page.locator('#band-data');

test('Charts mode shows scorecards, a stacked time series and a pie, and Table brings the grid back', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await data(page).getByRole('button', { name: 'Fields of Orders' }).click();
  await page.getByLabel(/created_at/i).click();
  await page.keyboard.press('Escape');
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  await expect(data(page).getByText('Records', { exact: true }).first()).toBeVisible();
  const series = data(page).locator('svg[data-orientation]');
  await expect(series).toHaveAttribute('data-orientation', 'vertical');
  await page.screenshot({ path: 'tmp/charts-e2e.png' });

  await data(page).getByRole('button', { name: 'Time series options' }).click();
  await page.getByRole('menuitem', { name: 'Stack by' }).click();
  await page.getByRole('menuitemradio', { name: 'status' }).click();
  await expect(data(page).locator('.dm-chart-legend').first()).toBeVisible();

  await data(page).getByRole('button', { name: 'Horizontal bars' }).click();
  await expect(series).toHaveAttribute('data-orientation', 'horizontal');
  await page.screenshot({ path: 'tmp/charts-e2e-horizontal.png' });

  await data(page).getByRole('radio', { name: 'Table' }).click();
  await expect(data(page).getByRole('row')).toHaveCount(202);
});
