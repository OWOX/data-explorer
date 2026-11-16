import { expect, test, type Page } from '@playwright/test';

const band = (page: Page, id: 'sources' | 'marts' | 'data' | 'row') => page.locator(`#band-${id}`);
const martCard = (page: Page, title: string) => band(page, 'marts').locator('article', { hasText: title }).first();

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });

async function ordersGrid(page: Page) {
  const data = band(page, 'data');
  await expect(data.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expect(data.getByRole('row')).toHaveCount(201);
  return data;
}

const unfoldSources = (page: Page) => page.getByRole('button', { name: 'Show Data Sources' }).click();

test('the first load selects Orders: its rows, its joined marts, the sources, badges and icons', async ({ page }) => {
  const data = await ordersGrid(page);
  await unfoldSources(page);
  await expect(martCard(page, 'Orders')).toHaveAttribute('aria-pressed', 'true');
  await expect(band(page, 'marts').getByText('Customers', { exact: true })).toBeVisible();
  await expect(band(page, 'sources').getByText('Shopify', { exact: true })).toBeVisible();
  await expect(data.getByText('200+ records')).toBeVisible();
  await expect(band(page, 'row').getByText('Select a row.')).toBeVisible();
  await expect(martCard(page, 'Orders').getByLabel(/^Passed/)).toBeVisible();
  await expect(martCard(page, 'Orders').getByLabel('Open in OWOX')).toBeVisible();
  // The count badge lands once the card is on screen.
  await expect(martCard(page, 'Orders').locator('.dm-badge').first()).toHaveText(/\d/);
});

test('a source click narrows the marts; clicking it again returns', async ({ page }) => {
  await ordersGrid(page);
  await unfoldSources(page);
  const shopify = band(page, 'sources').locator('article', { hasText: 'Shopify' });
  await shopify.click();
  await expect(band(page, 'marts').getByText('Sessions', { exact: true })).toHaveCount(0);
  await expect(band(page, 'data').getByText('Select a data mart.')).toBeVisible();
  await shopify.click();
  await expect(band(page, 'data').getByRole('heading', { name: 'Orders' })).toBeVisible();
});

test('search narrows the marts', async ({ page }) => {
  await ordersGrid(page);
  await page.getByLabel('Search data marts').fill('campaign');
  await expect(band(page, 'marts').getByText('Campaigns', { exact: true })).toBeVisible();
  await expect(band(page, 'marts').getByText('Orders', { exact: true })).toHaveCount(0);
});

test('the page header is the title, Undo and Redo, and Refresh at the right end; the filters are in the Data Marts band', async ({ page }) => {
  await ordersGrid(page);
  const header = page.locator('header.dm-page-header');
  await expect(header.getByRole('heading', { level: 1, name: 'Data Explorer' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await expect(header.getByRole('button', { name: 'Redo' })).toBeDisabled();
  const refresh = await header.getByRole('button', { name: 'Refresh model' }).boundingBox();
  expect(refresh!.x + refresh!.width).toBeGreaterThan(1440 - 3 * 16 - 8 - 80);
  await expect(band(page, 'marts').locator('.dm-band-tools label.dm-search')).toBeVisible();
  // Data Sources starts folded
  await expect(band(page, 'sources')).toHaveClass(/folded/);
});

test('context badges in the Data Marts title row filter by any selected context', async ({ page }) => {
  await ordersGrid(page);
  const badges = band(page, 'marts').getByRole('group', { name: 'Contexts' });
  await badges.getByRole('button', { name: 'Marketing' }).click();
  await expect(badges.getByRole('button', { name: 'Marketing' })).toHaveAttribute('aria-pressed', 'true');
  await expect(band(page, 'marts').getByText('Campaigns', { exact: true })).toBeVisible();
  await expect(band(page, 'marts').getByText('Customers', { exact: true })).toHaveCount(0);
  await badges.getByRole('button', { name: 'Catalog' }).click();
  await expect(band(page, 'marts').getByText('Products', { exact: true })).toBeVisible();
  await badges.getByRole('button', { name: 'Marketing' }).click();
  await badges.getByRole('button', { name: 'Catalog' }).click();
  await expect(band(page, 'marts').getByText('Customers', { exact: true })).toBeVisible();
});

test('a band hint tooltip draws above the cards below it', async ({ page }) => {
  await ordersGrid(page);
  await band(page, 'marts').locator('.dm-hint').first().hover();
  const tip = page.locator('.dm-hint-body').first();
  await expect(tip).toBeVisible();
  // The bubble ignores the pointer; let it be hit-tested so the check sees what is painted on top at its centre.
  await tip.evaluate((el) => { (el as HTMLElement).style.pointerEvents = 'auto'; });
  const box = (await tip.boundingBox())!;
  const top = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.dm-hint-body'), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(top).toBe(true);
});

test('filter, reset, columns, a row fills the Row band, Back returns', async ({ page }) => {
  const data = await ordersGrid(page);
  await data.getByLabel('Filter id').click();
  await page.getByLabel('Operator').selectOption('lte');
  await page.getByLabel('Value').fill('3');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(data.getByRole('row')).toHaveCount(4);
  await data.getByRole('button', { name: 'Reset' }).click();
  await expect(data.getByRole('row')).toHaveCount(201);
  await data.getByRole('button', { name: /Columns/ }).click();
  await page.getByLabel(/amount/i).check();
  await expect(data.getByRole('columnheader')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await data.getByRole('row').nth(1).click();
  const row = band(page, 'row');
  await expect(row.getByRole('heading', { name: /^Orders · 1$/ })).toBeVisible();
  await expect(row.getByText('status')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row.getByText('Select a row.')).toBeVisible();
});

test('a card click selects its mart and Back restores the previous one', async ({ page }) => {
  await ordersGrid(page);
  await martCard(page, 'Customers').click();
  await expect(band(page, 'data').getByRole('heading', { name: 'Customers' })).toBeVisible();
  await expect(martCard(page, 'Customers')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(band(page, 'data').getByRole('heading', { name: 'Orders' })).toBeVisible();
});

test('a related title moves the selection, and Back restores the mart and the record', async ({ page }) => {
  const data = await ordersGrid(page);
  const row = band(page, 'row');
  await data.getByRole('row').nth(1).click();
  await expect(row.getByRole('heading', { name: /^Orders · 1$/ })).toBeVisible();
  // A customer's name in the grid is a related title: it opens that customer.
  await data.getByRole('cell').filter({ hasText: /^[A-Z][a-z]+ [A-Z][a-z]+$/ }).first().getByRole('button').click();
  await expect(data.getByRole('heading', { name: 'Customers' })).toBeVisible();
  await expect(row.getByRole('heading', { name: /^Customers · \d+$/ })).toBeVisible();
  await expect(martCard(page, 'Customers')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(data.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expect(row.getByRole('heading', { name: /^Orders · 1$/ })).toBeVisible();
  await expect(martCard(page, 'Orders')).toHaveAttribute('aria-pressed', 'true');
});

test('Refresh keeps the cards, counts and quality icons on screen', async ({ page }) => {
  await ordersGrid(page);
  const badge = martCard(page, 'Orders').locator('.dm-badge').first();
  await expect(badge).toHaveText(/\d/);
  await page.getByRole('button', { name: 'Refresh model' }).click();
  await expect(martCard(page, 'Orders').getByLabel(/^Passed/)).toBeVisible();
  await expect(martCard(page, 'Orders').getByLabel('Counting records')).toHaveCount(0);
  await expect(badge).toHaveText(/\d/);
  await expect(band(page, 'data').getByRole('row')).toHaveCount(201);
});

test('the storage filter drops the marts of an unticked storage and leaves the selection alone', async ({ page }) => {
  await ordersGrid(page);
  await expect(band(page, 'marts').getByText('Payments', { exact: true })).toBeVisible();
  const menu = band(page, 'marts').locator('details.dm-filter', { hasText: 'Storage' });
  await menu.locator('summary').click();
  await menu.getByRole('checkbox', { name: /Sales Lake/ }).uncheck();
  await expect(band(page, 'marts').getByText('Payments', { exact: true })).toHaveCount(0);
  await expect(band(page, 'marts').getByText('Customers', { exact: true })).toBeVisible();
  await expect(martCard(page, 'Orders')).toHaveAttribute('aria-pressed', 'true');
  await expect(band(page, 'data').getByRole('heading', { name: 'Orders' })).toBeVisible();
});

test('rows open newest date first, and Reset returns to it', async ({ page }) => {
  const data = await ordersGrid(page);
  await data.getByRole('button', { name: /^Sort by status,/ }).click();
  await expect(data.getByRole('columnheader', { name: /status/ })).toHaveAttribute('aria-sort', 'ascending');
  await data.getByRole('button', { name: 'Reset' }).click();
  await expect(data.getByRole('columnheader', { name: /status/ })).toHaveAttribute('aria-sort', 'none');
  await data.getByRole('button', { name: /Columns/ }).click();
  await page.getByLabel(/created_at/).check();
  await page.keyboard.press('Escape');
  await expect(data.getByRole('columnheader', { name: /created_at/ })).toHaveAttribute('aria-sort', 'descending');
});

test('a date column filter opens on presets; a preset applies at once and names the filter', async ({ page }) => {
  const data = await ordersGrid(page);
  await data.getByRole('button', { name: /Columns/ }).click();
  await page.getByLabel(/created_at/).check();
  await page.keyboard.press('Escape');
  await data.getByLabel('Filter created_at').click();
  await expect(page.getByRole('group', { name: 'Date presets' }).getByRole('button')).toHaveCount(14);
  await page.getByRole('button', { name: 'Last 30 days' }).click();
  await expect(page.getByRole('group', { name: 'Date presets' })).toHaveCount(0);
  await expect(data.getByLabel('Filter created_at')).toContainText('Last 30 days');
  await data.getByLabel('Filter created_at').click();
  await expect(page.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true');
});

test('Undo and Redo step through the selection', async ({ page }) => {
  await ordersGrid(page);
  await martCard(page, 'Customers').click();
  await expect(band(page, 'data').getByRole('heading', { name: 'Customers' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(band(page, 'data').getByRole('heading', { name: 'Orders' })).toBeVisible();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(band(page, 'data').getByRole('heading', { name: 'Customers' })).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(band(page, 'data').getByRole('heading', { name: 'Orders' })).toBeVisible();
});

test('sort a column descending, then add a second sort', async ({ page }) => {
  const data = await ordersGrid(page);
  const firstCell = () => data.getByRole('row').nth(1).getByRole('cell').first();
  await expect(firstCell()).toHaveText('1');
  await data.getByRole('button', { name: /^Sort by id,/ }).click();
  await data.getByRole('button', { name: /^Sort by id,/ }).click();
  await expect(data.getByRole('columnheader').first()).toHaveAttribute('aria-sort', 'descending');
  await expect(firstCell()).toHaveText('450');
  await data.getByRole('button', { name: /^Sort by status,/ }).click();
  await expect(data.getByRole('columnheader', { name: /status/ })).toHaveAttribute('aria-sort', 'ascending');
  await expect(data.getByRole('columnheader', { name: /status/ }).locator('.dm-sort-mark')).toHaveText('2');
  await data.getByRole('button', { name: 'Reset' }).click();
  await expect(firstCell()).toHaveText('1');
});

test('Export to Google Sheets: with one destination one click creates the report, runs it and opens the sheet', async ({ page }) => {
  await page.goto('/?mock&sheets=1');
  const data = await ordersGrid(page);
  const popup = page.waitForEvent('popup');
  await data.getByRole('button', { name: 'Export to Google Sheets' }).click();
  await expect(data.getByRole('link', { name: /Open the sheet/ })).toHaveAttribute('href', /spreadsheets\/d\/mock-sheet-1\/edit#gid=0/, { timeout: 10_000 });
  expect((await popup).url()).toContain('mock-sheet-1');
  // The report is remembered, so the control is now a menu offering to update it.
  await data.getByText('Export', { exact: true }).click();
  // The first level lists the destination; its flyout holds the update.
  await data.getByRole('menuitem').first().hover();
  await expect(data.getByRole('menuitem', { name: /Update “Orders · Data Explorer · / })).toBeVisible();
});

test('Export to Google Sheets: with no Sheets destination there is no Export control', async ({ page }) => {
  await page.goto('/?mock&sheets=0');
  const data = await ordersGrid(page);
  await expect(data.getByLabel('Export to Google Sheets')).toHaveCount(0);
});
