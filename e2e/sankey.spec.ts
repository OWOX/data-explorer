import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });
const data = (page: Page) => page.locator('#band-data');

test('add a Sankey from Add chart, set 3 columns, see 3 column titles and filter by a node', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  // A third dimension: Customers joins its name; is_gift is Orders' boolean.
  await page.locator('#band-marts').getByText('Customers', { exact: true }).first().click();
  await expect(data(page).getByRole('button', { name: 'Fields of Customers' })).toBeVisible();
  for (const name of ['is_gift', /created_at/i]) {
    await data(page).getByRole('button', { name: 'Fields of Orders' }).click();
    await page.getByLabel(name).click();
    await page.keyboard.press('Escape');
  }
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  await expect(data(page).locator('section.dm-chart')).toHaveCount(2);

  await data(page).locator('[data-chart-list-slot]').getByRole('button', { name: 'Charts options' }).click();
  await page.getByRole('menuitem', { name: 'Add chart' }).click();
  await page.getByRole('menuitemradio', { name: 'Sankey' }).click();
  const sankey = data(page).locator('section[data-chart-kind="Sankey"]');
  await expect(sankey.locator('path[data-link]').first()).toBeVisible();
  await expect(sankey.locator('text.dm-chart-axis-title')).toHaveCount(2);

  await sankey.scrollIntoViewIfNeeded();
  await sankey.getByRole('button', { name: 'Sankey options' }).click();
  await page.getByRole('menuitem', { name: 'Columns' }).click();
  await page.getByRole('menuitemradio', { name: '3' }).click();
  await expect(sankey.locator('text.dm-chart-axis-title')).toHaveCount(3);
  await expect(sankey.locator('path[data-link]').first()).toBeVisible();
  await sankey.screenshot({ path: 'tmp/sankey-e2e.png' });

  // A node click filters the grid to that value: the Sankey is still drawn, narrowed to it.
  const before = await sankey.locator('rect[data-node]').count();
  await sankey.locator('rect[data-node][role="button"]').first().click();
  await expect.poll(() => sankey.locator('rect[data-node]').count()).toBeLessThan(before);
});
