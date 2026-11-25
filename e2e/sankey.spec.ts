import { expect, test, type Page } from '@playwright/test';
import { openFields, closeConfig, groupTitles, configButton } from './config-menu';

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });
const data = (page: Page) => page.locator('#band-data');

test('add a Sankey from Add chart, a many-to-one joined column draws, a fan-out column says why it cannot sum, filter by a node', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  // A third dimension: Customers joins its name; is_gift is Orders' boolean.
  await page.locator('#band-marts').getByText('Customers', { exact: true }).first().click();
  await expect(groupTitles(page).filter({ hasText: 'Customers' })).toHaveCount(1);
  for (const name of ['is_gift', /created_at/i]) {
    await openFields(page, 'Orders');
    await page.getByRole('option', { name }).click();
    await closeConfig(page);
  }
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  await expect(data(page).locator('section.dm-chart')).toHaveCount(2);

  await configButton(page).click();
  await page.getByRole('menuitem', { name: 'Add chart' }).click();
  await page.getByRole('menuitemradio', { name: 'Sankey' }).click();
  const sankey = data(page).locator('section[data-chart-kind="Sankey"]');
  await expect(sankey.locator('path[data-link]').first()).toBeVisible();
  await expect(sankey.locator('text.dm-chart-axis-title')).toHaveCount(2);

  await sankey.scrollIntoViewIfNeeded();
  await sankey.getByRole('button', { name: 'Sankey options' }).click();
  await page.getByRole('menuitem', { name: 'Columns' }).click();
  await page.getByRole('menuitem', { name: 'Column 3' }).click();
  await page.getByRole('menuitem', { name: 'Customers' }).click();
  await page.getByRole('menuitemradio', { name: 'Name' }).click();
  // The third column is Customers' name, a many-to-one lookup: Orders' metric still counts each order once, so it draws.
  await expect(sankey.locator('text.dm-chart-axis-title')).toHaveCount(3);
  await expect(sankey.locator('path[data-link]').first()).toBeVisible();
  await sankey.getByRole('button', { name: 'Sankey options' }).click();
  await page.getByRole('menuitem', { name: 'Columns' }).click();
  await page.getByRole('menuitem', { name: 'Column 3' }).click();
  await page.getByRole('menuitemradio', { name: 'None' }).click();
  await expect(sankey.locator('text.dm-chart-axis-title')).toHaveCount(2);
  await expect(sankey.locator('path[data-link]').first()).toBeVisible();
  await sankey.screenshot({ path: 'tmp/sankey-e2e.png' });

  // A node click filters the grid to that value: the Sankey is still drawn, narrowed to it.
  const before = await sankey.locator('rect[data-node]').count();
  await sankey.locator('rect[data-node][role="button"]').first().click();
  await expect.poll(() => sankey.locator('rect[data-node]').count()).toBeLessThan(before);
});

test('a column of a one-to-many joined mart says why it cannot sum', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  // Shipments hang several rows on one order: Orders' metric would count an order once per shipment.
  await page.locator('#band-marts').getByText('Shipments', { exact: true }).first().click();
  await expect(groupTitles(page).filter({ hasText: 'Shipments' })).toHaveCount(1);
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  await configButton(page).click();
  await page.getByRole('menuitem', { name: 'Add chart' }).click();
  await page.getByRole('menuitemradio', { name: 'Sankey' }).click();
  const sankey = data(page).locator('section[data-chart-kind="Sankey"]');
  await expect(sankey.getByText(/joined one-to-one/)).toBeVisible();
  await expect(sankey.locator('path[data-link]')).toHaveCount(0);
});

for (const height of [900, 700]) {
  test(`the four-level Columns menu stays inside a 1440x${height} viewport and every level is reachable by mouse`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height });
    await expect(data(page).getByRole('row')).toHaveCount(202);
    await page.locator('#band-marts').getByText('Customers', { exact: true }).first().click();
    await expect(groupTitles(page).filter({ hasText: 'Customers' })).toHaveCount(1);
    await openFields(page, 'Orders');
    await page.getByRole('option', { name: 'is_gift' }).click();
    await closeConfig(page);
    await data(page).getByRole('radio', { name: 'Charts' }).click();
    await configButton(page).click();
    await page.getByRole('menuitem', { name: 'Add chart' }).click();
    await page.getByRole('menuitemradio', { name: 'Sankey' }).click();
    const sankey = data(page).locator('section[data-chart-kind="Sankey"]');
    await expect(sankey.locator('path[data-link]').first()).toBeVisible();
    await sankey.scrollIntoViewIfNeeded();
    await sankey.getByRole('button', { name: 'Sankey options' }).click();
    // Each panel, the Sankey menu itself included, sits inside the viewport and shows all its rows (it does not scroll).
    const inside = async (name: string) => {
      const panel = page.getByRole('menu', { name });
      await expect(panel).toBeVisible();
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1440);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      expect(await panel.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    };
    await inside('Sankey menu');
    // Each level opens on a click.
    for (const name of ['Columns', 'Column 3', 'Customers']) {
      await page.getByRole('menuitem', { name }).click();
      await inside(name);
    }
    // The field is clicked by the mouse: it picks it and closes the menu.
    await page.getByRole('menu', { name: 'Customers' }).getByRole('menuitemradio', { name: 'Name' }).click();
    await expect(sankey.locator('text.dm-chart-axis-title')).toHaveCount(3);
  });
}

test('None on Column 2 of a two-column Sankey shows a notice instead of the drawing, and picking a column draws it again', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await page.locator('#band-marts').getByText('Customers', { exact: true }).first().click();
  await expect(groupTitles(page).filter({ hasText: 'Customers' })).toHaveCount(1);
  await openFields(page, 'Orders');
  await page.getByRole('option', { name: 'is_gift' }).click();
  await closeConfig(page);
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  await configButton(page).click();
  await page.getByRole('menuitem', { name: 'Add chart' }).click();
  await page.getByRole('menuitemradio', { name: 'Sankey' }).click();
  const sankey = data(page).locator('section[data-chart-kind="Sankey"]');
  await expect(sankey.locator('path[data-link]').first()).toBeVisible();
  const options = sankey.getByRole('button', { name: 'Sankey options' });
  await sankey.scrollIntoViewIfNeeded();
  await options.click();
  await page.getByRole('menuitem', { name: 'Columns' }).click();
  await page.getByRole('menuitem', { name: 'Column 2' }).click();
  await page.getByRole('menuitemradio', { name: 'None' }).click();
  await expect(sankey.getByText('This Sankey is misconfigured: pick at least 2 columns in its menu.')).toBeVisible();
  await expect(sankey.locator('path[data-link]')).toHaveCount(0);
  // The menu is still on the panel: Column 2 picks a dimension again and the chart draws.
  await options.click();
  await page.getByRole('menuitem', { name: 'Columns' }).click();
  await page.getByRole('menuitem', { name: 'Column 2' }).click();
  await page.getByRole('menuitem', { name: 'Customers' }).click();
  await page.getByRole('menu', { name: 'Customers' }).getByRole('menuitemradio', { name: 'Name' }).click();
  await expect(sankey.locator('path[data-link]').first()).toBeVisible();
  await expect(sankey.getByText(/misconfigured/)).toHaveCount(0);
});
