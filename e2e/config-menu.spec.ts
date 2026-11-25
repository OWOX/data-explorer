import { expect, test, type Page } from '@playwright/test';
import { closeConfig, configButton, groupTitles, openConfig, openFields } from './config-menu';

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });
const data = (page: Page) => page.locator('#band-data');
const marts = (page: Page) => page.locator('#band-marts');

test('Table: the config menu lists the data marts, and a field of a joinable mart ticked there joins its column', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  // One button, next to the Table / Charts switch, in the Data band only.
  await expect(page.locator('[data-config-button]')).toHaveCount(1);
  await expect(data(page).getByRole('button', { name: /^Fields of / })).toHaveCount(0);
  const menu = await openConfig(page);
  // Table lists no chart rows: the data marts only, the main one first.
  await expect(menu.getByRole('menuitem', { name: 'Add chart' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Charts', exact: true })).toHaveCount(0);
  await expect(menu.getByRole('menuitem').first()).toHaveAccessibleName('Orders');

  // Orders opens its fields, then Joinable Data Marts, then Remove from report; the joinable ones open the same panel.
  await menu.getByRole('menuitem', { name: 'Orders', exact: true }).click();
  const orders = page.getByRole('dialog', { name: 'Orders', exact: true });
  await expect(orders.getByRole('option').first()).toBeVisible();
  await expect(orders.getByText('Joinable Data Marts', { exact: true })).toBeVisible();
  await expect(orders.getByRole('menuitem', { name: 'Remove from report' })).toHaveCount(0);
  await orders.getByRole('menuitem', { name: 'Customers', exact: true }).click();
  const customers = page.getByRole('dialog', { name: 'Customers', exact: true });
  await expect(customers).toBeVisible();
  await customers.getByLabel('email', { exact: true }).click();
  await closeConfig(page);
  await expect(groupTitles(page)).toHaveText(['Orders', 'Customers']);
  await expect(data(page).getByRole('columnheader', { name: /Customers · email/ })).toBeVisible();

  // The mart is in the report now: it is listed with the shown ones and can be removed from there.
  const joined = await openFields(page, 'Customers');
  await joined.getByRole('menuitem', { name: 'Remove from report' }).click();
  await expect(groupTitles(page)).toHaveText(['Orders']);
});

test('a data mart on a path with no column is listed after the shown ones; ticking a field of it brings its column back', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await marts(page).getByRole('radio', { name: 'Graph' }).click();
  await marts(page).locator('article#dm-orders [data-join-plus]').hover();
  await marts(page).locator('article[data-ghost][data-mart-id="customers"]').click();
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);
  await marts(page).locator('[id="dm-customers@customers"] [data-join-plus]').hover();
  await marts(page).locator('article[data-ghost][data-mart-id="countries"]').click();
  await page.keyboard.press('Escape');
  await expect(groupTitles(page)).toHaveText(['Orders', 'Customers', 'Countries']);
  // Customers leaves the grid but stays on the path to Countries.
  const customers = await openFields(page, 'Customers');
  await customers.getByRole('menuitem', { name: 'Remove from report' }).click();
  await expect(groupTitles(page)).toHaveText(['Orders', 'Countries']);

  const menu = await openConfig(page);
  const names = await menu.getByRole('menuitem').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent?.trim() ?? ''));
  expect(names.findIndex((n) => n.startsWith('Countries'))).toBeLessThan(names.findIndex((n) => n.startsWith('Customers')));
  await expect(menu.getByRole('separator')).toHaveCount(1);
  await menu.getByRole('menuitem', { name: 'Customers', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Customers', exact: true });
  await expect(panel).toBeVisible();
  // It is not in the report, so there is nothing to remove.
  await expect(panel.getByRole('menuitem', { name: 'Remove from report' })).toHaveCount(0);
  await panel.getByLabel('email', { exact: true }).click();
  await closeConfig(page);
  // The columns of a data mart sit together, in the order the marts were added: Customers comes back last.
  await expect(groupTitles(page)).toHaveText(['Orders', 'Countries', 'Customers']);
});

test('Charts: the config menu opens with Add chart and Charts, a chart’s menu has Duplicate and Hide and no Remove, and Charts brings a hidden chart back', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  const pie = data(page).locator('section[data-chart-kind="Pie"]');
  await expect(pie).toBeVisible();
  const menu = await openConfig(page);
  const rows = await menu.getByRole('menuitem').evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''));
  expect(rows.slice(0, 3).map((r) => r.replace(/\s+/g, ' '))).toEqual(['Add chart', 'Charts', expect.stringContaining('Orders')]);
  await closeConfig(page);

  const total = await data(page).locator('section.dm-chart').count();
  await pie.hover();
  await pie.getByRole('button', { name: 'Pie options' }).click();
  const chartMenu = page.getByRole('menu', { name: 'Pie menu' });
  await expect(chartMenu.getByRole('menuitem')).toHaveText(['Metric', 'Dimension', 'Chart type', 'Duplicate', 'Copy to clipboard', 'Hide']);
  await expect(chartMenu.getByRole('menuitem', { name: 'Remove' })).toHaveCount(0);
  await chartMenu.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(data(page).locator('section[data-chart-kind="Pie"]')).toHaveCount(2);
  await expect(data(page).locator('section.dm-chart')).toHaveCount(total + 1);

  await data(page).locator('section[data-chart-kind="Pie"]').first().hover();
  await data(page).getByRole('button', { name: 'Pie options' }).first().click();
  await page.getByRole('menu', { name: 'Pie menu' }).getByRole('menuitem', { name: 'Hide' }).click();
  await expect(data(page).locator('section[data-chart-kind="Pie"]')).toHaveCount(1);

  // The hidden chart is ticked off in the config menu's Charts list; ticking it brings it back.
  const root = await openConfig(page);
  await root.getByRole('menuitem', { name: 'Charts', exact: true }).click();
  const list = page.getByRole('menu', { name: 'Charts' });
  const unticked = list.getByRole('menuitemcheckbox', { checked: false });
  await expect(unticked).toHaveCount(1);
  await unticked.click();
  await closeConfig(page);
  await expect(data(page).locator('section[data-chart-kind="Pie"]')).toHaveCount(2);
});

test('the filter badge has no x, its list ends with Clear, and Clear removes the filters in one Undo step', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  const icon = data(page).getByLabel('Column menu status', { exact: true });
  await icon.scrollIntoViewIfNeeded();
  await icon.locator('xpath=ancestor::th').hover();
  await icon.click();
  await page.getByRole('menuitem', { name: 'Filter', exact: true }).click();
  await page.getByLabel('Operator').selectOption('contains');
  await page.getByLabel('Value').fill('paid');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => data(page).getByRole('row').count()).toBeLessThan(202);
  const rows = await data(page).getByRole('row').count();
  const badge = data(page).getByRole('button', { name: /^1 filter in Orders/ });
  await expect(badge).toBeVisible();
  await expect(data(page).getByRole('button', { name: /^(Remove|Clear) .*filter/i })).toHaveCount(0);
  await badge.click();
  const list = page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: 'Clear' }) });
  await expect(list.getByRole('menuitem').last()).toHaveText('Clear');
  await list.getByRole('menuitem', { name: 'Clear' }).click();
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await expect(badge).toHaveCount(0);
  await expect(configButton(page)).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(data(page).getByRole('row')).toHaveCount(rows);
  await expect(badge).toBeVisible();
});
