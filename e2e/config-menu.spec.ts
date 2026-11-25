import { expect, test, type Locator, type Page } from '@playwright/test';
import { closeConfig, configButton, expectStillOpen, groupTitles, joinedRowsArrived, openConfig, openFields } from './config-menu';

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });
const data = (page: Page) => page.locator('#band-data');
const marts = (page: Page) => page.locator('#band-marts');

test('Table: the config menu lists the data marts, and a field of a joinable mart ticked there joins its column', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  // One button, in the slot next to the Table / Charts switch, and no other.
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
  // The tick leaves the menu and the panel open.
  await joinedRowsArrived(page);
  await expectStillOpen(page, customers);
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
  await joinedRowsArrived(page);
  await expectStillOpen(page, panel);
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
  // Charts builds the menu in another place: a field of a joinable mart ticked there joins it too.
  const fields = await openFields(page, 'Orders');
  await fields.getByRole('menuitem', { name: 'Customers', exact: true }).click();
  const joinable = page.getByRole('dialog', { name: 'Customers', exact: true });
  await joinable.getByLabel('email', { exact: true }).click();
  // Charts has no cells to wait for: only the joined mart's group shows at once, the charts redraw a few hundred ms later, so the wait below does not cover that.
  await expect(groupTitles(page).filter({ hasText: 'Customers' })).toHaveCount(1);
  await expectStillOpen(page, joinable);
  await closeConfig(page);
  await expect(groupTitles(page).filter({ hasText: 'Customers' })).toHaveCount(1);

  const total = await data(page).locator('section.dm-chart').count();
  await pie.hover();
  await pie.getByRole('button', { name: 'Pie options' }).click();
  const chartMenu = page.getByRole('menu', { name: 'Pie menu' });
  await expect(chartMenu.getByRole('menuitem')).toHaveText(['Metric', 'Dimension', 'Chart type', 'Resize', 'Duplicate', 'Copy to clipboard', 'Hide']);
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

test('the filter badge has no x, its list ends with Clear, and Clear removes both filters in one Undo step', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  const filter = async (column: string, value: string, operator?: string) => {
    const icon = data(page).getByLabel(`Column menu ${column}`, { exact: true });
    await icon.scrollIntoViewIfNeeded();
    await icon.locator('xpath=ancestor::th').hover();
    await icon.click();
    await page.getByRole('menuitem', { name: 'Filter', exact: true }).click();
    if (operator) await page.getByLabel('Operator').selectOption(operator);
    await page.getByLabel('Value').fill(value);
    await page.getByRole('button', { name: 'Apply' }).click();
  };
  await filter('status', 'paid', 'contains');
  await expect(data(page).getByRole('button', { name: /^1 filter in Orders/ })).toBeVisible();
  // Each count is waited for, never read from the rows still on screen: 110 rows after one filter, 5 after two, 202 after Clear.
  const rows = () => data(page).getByRole('row').count();
  await expect.poll(rows).toBe(110);
  await filter('Store', '1');
  const badge = data(page).getByRole('button', { name: /^2 filters in Orders/ });
  await expect(badge).toBeVisible();
  await expect(data(page).getByRole('button', { name: /^(Remove|Clear) .*filter/i })).toHaveCount(0);
  await expect.poll(rows).toBe(5);
  await badge.click();
  const list = page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: 'Clear' }) });
  await expect(list.getByRole('menuitem').last()).toHaveText('Clear');
  await list.getByRole('menuitem', { name: 'Clear' }).click();
  await expect(data(page).getByRole('button', { name: /filters? in Orders/ })).toHaveCount(0);
  await expect.poll(rows).toBe(202);
  await expect(configButton(page)).toBeVisible();
  // One Undo step brings both back.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(data(page).getByRole('button', { name: /^2 filters in Orders/ })).toBeVisible();
  await expect.poll(rows).toBe(5);
});

for (const view of ['Grid', 'Graph'] as const) {
  test(`${view} view: the first tick of a joinable data mart moves no row under the pointer`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await expect(data(page).getByRole('row')).toHaveCount(202);
    if (view === 'Graph') await marts(page).getByRole('radio', { name: 'Graph' }).click();
    const orders = await openFields(page, 'Orders');
    await orders.getByRole('menuitem', { name: 'Customers', exact: true }).click();
    const customers = page.getByRole('dialog', { name: 'Customers', exact: true });
    const email = customers.getByLabel('email', { exact: true });
    await expect(email).toBeVisible();
    const top = async (el: Locator) => (await el.boundingBox())!.y;
    const before = { option: await top(email), button: await top(configButton(page)), root: await top(page.getByRole('menu', { name: 'Configure data' })) };
    await email.click();
    await joinedRowsArrived(page);
    await expect(groupTitles(page)).toHaveText(['Orders', 'Customers']);
    // Where the second click would land: the option, the config button's menu and the panel's own rows stay put.
    expect({ option: await top(email), button: await top(configButton(page)), root: await top(page.getByRole('menu', { name: 'Configure data' })) }).toEqual(before);
    await expect(customers.getByRole('menuitem', { name: 'Remove from report' })).toHaveCount(0);
    await expect(customers.getByRole('option', { name: 'Unique Count' })).toHaveCount(0);
    if (view !== 'Graph') return;
    // In Graph view each joinable tick grows the band above the grid: the config button moves down with the page, the root menu keeps its place.
    await orders.getByRole('menuitem', { name: 'Stores', exact: true }).click();
    const stores = page.getByRole('dialog', { name: 'Stores', exact: true });
    const root = page.getByRole('menu', { name: 'Configure data' });
    const buttonBefore = await top(configButton(page));
    const rootBefore = await top(root);
    await stores.getByLabel('city', { exact: true }).click();
    await expect(groupTitles(page)).toHaveText(['Orders', 'Customers', 'Stores']);
    await expect.poll(() => top(configButton(page))).not.toBe(buttonBefore);
    // The menu is laid out again with the joined rows: a Stores city lands in the same frame as the move.
    await expect(data(page).getByRole('cell').filter({ hasText: 'Denver' }).first()).toBeAttached();
    expect(await top(root)).toBe(rootBefore);
  });
}

test('Graph view: a panel opened from the root menu keeps its row through a window resize', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1500 });
  // Tall enough that the panel is never pushed up by the bottom edge: the offset to its row is then the same at both widths.
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await marts(page).getByRole('radio', { name: 'Graph' }).click();
  const orders = await openFields(page, 'Orders');
  await orders.getByRole('menuitem', { name: 'Customers', exact: true }).click();
  await page.getByRole('dialog', { name: 'Customers', exact: true }).getByLabel('email', { exact: true }).click();
  await orders.getByRole('menuitem', { name: 'Stores', exact: true }).click();
  await page.getByRole('dialog', { name: 'Stores', exact: true }).getByLabel('city', { exact: true }).click();
  await expect(groupTitles(page)).toHaveText(['Orders', 'Customers', 'Stores']);
  await expect(data(page).getByRole('cell').filter({ hasText: 'Denver' }).first()).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Stores', exact: true })).toHaveCount(0);
  await expect(orders).toBeVisible();
  const row = page.getByRole('menu', { name: 'Configure data' }).getByRole('menuitem', { name: 'Orders', exact: true });
  const offset = async () => (await orders.boundingBox())!.y - (await row.boundingBox())!.y;
  const before = await offset();
  await page.setViewportSize({ width: 1000, height: 1500 });
  // The row moves with the page's new layout; the panel follows it, not the place it measured first.
  await expect.poll(async () => Math.abs((await offset()) - before)).toBeLessThanOrEqual(1);
  await expect(orders).toBeVisible();
});
