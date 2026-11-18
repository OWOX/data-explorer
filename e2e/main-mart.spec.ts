import { expect, test, type Page } from '@playwright/test';

const band = (page: Page, id: 'marts' | 'data') => page.locator(`#band-${id}`);
const martCard = (page: Page, title: string) => band(page, 'marts').locator('article', { hasText: title }).first();

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });

test('dragging Customers onto Orders makes Customers the main data mart, first in the band and in the grid', async ({ page }) => {
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Orders');
  await martCard(page, 'Customers').dragTo(martCard(page, 'Orders'));
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Customers');
  await expect(band(page, 'marts').locator('article').first()).toContainText('Customers');
});

test('Copy SQL is enabled once the grid has loaded', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await expect(band(page, 'data').getByRole('row')).toHaveCount(202);
  await band(page, 'data').getByText('Export').click();
  await expect(page.getByRole('menuitem', { name: 'Copy SQL' })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'Copy SQL' }).click();
  await expect(page.getByText('SQL copied.', { exact: false })).toBeVisible();
});
