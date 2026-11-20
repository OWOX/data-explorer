import { expect, test, type Locator, type Page } from '@playwright/test';

const band = (page: Page, id: 'sources' | 'marts' | 'data' | 'row') => page.locator(`#band-${id}`);
const martCard = (page: Page, title: string) => band(page, 'marts').locator('article', { hasText: title }).first();

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });

async function ordersGrid(page: Page) {
  const data = band(page, 'data');
  await expect(data.locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Orders');
  await expect(data.getByRole('row')).toHaveCount(202);
  return data;
}

/** The menu icon shows while its header cell is hovered: hover the cell, then click the icon. */
async function clickMenuIcon(icon: Locator) {
  await icon.scrollIntoViewIfNeeded();
  await icon.locator('xpath=ancestor::th').hover();
  await icon.click();
}

/** Opens a column's menu and its first-level row (Filter, Aggregate, Format, Sort). */
async function openColumnSub(data: Locator, title: string, row: 'Filter' | 'Aggregate' | 'Format' | 'Sort') {
  const icon = data.getByLabel(`Column menu ${title}`);
  // A scroll closes an open menu, and a narrow grid scrolls to reveal the icon: retry until the row holds still.
  await expect(async () => {
    await clickMenuIcon(icon);
    await data.page().getByRole('menuitem', { name: row, exact: true }).click({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
}

/** Adds the mart to the grid with a click, then promotes it with its make-main button (a click on a card never promotes it). */
async function makeMain(page: Page, title: string) {
  await martCard(page, title).click();
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]')).toHaveText(['Orders', title]);
  await martCard(page, title).getByRole('button', { name: 'Make main data mart' }).click();
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]')).toHaveText([title]);
}

/** A mart the main one cannot join is not in the band: hover the card it relates to, and use the make-main button on its ghost. */
async function makeMainViaGhost(page: Page, from: string, title: string) {
  await martCard(page, from).hover();
  const ghost = band(page, 'marts').locator('article', { hasText: title }).first();
  await ghost.hover();
  await ghost.getByRole('button', { name: 'Make main data mart' }).click();
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
  await martCard(page, 'Orders').hover();
  await expect(martCard(page, 'Orders').getByLabel('Open in OWOX', { exact: true })).toBeVisible();
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
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Orders');
});

test('three Fibery connectors are one source card; selecting it shows all their marts', async ({ page }) => {
  await ordersGrid(page);
  await unfoldSources(page);
  const fibery = band(page, 'sources').locator('article', { hasText: 'Fibery' });
  await expect(fibery).toHaveCount(1);
  await expect(fibery).toContainText('3 data marts');
  await fibery.click();
  for (const title of ['Fibery Tasks', 'Fibery Projects', 'Fibery People']) await expect(band(page, 'marts').getByText(title, { exact: true })).toBeVisible();
  await expect(band(page, 'marts').getByText('Orders', { exact: true })).toHaveCount(0);
});

const heading = (page: Page) => band(page, 'data').locator('thead tr[data-group-row] th[data-group]');
const search = async (page: Page, q: string) => {
  const header = page.locator('header.dm-page-header');
  const box = header.getByRole('combobox', { name: 'Search data marts' });
  if (!(await box.isVisible())) await header.getByRole('button', { name: /^Search data marts/ }).click();
  await box.fill(q);
  await box.press('Enter');
};

test('search finds the marts through OWOX search and makes the best one the main mart', async ({ page }) => {
  await ordersGrid(page);
  await page.locator('header.dm-page-header').getByRole('button', { name: 'Search data marts' }).click();
  await expect(page.locator('header.dm-page-header').getByRole('combobox', { name: 'Search data marts' })).toBeFocused();
  await search(page, 'campaign');
  await expect(heading(page)).toHaveText(['Campaigns']);
  await expect(band(page, 'marts').getByText('Campaigns', { exact: true })).toBeVisible();
  // The marts that do not match go, and the query stays on screen.
  await expect(band(page, 'marts').getByText('Customers', { exact: true })).toHaveCount(0);
  await expect(page.locator('header.dm-page-header').getByRole('combobox', { name: 'Search data marts' })).toHaveValue('campaign');
  // Escape closes the box and keeps the result; the x clears it and restores the band.
  await page.keyboard.press('Escape');
  await expect(page.locator('header.dm-page-header').getByRole('button', { name: 'Search data marts: campaign' })).toBeVisible();
  await expect(heading(page)).toHaveText(['Campaigns']);
  await page.locator('header.dm-page-header').getByRole('button', { name: 'Clear search' }).click();
  await expect(page.locator('header.dm-page-header').getByRole('button', { name: 'Search data marts', exact: true })).toBeVisible();
  await expect(heading(page)).toHaveText(['Campaigns']);
});

test('search dropdown: reports first, then marts, then the ad-hoc row', async ({ page }) => {
  await ordersGrid(page);
  await page.locator('header.dm-page-header').getByRole('button', { name: 'Search data marts' }).click();
  const box = page.locator('header.dm-page-header').getByRole('combobox', { name: 'Search data marts' });
  await box.fill('paid orders');
  const options = page.getByRole('listbox').getByRole('option');
  await expect(options.first()).toContainText('Paid orders by month');
  await expect(options.last()).toContainText('Ad-hoc report for');
  await expect(box).toHaveAttribute('aria-expanded', 'true');
});

test('picking a report from the dropdown opens its mart with the report\'s filter', async ({ page }) => {
  await ordersGrid(page);
  await search(page, 'who are our buyers');
  await expect(heading(page)).toHaveText(['Customers']);
  const header = page.locator('header.dm-page-header');
  const box = header.getByRole('combobox', { name: 'Search data marts' });
  await box.fill('paid orders');
  await page.getByRole('option').filter({ hasText: 'Paid orders by month' }).first().click();
  await expect(heading(page)).toHaveText(['Orders']);
  await expect(band(page, 'data').getByLabel('Filter status')).toHaveClass(/dm-ctl-on/);
  await expect(band(page, 'data').getByRole('cell', { name: 'new', exact: true })).toHaveCount(0);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(box).toHaveValue('paid orders');
});

test('smart search with AI: finds a mart by meaning, applies the filters it asks for, and Undo takes the whole result back', async ({ page }) => {
  await ordersGrid(page);
  await search(page, 'who are our buyers');
  await expect(heading(page)).toHaveText(['Customers']);
  await expect(band(page, 'data').getByRole('cell', { name: /@example\.com$/ }).first()).toBeVisible();
  await search(page, 'paid orders last month');
  await expect(heading(page)).toHaveText(['Orders']);
  await expect(band(page, 'data').getByLabel('Filter status')).toHaveClass(/dm-ctl-on/);
  await expect(band(page, 'data').getByLabel('Filter created_at')).toHaveClass(/dm-ctl-on/);
  await expect(band(page, 'data').getByRole('cell', { name: 'paid', exact: true }).first()).toBeVisible();
  await expect(band(page, 'data').getByRole('cell', { name: 'new', exact: true })).toHaveCount(0);
  await expect(band(page, 'marts').getByRole('note', { name: 'AI search hint' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(heading(page)).toHaveText(['Customers']);
});

test('smart search with no AI configured: no error, the hint shows once and stays dismissed, nothing found says so', async ({ page }) => {
  await page.goto('/?mock&ai=0');
  await ordersGrid(page);
  await search(page, 'products');
  await expect(heading(page)).toHaveText(['Products']);
  const hint = page.locator('header.dm-page-header').getByRole('note', { name: 'AI search hint' });
  await expect(hint).toHaveText(/Connect AI in this plugin's settings/);
  await hint.getByRole('button', { name: 'Dismiss the AI hint' }).click();
  await expect(hint).toHaveCount(0);
  await search(page, 'who are our buyers');
  await expect(band(page, 'marts').getByText('No data marts match.')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(hint).toHaveCount(0);
});

test('the page header is the title with Undo and Redo and no Refresh; the filters are in the Data band', async ({ page }) => {
  await ordersGrid(page);
  const header = page.locator('header.dm-page-header');
  await expect(header.getByRole('heading', { level: 1, name: 'Data Explorer' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await expect(header.getByRole('button', { name: 'Redo' })).toBeDisabled();
  await expect(header.getByRole('button', { name: /Refresh/ })).toHaveCount(0);
  await expect(header.getByRole('button', { name: 'Search data marts' })).toBeVisible();
  await expect(band(page, 'marts').locator('button.dm-search-btn')).toHaveCount(0);
  // Data Sources starts folded
  await expect(band(page, 'sources')).toHaveClass(/folded/);
});

test('context badges in the Data title row filter by any selected context', async ({ page }) => {
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
  await openColumnSub(data, 'id', 'Filter');
  await page.getByLabel('Operator').selectOption('lte');
  await page.getByLabel('Value').fill('3');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(data.getByRole('row')).toHaveCount(5);
  await data.getByRole('button', { name: 'Reset' }).click();
  await expect(data.getByRole('row')).toHaveCount(202);
  await data.getByRole('button', { name: 'Fields of Orders' }).click();
  await page.getByLabel(/amount/i).click();
  await expect(data.getByRole('columnheader')).toHaveCount(7);
  await page.keyboard.press('Escape');
  await data.getByRole('row').nth(2).click();
  const row = band(page, 'row');
  await expect(row.getByRole('heading', { name: /^Orders · 1$/ })).toBeVisible();
  await expect(row.getByText('status')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row.getByText('Select a row.')).toBeVisible();
});

test('a click on a mart Orders cannot join explains instead of switching; its make-main button selects it, and Back restores the previous one', async ({ page }) => {
  await ordersGrid(page);
  await martCard(page, 'Orders').hover();
  const ghost = band(page, 'marts').locator('article', { hasText: 'Order Items' }).first();
  await ghost.click();
  await expect(ghost.getByRole('status')).toContainText("Can't join Orders. Use Make main data mart to make it the main data mart.");
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Orders');
  await makeMainViaGhost(page, 'Orders', 'Order Items');
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Order Items');
  await expect(martCard(page, 'Order Items')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Orders');
});

test('a reference column shows the stored value as plain text; Referenced by opens the referencing mart, and Undo restores the record', async ({ page }) => {
  await ordersGrid(page);
  const row = band(page, 'row');
  await makeMain(page, 'Customers');
  const data = band(page, 'data');
  await expect(data.getByRole('row')).toHaveCount(62);
  await data.getByRole('row').nth(2).click();
  await expect(row.getByRole('heading', { name: /^Customers · \d+$/ })).toBeVisible();
  // nothing in the record is a link, and nothing says "via"
  await expect(row.locator('dd button')).toHaveCount(0);
  await row.getByRole('region', { name: 'Referenced by' }).getByRole('button', { name: /^Orders/ }).click();
  await expect(data.locator('thead tr[data-group-row] th[data-group]')).toHaveText(['Orders', 'Customers']);
  await expect(row.getByText('Select a row.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(data.locator('thead tr[data-group-row] th[data-group]')).toHaveText(['Customers']);
  await expect(row.getByRole('heading', { name: /^Customers · \d+$/ })).toBeVisible();
});

test('the storage filter drops the marts of an unticked storage and leaves the selection alone', async ({ page }) => {
  await ordersGrid(page);
  await makeMainViaGhost(page, 'Orders', 'Payments');
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Payments');
  await expect(band(page, 'marts').getByText('Customers', { exact: true })).toBeVisible();
  const menu = band(page, 'marts').locator('details.dm-filter', { hasText: 'Storage' });
  await menu.locator('summary').click();
  await menu.getByRole('option', { name: /Demo Warehouse/ }).click();
  await expect(band(page, 'marts').getByText('Customers', { exact: true })).toHaveCount(0);
  await expect(martCard(page, 'Payments')).toHaveAttribute('aria-pressed', 'true');
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Payments');
});

test('rows open newest date first, and Reset returns to it', async ({ page }) => {
  const data = await ordersGrid(page);
  await data.getByRole('button', { name: /^Sort by status,/ }).click();
  await expect(data.getByRole('columnheader', { name: /status/ })).toHaveAttribute('aria-sort', 'ascending');
  await data.getByRole('button', { name: 'Reset' }).click();
  await expect(data.getByRole('columnheader', { name: /status/ })).toHaveAttribute('aria-sort', 'none');
  await data.getByRole('button', { name: 'Fields of Orders' }).click();
  await page.getByLabel(/created_at/).click();
  await page.keyboard.press('Escape');
  await expect(data.getByRole('columnheader', { name: /created_at/ })).toHaveAttribute('aria-sort', 'descending');
});

test('a date column filter opens on presets; a preset applies at once and names the filter', async ({ page }) => {
  const data = await ordersGrid(page);
  await data.getByRole('button', { name: 'Fields of Orders' }).click();
  await page.getByLabel(/created_at/).click();
  await page.keyboard.press('Escape');
  await openColumnSub(data, 'created_at', 'Filter');
  await expect(page.getByRole('menu', { name: 'Filter created_at', exact: true }).locator('[role^="menuitem"]')).toHaveCount(9);
  await page.getByRole('menuitemradio', { name: 'Last…' }).click();
  await page.getByRole('menuitemradio', { name: 'Last 30 days' }).click();
  await expect(page.getByRole('menu', { name: 'Filter created_at', exact: true })).toHaveCount(0);
  await expect(data.getByLabel('Filter created_at')).toHaveText('');
  await data.getByLabel('Filter created_at').hover();
  await expect(page.getByRole('tooltip').first()).toContainText('Filter: Last 30 days');
  await data.getByLabel('Filter created_at').click();
  await page.getByRole('menuitemradio', { name: 'Last…' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Last 30 days' })).toHaveAttribute('aria-checked', 'true');
});

test('Undo and Redo step through the selection', async ({ page }) => {
  await ordersGrid(page);
  await makeMainViaGhost(page, 'Orders', 'Order Items');
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Order Items');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Orders');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Order Items');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Orders');
});

test('sort a column descending, then add a second sort', async ({ page }) => {
  const data = await ordersGrid(page);
  const firstCell = () => data.getByRole('row').nth(2).getByRole('cell').first();
  await expect(firstCell()).toHaveText('1');
  await data.getByRole('button', { name: /^Sort by id,/ }).click();
  await data.getByRole('button', { name: /^Sort by id,/ }).click();
  await expect(data.locator('th[aria-sort]').first()).toHaveAttribute('aria-sort', 'descending');
  await expect(firstCell()).toHaveText('450');
  await data.getByRole('button', { name: /^Sort by status,/ }).click();
  await expect(data.getByRole('columnheader', { name: /status/ })).toHaveAttribute('aria-sort', 'ascending');
  await expect(data.getByRole('columnheader', { name: /status/ }).locator('[data-sort-mark]')).toHaveText('2');
  await data.getByRole('button', { name: 'Reset' }).click();
  await expect(firstCell()).toHaveText('1');
});

test('Export to Google Sheets: the destination opens the dialog; Export creates the report, runs it and opens the sheet, and the next dialog offers it for update', async ({ page }) => {
  await page.goto('/?mock&sheets=1');
  const data = await ordersGrid(page);
  const popup = page.waitForEvent('popup');
  await data.getByText('Export', { exact: true }).click();
  await data.getByRole('menuitem', { name: /Team Sheets/ }).click();
  await page.getByRole('dialog', { name: 'Export to Team Sheets' }).getByRole('button', { name: 'Export' }).click();
  await expect(page.locator('#dm-toast-stack').getByRole('link', { name: /Open the sheet/ })).toHaveAttribute('href', /spreadsheets\/d\/mock-sheet-1\/edit#gid=0/, { timeout: 10_000 });
  await expect(data.getByRole('link', { name: /Open the sheet/ })).toHaveCount(0);
  expect((await popup).url()).toContain('mock-sheet-1');
  // The report is remembered and was just used, so the next dialog starts on updating it.
  await data.getByText('Export', { exact: true }).click();
  await data.getByRole('menuitem', { name: /Team Sheets/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Export to Team Sheets' });
  await expect(dialog.getByRole('radio', { name: /Orders · Data Explorer · / })).toBeChecked();
  await expect(dialog.getByText('Recently used')).toBeVisible();
});

test('Export: with no Sheets destination the menu is still there, with the AI group', async ({ page }) => {
  await page.goto('/?mock&sheets=0');
  const data = await ordersGrid(page);
  await data.getByText('Export', { exact: true }).click();
  await expect(data.locator('[role="menuitem"]:not([data-link])')).toHaveText(['Claude', 'ChatGPT', 'Copy to clipboard', 'Copy SQL', 'Create Data Mart']);
  await expect(data.getByRole('menuitem', { name: 'Open OWOX in Claude' })).toBeVisible();
});

test('Export to an AI: the prompt is copied, named in a status, and readable in a dialog', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const data = await ordersGrid(page);
  await data.getByText('Export', { exact: true }).click();
  await data.getByRole('menuitem', { name: 'Claude', exact: true }).click();
  await expect(page.getByRole('status').getByText('Prompt copied. Paste it into Claude')).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Query the data mart "Orders" (id "orders").');
  await page.locator('#dm-toast-stack').getByRole('button', { name: 'Show prompt' }).click();
  const area = page.getByRole('dialog', { name: 'Prompt' }).getByRole('textbox');
  await expect(area).toHaveValue(/read-only/);
  await expect(area).toHaveAttribute('readonly', '');
  await page.getByRole('dialog', { name: 'Prompt' }).getByRole('button', { name: 'Close' }).click();
});

test('Copy to clipboard: the loaded rows are copied as TSV and the status says so', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const data = await ordersGrid(page);
  await data.getByText('Export', { exact: true }).click();
  await data.getByRole('menuitem', { name: 'Copy to clipboard' }).click();
  await expect(page.getByRole('status').getByText(/^Copied (the first )?\d+ rows/)).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text.split('\n').length).toBeGreaterThan(2);
  expect(text.split('\n')[0]).toContain('\t');
});

test('selecting a joinable mart adds its first text column; the × removes it; reselecting restores the same field', async ({ page }) => {
  const data = await ordersGrid(page);
  const title = (t: string) => expect(data.locator('thead tr[data-group-row] th[data-group]')).toHaveText(t.split(' + '));
  await martCard(page, 'Customers').click();
  await title('Orders + Customers');
  await expect(data.getByRole('columnheader', { name: /Customers · name/ })).toBeVisible();
  await expect(martCard(page, 'Customers')).toHaveAttribute('aria-pressed', 'true');
  // choose a second field, take the mart out, bring it back
  await tick(page, 'email', 'Customers');
  await expect(data.getByRole('columnheader', { name: /Customers · email/ })).toBeVisible();
  await martCard(page, 'Customers').getByRole('button', { name: 'Remove Customers from the report' }).click();
  await title('Orders');
  await expect(data.getByRole('columnheader', { name: /Customers ·/ })).toHaveCount(0);
  await martCard(page, 'Customers').click();
  await title('Orders + Customers');
  await expect(data.getByRole('columnheader', { name: /Customers · name/ })).toBeVisible();
  await expect(data.getByRole('columnheader', { name: /Customers · email/ })).toBeVisible();
});

test('removing the main group promotes the next joined one; make main on a mart the main one cannot join makes it main and keeps the old main joined', async ({ page }) => {
  const data = await ordersGrid(page);
  await martCard(page, 'Customers').click();
  await expect(data.locator('thead tr[data-group-row] th[data-group]')).toHaveText(['Orders', 'Customers']);
  await data.getByRole('button', { name: 'Remove Orders from the grid' }).click();
  await expect(data.locator('thead tr[data-group-row] th[data-group]')).toHaveText(['Customers']);
  await expect(martCard(page, 'Customers')).toHaveAttribute('aria-pressed', 'true');
  // Customers cannot join Sessions, but Sessions can join Customers, so Customers stays as a joined mart
  await makeMainViaGhost(page, 'Customers', 'Sessions');
  await expect(data.locator('thead tr[data-group-row] th[data-group]')).toHaveText(['Sessions', 'Customers']);
});

/** Waits for a body cell under "Amount · Sum" with a number in it (the grouped rows have arrived) and returns its text. */
async function groupedSum(grid: Locator): Promise<string> {
  let text = '';
  await expect(async () => {
    const heads = await grid.locator('thead tr').last().locator('th:not([aria-hidden])').allTextContents();
    const at = heads.findIndex((h) => h.startsWith('Amount · Sum'));
    expect(at).toBeGreaterThanOrEqual(0);
    text = (await grid.locator('tbody tr').first().locator('td').nth(at).textContent()) ?? '';
    expect(text).toMatch(/\d/);
  }).toPass();
  return text;
}

async function tick(page: Page, label: string | RegExp, group?: string) {
  await band(page, 'data').getByRole('button', { name: `Fields of ${group ?? 'Orders'}` }).click();
  await page.getByRole('dialog').getByLabel(label, { exact: true }).click();
  await page.keyboard.press('Escape');
}

test('a long value is clipped inside its column, the header line spans the card, and the full value is in the tooltip', async ({ page }) => {
  const data = await ordersGrid(page);
  await tick(page, 'Acquisition Session ID');
  await tick(page, 'Net Revenue');
  const heads = data.getByRole('columnheader');
  await expect(heads.filter({ hasText: 'Acquisition Session ID' })).toBeVisible();
  const cell = data.getByRole('row').nth(2).locator('td').nth(5);
  await expect(cell).toContainText('ga4.'); // the new column is read, then shown
  const next = data.getByRole('row').nth(2).locator('td').nth(6);
  const [a, b] = [await cell.boundingBox(), await next.boundingBox()];
  expect(a!.width).toBeLessThanOrEqual(24 * 16 + 1);
  expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x + 1); // the text never runs under the next column
  const span = cell.locator('span').first();
  expect(await span.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await span.hover();
  await expect(page.getByRole('tooltip').first()).toContainText('ga4.');
  // the line under the header reaches the right edge of the card
  const filler = data.locator('thead tr:not([data-group-row]) th[aria-hidden]');
  const card = await data.locator('.dm-bigcard').boundingBox();
  const line = await filler.boundingBox();
  expect(line!.x + line!.width).toBeGreaterThanOrEqual(card!.x + card!.width - 3);
});

test('the (?) after a field label shows only while its row is hovered', async ({ page }) => {
  const data = await ordersGrid(page);
  await data.getByRole('row').nth(2).click();
  const row = band(page, 'row');
  await expect(row.getByRole('heading', { name: /^Orders · 1$/ })).toBeVisible();
  const hint = row.getByLabel('About Customer');
  const slot = hint.locator('xpath=ancestor::span[contains(@class,"dm-hint-slot")]');
  await page.mouse.move(2, 2);
  await expect(slot).toHaveCSS('opacity', '0');
  await row.getByText('Customer', { exact: true }).hover();
  await expect(slot).toHaveCSS('opacity', '1');
  // 4px after the label, and level with it
  const label = await row.getByText('Customer', { exact: true }).boundingBox();
  const glyph = await hint.boundingBox();
  expect(glyph!.x - (label!.x + label!.width)).toBeGreaterThanOrEqual(3);
  expect(glyph!.x - (label!.x + label!.width)).toBeLessThanOrEqual(6);
  expect(Math.abs((glyph!.y + glyph!.height / 2) - (label!.y + label!.height / 2))).toBeLessThanOrEqual(2);
});

test('opening the Fields picker by mouse leaves every (?) hidden until a row is hovered', async ({ page }) => {
  const data = await ordersGrid(page);
  await data.getByRole('button', { name: 'Fields of Orders' }).click();
  const dialog = page.getByRole('dialog');
  await page.mouse.move(2, 2);
  const slots = dialog.locator('.dm-hint-slot');
  await expect(slots).not.toHaveCount(0);
  for (const slot of await slots.all()) await expect(slot).toHaveCSS('opacity', '0');
  await dialog.getByText('Customer', { exact: true }).hover();
  await expect(dialog.locator('.dm-checklist-row', { hasText: 'Customer' }).locator('.dm-hint-slot')).toHaveCSS('opacity', '1');
});

test('a filter popover is at most 20rem tall, has no title row, and its last row is inside it', async ({ page }) => {
  const data = await ordersGrid(page);
  await tick(page, 'created_at');
  await openColumnSub(data, 'created_at', 'Filter');
  const body = page.locator('[data-popover-body]');
  await expect(body).toBeVisible();
  await expect(body.locator('.dm-popover-title')).toHaveCount(0);
  const panel = page.getByRole('dialog', { name: 'Filter of created_at' });
  const box = await panel.evaluate((el) => el.getBoundingClientRect().height);
  expect(box).toBeLessThanOrEqual(20 * 16 + 1);
  // The date list is short now (the presets moved to flyouts), so it fits; its last row is still inside the panel.
  const last = body.getByRole('menuitemradio', { name: 'Is not blank' });
  await last.scrollIntoViewIfNeeded();
  const p = (await panel.boundingBox())!;
  const l = (await last.boundingBox())!;
  expect(l.y).toBeGreaterThanOrEqual(p.y - 1);
  expect(l.y + l.height).toBeLessThanOrEqual(p.y + p.height + 1);
});

/** Every control of an open panel lies inside the panel and the viewport, so none is cropped. */
async function expectFits(page: Page, name: string) {
  const panel = page.getByRole('dialog', { name });
  await expect(panel).toBeVisible();
  const view = page.viewportSize()!;
  const p = (await panel.boundingBox())!;
  expect(p.x).toBeGreaterThanOrEqual(0);
  expect(p.x + p.width).toBeLessThanOrEqual(view.width);
  const scroller = panel.locator('[data-popover-body]');
  expect(await scroller.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const c of await panel.locator('button, input, select').all()) {
    const b = await c.boundingBox();
    if (!b) continue;
    expect(b.x).toBeGreaterThanOrEqual(p.x - 0.5);
    expect(b.x + b.width).toBeLessThanOrEqual(p.x + p.width + 0.5);
    expect(b.x + b.width).toBeLessThanOrEqual(view.width);
  }
}

for (const width of [320, 360]) {
  test(`at ${width}px wide the Filter and Aggregate panels keep every button inside the panel and the viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    const data = await ordersGrid(page);
    await tick(page, 'created_at');
    // Filter: presets (with the "Last N days" Apply), the operator form, and Aggregate with its date buckets
    await openColumnSub(data, 'Store', 'Filter');
    await expectFits(page, 'Filter of Store');
    await page.getByRole('dialog', { name: 'Filter of Store' }).getByLabel('Value').fill('1');
    await expectFits(page, 'Filter of Store');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await openColumnSub(data, 'created_at', 'Filter');
    await expectFits(page, 'Filter of created_at');
    await page.getByRole('menuitemradio', { name: 'Last…' }).click();
    const lastPanel = page.getByRole('menu', { name: 'Last…' });
    await expect(lastPanel).toBeVisible();
    const lb = (await lastPanel.boundingBox())!;
    expect(lb.x).toBeGreaterThanOrEqual(0);
    expect(lb.x + lb.width).toBeLessThanOrEqual(width);
    await expect(lastPanel.getByRole('button', { name: 'Apply' })).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(lastPanel).toHaveCount(0);
    await page.getByRole('dialog', { name: 'Filter of created_at' }).getByRole('menuitem', { name: 'Custom range…' }).click();
    await expectFits(page, 'Filter of created_at');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await openColumnSub(data, 'Store', 'Aggregate');
    await expectFits(page, 'Aggregation of Store');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await openColumnSub(data, 'created_at', 'Aggregate');
    await expectFits(page, 'Aggregation of created_at');
    await page.getByRole('dialog', { name: 'Aggregation of created_at' }).getByLabel('Group by bucket').selectOption({ index: 1 });
    await expectFits(page, 'Aggregation of created_at');
  });
}

test('a joined column: tick Customers · email in the picker, and it filters', async ({ page }) => {
  const data = await ordersGrid(page);
  await martCard(page, 'Customers').click();
  await expect(data.getByRole('button', { name: 'Fields of Customers' })).toBeVisible();
  await tick(page, 'email', 'Customers');
  await expect(data.getByRole('columnheader', { name: /Customers · email/ })).toBeVisible();
  await expect(data.getByRole('row').nth(3)).toContainText('@example.com');
  await openColumnSub(data, 'Customers · email', 'Filter');
  await page.getByLabel('Value').fill('anna');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(data.getByRole('row').nth(3)).toContainText('anna');
});

test('the first load draws every band header before the bodies, with a bar that fills and then goes', async ({ page }) => {
  const bars = page.getByRole('progressbar', { name: 'Reading the project' });
  await expect(bars.first()).toBeVisible();
  for (const name of ['Data Sources', 'Data Marts', 'Data', 'Row']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(band(page, 'data').getByRole('row')).toHaveCount(0);
  await expect(bars).toHaveCount(0, { timeout: 15_000 });
  await expect(band(page, 'data').getByRole('row')).toHaveCount(202);
});

test('a table wider than the page scrolls inside its card and never widens the bands', async ({ page }) => {
  const data = await ordersGrid(page);
  for (const label of ['created_at', 'Acquisition Session ID', 'Net Revenue', 'Amount']) await tick(page, label);
  await martCard(page, 'Customers').click();
  await martCard(page, 'Products').click();
  await expect(data.getByRole('button', { name: 'Fields of Products' })).toBeVisible();
  await tick(page, 'email', 'Customers');
  await tick(page, 'is_gift');
  await martCard(page, 'Stores').click();
  await expect(data.getByRole('columnheader', { name: /Products · SKU/ })).toBeVisible();
  const scroller = data.locator('.dm-bigcard div.overflow-auto').first();
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const [bm, bd] = [await band(page, 'marts').boundingBox(), await data.boundingBox()];
  expect(bm!.width).toBeCloseTo(bd!.width, 0);
  expect(bd!.x + bd!.width).toBeLessThanOrEqual(1440);
});

test('a group row names each selected mart; the x on a joined group removes it and deselects its card', async ({ page }) => {
  const data = await ordersGrid(page);
  // one tab spanning the columns, no x while it is the only mart
  await expect(data.locator('thead tr[data-group-row] th[data-group]')).toHaveText(['Orders']);
  await expect(data.getByRole('button', { name: 'Remove Orders from the grid' })).toHaveCount(0);
  await martCard(page, 'Customers').click();
  const groups = data.locator('thead tr[data-group-row] th[data-group]');
  await expect(groups).toHaveText(['Orders', 'Customers']);
  const x = data.getByRole('button', { name: 'Remove Customers from the grid' });
  await expect(x).toHaveCSS('opacity', '0');
  await groups.nth(1).hover();
  await expect(x).toHaveCSS('opacity', '1');
  await x.click();
  await expect(data.locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Orders');
  await expect(data.locator('thead tr[data-group-row] th[data-group]')).toHaveText(['Orders']);
  await expect(martCard(page, 'Customers')).not.toHaveAttribute('aria-pressed', 'true');
});

test('the Fields picker is on each tab and lists only that mart; the toolbar has none', async ({ page }) => {
  const data = await ordersGrid(page);
  await expect(data.getByRole('button', { name: /^Columns \(/ })).toHaveCount(0);
  await martCard(page, 'Customers').click();
  await data.getByRole('button', { name: 'Fields of Customers' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/^Fields · /)).toHaveCount(0);
  await expect(dialog.getByRole('option')).toHaveCount(5);
  await expect(dialog.getByLabel('email', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('status', { exact: true })).toHaveCount(0);
});

test('selecting a mart adds a text field and a metric; the filter mark carries no text', async ({ page }) => {
  const data = await ordersGrid(page);
  await martCard(page, 'Products').click();
  await expect(data.locator('thead tr[data-group-row] th[data-group]')).toHaveText(['Orders', 'Products']);
  await expect(data.locator('thead tr[data-group-row] th[data-group]').nth(1)).toHaveAttribute('colspan', '2');
  await openColumnSub(data, 'id', 'Filter');
  await page.getByLabel('Value').fill('3');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(data.getByLabel('Filter id')).toHaveText('');
  await expect(data.getByLabel('Filter id')).toHaveClass(/dm-ctl-on/);
});

test('the Data band lists the marts the main one joins at any depth', async ({ page }) => {
  await ordersGrid(page);
  // Countries is two joins away from Orders (through Customers or Stores).
  await expect(band(page, 'marts').getByText('Countries', { exact: true })).toBeVisible();
  await expect(band(page, 'marts').getByText('Sessions', { exact: true })).toHaveCount(0);
});

declare global { interface Window { __copiedLink?: string; __routeSet?: string } }

test('a copied view link reopens the same view: mart, joined column, filter and sort', async ({ page, context }) => {
  const data = await ordersGrid(page);
  // Two header rows (the mart tabs and the column titles), then the rows.
  await martCard(page, 'Customers').click();
  await expect(data.getByRole('button', { name: 'Fields of Customers' })).toBeVisible();
  await tick(page, 'email', 'Customers');
  await expect(data.getByRole('columnheader', { name: /Customers · email/ })).toBeVisible();
  await openColumnSub(data, 'id', 'Filter');
  await page.getByLabel('Operator').selectOption('lte');
  await page.getByLabel('Value').fill('3');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(data.getByRole('row')).toHaveCount(5);
  await data.getByRole('button', { name: /^Sort by status,/ }).click();
  await expect(data.getByRole('columnheader', { name: /status/ })).toHaveAttribute('aria-sort', 'ascending');

  await page.getByRole('button', { name: 'Copy link to this view' }).click();
  await expect.poll(() => page.evaluate(() => window.__copiedLink)).toMatch(/^\/v\?s=/);
  const link = (await page.evaluate(() => window.__copiedLink))!;
  expect(link.length).toBeLessThanOrEqual(2048);

  const opened = await context.newPage();
  await opened.goto(`/?mock&route=${encodeURIComponent(link)}`);
  const grid = band(opened, 'data');
  await expect(grid.locator('thead tr[data-group-row] th[data-group]')).toHaveText(['Orders', 'Customers']);
  await expect(grid.getByRole('row')).toHaveCount(5);
  await expect(grid.getByRole('columnheader', { name: /Customers · email/ })).toBeVisible();
  await expect(grid.getByRole('columnheader', { name: /status/ })).toHaveAttribute('aria-sort', 'ascending');
  await expect(martCard(opened, 'Orders')).toHaveAttribute('aria-pressed', 'true');
  await expect(opened.getByRole('status').filter({ hasText: /\S/ })).toHaveCount(0);

  // The address returns to the main page, so a reload doesn't reapply the link.
  await expect.poll(() => opened.evaluate(() => window.__routeSet)).toBe('/');
  await expect.poll(() => new URL(opened.url()).searchParams.has('route')).toBe(false);
  await opened.reload();
  // Wait for the default view to finish loading, then check the link was not reapplied.
  await expect(band(opened, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Orders');
  await expect(band(opened, 'data').getByRole('row').nth(1)).toBeVisible();
  await expect(band(opened, 'data').locator('thead tr[data-group-row] th[data-group]')).toHaveText(['Orders']);
  await expect(band(opened, 'data').getByRole('row')).not.toHaveCount(5);
  await expect(opened.getByRole('status').filter({ hasText: /\S/ })).toHaveCount(0);
  expect(new URL(opened.url()).searchParams.has('route')).toBe(false);
});

test('a copied view link keeps a Sum on Amount: the opener sees the grouped grid', async ({ page, context }) => {
  const data = await ordersGrid(page);
  await tick(page, 'Amount');
  await openColumnSub(data, 'Amount', 'Aggregate');
  await page.getByRole('dialog').getByLabel('Sum').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await expect(data.getByRole('columnheader', { name: /Amount · Sum/ })).toBeVisible();
  await page.getByRole('button', { name: 'Copy link to this view' }).click();
  await expect.poll(() => page.evaluate(() => window.__copiedLink)).toMatch(/^\/v\?s=/);
  const link = (await page.evaluate(() => window.__copiedLink))!;

  const opened = await context.newPage();
  await opened.goto(`/?mock&route=${encodeURIComponent(link)}`);
  const grid = band(opened, 'data');
  await expect(grid.getByRole('columnheader', { name: /Amount · Sum/ })).toBeVisible();
  await groupedSum(grid);
  await expect(grid.getByText(/\d+\+? groups?$/)).toBeVisible();
});

test('a link to a data mart the opener cannot see shows a notice and the page stays usable', async ({ page, context }) => {
  await ordersGrid(page);
  const payload = await page.evaluate(async () => {
    const json = JSON.stringify({ v: 1, P: [], src: null, m: 'no-such-mart', r: null, q: '', ctx: [], st: null, f: { sources: true, marts: false, data: false, row: false }, g: null });
    const stream = new Blob([new TextEncoder().encode(json)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  });
  const opened = await context.newPage();
  await opened.goto(`/?mock&route=${encodeURIComponent(`/v?s=${payload}`)}`);
  const notice = opened.getByRole('status').filter({ hasText: "Some parts of this link aren't available to you" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('the data mart');
  await expect(band(opened, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Orders');
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0);
  await makeMainViaGhost(opened, 'Orders', 'Order Items');
  await expect(band(opened, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Order Items');
});

test('a Sum on Amount groups the rows by the other columns; the badge counts groups and a group opens no record', async ({ page }) => {
  const data = await ordersGrid(page);
  await tick(page, 'Amount');
  await openColumnSub(data, 'Amount', 'Aggregate');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Sum').click();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(data.getByRole('columnheader', { name: /Amount · Sum/ })).toBeVisible();
  // a real grouped value: a sum of order amounts is a positive number
  expect(Number((await groupedSum(data)).replace(/[^\d.]/g, ''))).toBeGreaterThan(0);
  await expect(data.getByText(/\d+\+? groups?$/)).toBeVisible();
  await expect(data.getByText(/records$/)).toHaveCount(0);
  await data.getByRole('row').nth(2).click();
  await expect(band(page, 'row').getByText('Grouped rows have no single record.')).toBeVisible();
  // unticking everything and applying brings the rows back
  await data.getByRole('button', { name: 'Aggregate Amount' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Sum').click();
  await dlg.getByRole('button', { name: 'Apply' }).click();
  await expect(data.getByText(/200\+ records/)).toBeVisible();
});

test('folding a band does not move its header: the title sits at the same x/y folded and open', async ({ page }) => {
  await ordersGrid(page);
  for (const id of ['sources', 'marts', 'data', 'row'] as const) {
    const b = band(page, id);
    const title = b.locator('.dm-band-title');
    const fold = b.locator('.dm-band-fold');
    const state = async () => (await fold.getAttribute('aria-expanded')) === 'true';
    // Relative to the band: bands above it changing height moves the whole band, not its header.
    const box = async () => { const t = (await title.boundingBox())!; const o = (await b.boundingBox())!; return { x: t.x - o.x, y: t.y - o.y }; };
    const wasOpen = await state();
    const before = await box();
    await fold.click();
    await expect.poll(state).toBe(!wasOpen);
    await page.waitForTimeout(350);
    const after = await box();
    expect(Math.abs(after.x - before.x), `${id} x`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.y - before.y), `${id} y`).toBeLessThanOrEqual(0.5);
    await fold.click();
    await page.waitForTimeout(350);
  }
});

test('the grid looks like a sheet: square corners, small header icons, no hover highlight, a selectable cell', async ({ page }) => {
  const data = await ordersGrid(page);
  await expect(data.getByRole('cell', { name: '1', exact: true }).first()).toBeVisible();
  const radii = await data.evaluate((el) => {
    const card = el.querySelector('.dm-bigcard') ?? el.closest('.dm-bigcard') ?? el;
    const pick = [card, el.querySelector('.dm-grid-root'), el.querySelector('thead'), el.querySelector('table')].filter((e): e is Element => !!e);
    return pick.map((e) => getComputedStyle(e).borderRadius);
  });
  expect(radii.every((r) => r === '0px')).toBe(true);
  // the column menu icon and the Fields icon are 15px; the (i) and the active indicators stay 20% under the old 14px
  const size = (l: Locator) => l.evaluate((e) => Math.round(e.getBoundingClientRect().width * 10) / 10);
  expect(await size(data.locator('[data-menu-icon] .dm-icon').first())).toBe(15);
  expect(await size(data.getByRole('button', { name: 'Fields of Orders' }).locator('.dm-icon'))).toBe(15);
  expect(await size(data.locator('.dm-th .dm-col-info .dm-icon').first())).toBe(11.2);
  // no row highlight on hover
  const second = data.locator('tbody tr').nth(1).locator('td').first();
  const before = await second.evaluate((e) => getComputedStyle(e.parentElement!).backgroundColor);
  await second.hover();
  expect(await second.evaluate((e) => getComputedStyle(e.parentElement!).backgroundColor)).toBe(before);
  // the letters sit above the tabs, the numbers on the left
  await expect(data.locator('thead .dm-letter[data-chrome]').first()).toHaveText('A');
  await expect(data.locator('tbody th[data-chrome]').first()).toHaveText('1');
  // numbers sit on the right of their cells, text on the left
  await expect(data.locator('tbody tr').first().locator('td').nth(0)).toHaveCSS('text-align', 'right');
  await expect(data.locator('tbody tr').first().locator('td').nth(4)).toHaveCSS('text-align', 'start');
  // Sheets' letters and row numbers are smaller than the cells: 11px against 10pt
  await expect(data.locator('thead .dm-letter[data-chrome]').first()).toHaveCSS('font-size', '11px');
  await expect(data.locator('tbody th[data-chrome]').first()).toHaveCSS('font-size', '11px');
  // a click selects: a 2px blue frame, the letter and number lit
  await second.click();
  const cell = data.locator('td[data-selected]');
  await expect(cell).toHaveCSS('outline-width', '2px');
  await expect(cell).toHaveCSS('outline-color', 'rgb(26, 115, 232)');
  await expect(data.locator('thead .dm-letter[data-selected]')).toHaveText('A');
  await expect(data.locator('tbody th[data-selected]')).toHaveText('2');
  await expect(data.locator('thead .dm-letter[data-selected]')).toHaveCSS('background-color', 'rgb(211, 227, 253)');
  await page.keyboard.press('ArrowRight');
  await expect(data.locator('thead .dm-letter[data-selected]')).toHaveText('B');
  await page.keyboard.press('ArrowDown');
  await expect(data.locator('tbody th[data-selected]')).toHaveText('3');
  await page.keyboard.press('Escape');
  await expect(data.locator('td[data-selected]')).toHaveCount(0);
  // Sheets' look: the selected header is #d3e3fd with #041e49 bold text, and the cell has a fill handle
  await second.click();
  const lit = data.locator('thead .dm-letter[data-selected]');
  await expect(lit).toHaveCSS('background-color', 'rgb(211, 227, 253)');
  await expect(lit).toHaveCSS('color', 'rgb(4, 30, 73)');
  await expect(lit).toHaveCSS('font-weight', '700');
  await expect(data.locator('td[data-selected]')).toHaveCSS('outline-color', 'rgb(26, 115, 232)');
  const handle = await data.locator('td[data-selected]').evaluate((e) => { const c = getComputedStyle(e, '::after'); return [c.content, c.width, c.height, c.backgroundColor]; });
  expect(handle).toEqual(['""', '7px', '7px', 'rgb(26, 115, 232)']);
  // a click on a column letter selects the whole column: tinted cells, the letter in the strong blue
  await data.locator('thead .dm-letter[data-chrome]').nth(1).click();
  const colCells = data.locator('tbody td[data-range]');
  expect(await colCells.count()).toBe(await data.locator('tbody th[data-chrome]').count());
  await expect(colCells.first()).toHaveCSS('background-color', 'rgb(232, 240, 254)');
  await expect(data.locator('thead .dm-letter[data-selected="full"]')).toHaveCSS('background-color', 'rgb(11, 87, 208)');
  await expect(data.locator('thead .dm-letter[data-selected="full"]')).toHaveCSS('color', 'rgb(255, 255, 255)');
  // as in Sheets: a thin 1px frame around the column, the 2px frame on its first cell only, the fill handle at the bottom
  expect(await colCells.first().evaluate((e) => getComputedStyle(e, '::after').borderLeftWidth)).toBe('1px');
  await expect(data.locator('tbody td[data-active]')).toHaveCount(1);
  await expect(data.locator('tbody td[data-active]')).toHaveCSS('outline-width', '2px');
  await expect(data.locator('tbody tr').first().locator('td[data-active]')).toHaveCount(1);
  await expect(data.locator('tbody td[data-handle]')).toHaveCount(1);
  expect(await data.locator('tbody td[data-handle]').evaluate((e) => getComputedStyle(e, '::before').borderRadius)).toBe('50%');
  await page.keyboard.press('Escape');
  await expect(colCells).toHaveCount(0);
});

test('a numeric filter applied through the popover (> 400) leaves fewer rows', async ({ page }) => {
  const data = await ordersGrid(page);
  await data.getByRole('button', { name: 'Fields of Orders' }).click();
  await page.getByLabel(/Amount/).click();
  await page.keyboard.press('Escape');
  await expect(data.getByLabel('Column menu Amount')).toBeVisible();
  await openColumnSub(data, 'Amount', 'Filter');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Operator').selectOption('gt');
  await dialog.getByLabel('Value').fill('400');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(data.getByLabel('Filter Amount')).toHaveClass(/dm-ctl-on/);
  // Amount is the sixth column: every row left has an amount above 400 (waits for the cells, not a row count)
  await expect.poll(async () => {
    const texts = await data.locator('tbody tr td:nth-child(7)').allTextContents();
    return texts.length > 0 && texts.every((t) => parseFloat(t.replace(/[^\d.]/g, '')) > 400);
  }).toBe(true);
});

test('the opened search grows leftwards in the header: the title stays, the actions stay on screen', async ({ page }) => {
  await ordersGrid(page);
  const header = page.locator('header.dm-page-header');
  await header.getByRole('button', { name: 'Search data marts' }).click();
  const box = await header.getByRole('combobox', { name: 'Search data marts' }).boundingBox();
  const title = await header.getByRole('heading', { name: 'Data Explorer' }).boundingBox();
  const copy = await header.getByRole('button', { name: 'Copy link to this view' }).count();
  expect(title!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x).toBeGreaterThan(title!.x + title!.width);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
  expect(copy).toBeLessThanOrEqual(1);
});

test('shift-click on another cell makes a block of cells, with the first cell active', async ({ page }) => {
  const data = await ordersGrid(page);
  await data.locator('tbody tr').nth(1).locator('td').nth(1).click();
  await page.keyboard.down('Shift');
  await data.locator('tbody tr').nth(3).locator('td').nth(3).click();
  await page.keyboard.up('Shift');
  await expect(data.locator('tbody td[data-range]')).toHaveCount(9);
  await expect(data.locator('tbody td[data-active]')).toHaveCount(1);
  await expect(data.locator('tbody td[data-handle]')).toHaveCount(1);
});

test('a no-primary-key mart shows a warning next to the Data (i), not a block above the grid', async ({ page }) => {
  await ordersGrid(page);
  const header = page.locator('header.dm-page-header');
  await header.getByRole('button', { name: 'Search data marts' }).click();
  await header.getByRole('combobox', { name: 'Search data marts' }).fill('daily');
  await page.keyboard.press('Enter');
  await expect(band(page, 'data').getByRole('note', { name: /no primary key/ })).toBeVisible();
  await expect(band(page, 'data').getByText('Preview only', { exact: false })).toHaveCount(0);
});

test('the column menu and its Format submenu stay inside the window at the rightmost column; Money changes the cells', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 520 });
  const data = await ordersGrid(page);
  await tick(page, 'Amount');
  const menuIcon = data.getByLabel('Column menu Amount');
  await clickMenuIcon(menuIcon);
  const inside = async (name: string) => {
    const box = (await page.getByRole('menu', { name }).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(640);
    expect(box.y + box.height).toBeLessThanOrEqual(520);
  };
  await inside('Menu of Amount');
  await page.getByRole('menuitem', { name: 'Format', exact: true }).click();
  await inside('Format Amount');
  await expect(page.getByRole('menuitemradio', { name: 'Automatic' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: 'Money' }).click();
  await inside('Money Amount');
  await page.getByRole('menuitemradio', { name: 'USD' }).click();
  await expect(page.getByRole('menu', { name: 'Menu of Amount' })).toHaveCount(0);
  await expect(data.getByRole('row').nth(2).getByRole('cell', { name: /^(US)?\$[\d,]+\.\d\d$/ })).toHaveCount(1);
  await expect(menuIcon).toHaveClass(/dm-ctl-on/);
  // Escape closes the submenu first, then the menu
  await menuIcon.click();
  await page.getByRole('menuitem', { name: 'Sort', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Sort Amount' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Sort Amount' })).toHaveCount(0);
  await expect(page.getByRole('menu', { name: 'Menu of Amount' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Menu of Amount' })).toHaveCount(0);
});

test('full screen: the Data band alone fills the plugin area, its title stays, Escape leaves', async ({ page }) => {
  const data = await ordersGrid(page);
  const cell = data.locator('tbody td').nth(1);
  await cell.click();
  await data.getByRole('button', { name: 'Full screen' }).click();
  await expect(data.getByRole('button', { name: 'Exit full screen' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('header.dm-page-header')).toBeHidden();
  await expect(band(page, 'marts')).toBeHidden();
  await expect(band(page, 'sources')).toBeHidden();
  await expect(band(page, 'row')).toBeHidden();
  await expect(data.getByRole('heading', { name: 'Data' })).toBeVisible();
  await expect(data.locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Orders');
  // The band covers the viewport, and the grid scroller takes what the title row leaves.
  const view = page.viewportSize()!;
  const box = (await data.boundingBox())!;
  expect(box).toMatchObject({ x: 0, y: 0, width: view.width, height: view.height });
  const head = (await data.locator('.dm-band-head').boundingBox())!;
  const scroller = (await data.locator('.dm-grid-root').boundingBox())!;
  expect(scroller.height).toBeGreaterThan(view.height - head.height - 60);
  expect(scroller.height).toBeLessThanOrEqual(view.height - head.height);
  // The same grid: its selected cell is still selected.
  await expect(cell).toHaveAttribute('data-selected', '');
  // Popovers and dialogs sit above the band: what opens in full screen can be clicked.
  const onTop = (el: Locator) => el.evaluate((dlg) => {
    const r = dlg.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 20));
    return hit && dlg.contains(hit) ? 'ok' : `blocked by ${hit?.tagName}.${hit?.className}`;
  });
  await data.getByRole('button', { name: /^Fields of/ }).first().click();
  const fields = page.getByRole('dialog');
  await expect(fields).toBeVisible();
  expect(await onTop(fields)).toBe('ok');
  await page.keyboard.press('Escape');
  await expect(fields).toHaveCount(0);
  await data.getByText('Export', { exact: true }).click();
  const exportMenu = data.locator('details[open] [role=menu]').first();
  await expect(exportMenu).toBeVisible();
  expect(await onTop(exportMenu)).toBe('ok');
  await page.keyboard.press('Escape');
  await expect(data.getByRole('button', { name: 'Exit full screen' })).toBeVisible();
  // Escape closes an open column menu first, and only then full screen.
  await clickMenuIcon(data.getByLabel('Column menu status'));
  await expect(page.getByRole('menu', { name: 'Menu of status' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Menu of status' })).toHaveCount(0);
  await expect(data.getByRole('button', { name: 'Exit full screen' })).toBeVisible();
  await data.locator('.dm-band-head').click();
  await page.keyboard.press('Escape');
  await expect(data.getByRole('button', { name: 'Full screen' })).toBeVisible();
  await expect(page.locator('header.dm-page-header')).toBeVisible();
  await expect(band(page, 'marts')).toBeVisible();
  await expect(cell).toHaveAttribute('data-selected', '');
});

test('the column menu icon and the Fields icon are invisible at rest, show on header hover and on keyboard focus, and the menu icon stays on for a filtered column', async ({ page }) => {
  const data = await ordersGrid(page);
  const opacity = (l: Locator) => l.evaluate((el) => getComputedStyle(el).opacity);
  const menuIcon = data.getByLabel('Column menu id');
  const fields = data.getByLabel('Fields of Orders');
  await page.mouse.move(0, 0);
  await expect.poll(() => opacity(menuIcon)).toBe('0');
  await expect.poll(() => opacity(fields)).toBe('0');
  await menuIcon.locator('xpath=ancestor::th').hover();
  await expect.poll(() => opacity(menuIcon)).toBe('1');
  await fields.locator('xpath=ancestor::th').hover();
  await expect.poll(() => opacity(fields)).toBe('1');
  // Keyboard: move the pointer away, focus the control before each one with the mouse-free Tab.
  await page.mouse.move(0, 0);
  for (const icon of [menuIcon, fields]) {
    await expect.poll(() => opacity(icon)).toBe('0');
    await page.keyboard.press('Escape');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await icon.evaluate((el) => {
      const all = [...document.querySelectorAll<HTMLElement>('button, a, input, [tabindex]')].filter((n) => !n.hasAttribute('disabled'));
      all[Math.max(0, all.indexOf(el as HTMLElement) - 1)]?.focus();
    });
    for (let i = 0; i < 3 && !(await icon.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    expect(await icon.evaluate((el) => el === document.activeElement)).toBe(true);
    await expect.poll(() => opacity(icon)).toBe('1');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  }
  // An active filter keeps the menu icon on at rest.
  await openColumnSub(data, 'id', 'Filter');
  await page.getByLabel('Value').fill('3');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(data.getByLabel('Filter id')).toBeVisible();
  await page.mouse.move(0, 0);
  await expect.poll(() => opacity(data.getByLabel('Column menu id'))).toBe('1');
  await expect.poll(() => opacity(data.getByLabel('Filter id'))).toBe('1');
  await expect.poll(() => opacity(data.getByLabel('Column menu status'))).toBe('0');
});
