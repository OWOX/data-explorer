import { expect, test, type Page } from '@playwright/test';

const band = (page: Page, id: 'sources' | 'marts' | 'data' | 'row') => page.locator(`#band-${id}`);
const martCard = (page: Page, title: string) => band(page, 'marts').locator('article', { hasText: title }).first();

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });

async function ordersGrid(page: Page) {
  const data = band(page, 'data');
  await expect(data.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expect(data.getByRole('row')).toHaveCount(202);
  return data;
}

/** Orders joins Customers, so clicking it adds it to the grid; clicking Orders then promotes Customers to the main mart. */
async function makeMain(page: Page, title: string) {
  await martCard(page, title).click();
  await expect(band(page, 'data').getByRole('heading', { name: `Orders + ${title}` })).toBeVisible();
  await martCard(page, 'Orders').click();
  await expect(band(page, 'data').getByRole('heading', { name: title, exact: true })).toBeVisible();
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

test('the page header is the title with Undo and Redo and no Refresh; the filters are in the Data band', async ({ page }) => {
  await ordersGrid(page);
  const header = page.locator('header.dm-page-header');
  await expect(header.getByRole('heading', { level: 1, name: 'Data Explorer' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await expect(header.getByRole('button', { name: 'Redo' })).toBeDisabled();
  await expect(header.getByRole('button', { name: /Refresh/ })).toHaveCount(0);
  await expect(band(page, 'marts').locator('.dm-band-tools label.dm-search')).toBeVisible();
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
  await data.getByLabel('Filter id').click();
  await page.getByLabel('Operator').selectOption('lte');
  await page.getByLabel('Value').fill('3');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(data.getByRole('row')).toHaveCount(5);
  await data.getByRole('button', { name: 'Reset' }).click();
  await expect(data.getByRole('row')).toHaveCount(202);
  await data.getByRole('button', { name: 'Columns of Orders' }).click();
  await page.getByLabel(/amount/i).check();
  await expect(data.getByRole('columnheader')).toHaveCount(7);
  await page.keyboard.press('Escape');
  await data.getByRole('row').nth(2).click();
  const row = band(page, 'row');
  await expect(row.getByRole('heading', { name: /^Orders · 1$/ })).toBeVisible();
  await expect(row.getByText('status')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row.getByText('Select a row.')).toBeVisible();
});

test('a card click on a mart Orders cannot join selects it alone, and Back restores the previous one', async ({ page }) => {
  await ordersGrid(page);
  await martCard(page, 'Order Items').click();
  await expect(band(page, 'data').getByRole('heading', { name: 'Order Items' })).toBeVisible();
  await expect(martCard(page, 'Order Items')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(band(page, 'data').getByRole('heading', { name: 'Orders' })).toBeVisible();
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
  await expect(data.getByRole('heading', { name: /^Orders/ })).toBeVisible();
  await expect(row.getByText('Select a row.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(data.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible();
  await expect(row.getByRole('heading', { name: /^Customers · \d+$/ })).toBeVisible();
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
  await data.getByRole('button', { name: 'Columns of Orders' }).click();
  await page.getByLabel(/created_at/).check();
  await page.keyboard.press('Escape');
  await expect(data.getByRole('columnheader', { name: /created_at/ })).toHaveAttribute('aria-sort', 'descending');
});

test('a date column filter opens on presets; a preset applies at once and names the filter', async ({ page }) => {
  const data = await ordersGrid(page);
  await data.getByRole('button', { name: 'Columns of Orders' }).click();
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
  await martCard(page, 'Order Items').click();
  await expect(band(page, 'data').getByRole('heading', { name: 'Order Items' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(band(page, 'data').getByRole('heading', { name: 'Orders' })).toBeVisible();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(band(page, 'data').getByRole('heading', { name: 'Order Items' })).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(band(page, 'data').getByRole('heading', { name: 'Orders' })).toBeVisible();
});

test('sort a column descending, then add a second sort', async ({ page }) => {
  const data = await ordersGrid(page);
  const firstCell = () => data.getByRole('row').nth(2).getByRole('cell').first();
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

test('Export to Google Sheets: with one destination the menu lists it; New report creates the report, runs it and opens the sheet', async ({ page }) => {
  await page.goto('/?mock&sheets=1');
  const data = await ordersGrid(page);
  const popup = page.waitForEvent('popup');
  await data.getByText('Export', { exact: true }).click();
  await data.getByRole('menuitem', { name: /Team Sheets/ }).click();
  await data.getByRole('menuitem', { name: /New report/ }).click();
  await page.getByRole('dialog', { name: 'New report' }).getByRole('button', { name: 'Export' }).click();
  await expect(data.getByRole('link', { name: /Open the sheet/ })).toHaveAttribute('href', /spreadsheets\/d\/mock-sheet-1\/edit#gid=0/, { timeout: 10_000 });
  expect((await popup).url()).toContain('mock-sheet-1');
  // The report is remembered, so the destination's flyout offers to update it.
  await data.getByText('Export', { exact: true }).click();
  await data.getByRole('menuitem', { name: /Team Sheets/ }).hover();
  await expect(data.getByRole('menuitem', { name: /Update “Orders · Data Explorer · / })).toBeVisible();
});

test('Export: with no Sheets destination the menu is still there, with the AI group', async ({ page }) => {
  await page.goto('/?mock&sheets=0');
  const data = await ordersGrid(page);
  await data.getByText('Export', { exact: true }).click();
  await expect(data.getByRole('menuitem')).toHaveText(['Copy to clipboard', 'Claude', 'ChatGPT']);
});

test('Export to an AI: the prompt is copied, named in a status, and readable in a dialog', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const data = await ordersGrid(page);
  await data.getByText('Export', { exact: true }).click();
  await data.getByRole('menuitem', { name: 'Claude' }).click();
  await expect(data.getByText('Prompt copied. Paste it into Claude')).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Query the data mart "Orders" (id "orders").');
  await data.getByRole('button', { name: 'Show prompt' }).click();
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
  await expect(data.getByText(/^Copied (the first )?\d+ rows/)).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text.split('\n').length).toBeGreaterThan(2);
  expect(text.split('\n')[0]).toContain('\t');
});

test('selecting a joinable mart adds its first text column; deselecting removes it; reselecting restores the same field', async ({ page }) => {
  const data = await ordersGrid(page);
  const title = (t: string) => expect(data.getByRole('heading', { name: t, exact: true })).toBeVisible();
  await martCard(page, 'Customers').click();
  await title('Orders + Customers');
  await expect(data.getByRole('columnheader', { name: /Customers · name/ })).toBeVisible();
  await expect(martCard(page, 'Customers')).toHaveClass(/dm-joined/);
  // choose a second field, take the mart out, bring it back
  await tick(page, 'email', 'Customers');
  await expect(data.getByRole('columnheader', { name: /Customers · email/ })).toBeVisible();
  await martCard(page, 'Customers').click();
  await title('Orders');
  await expect(data.getByRole('columnheader', { name: /Customers ·/ })).toHaveCount(0);
  await martCard(page, 'Customers').click();
  await title('Orders + Customers');
  await expect(data.getByRole('columnheader', { name: /Customers · name/ })).toBeVisible();
  await expect(data.getByRole('columnheader', { name: /Customers · email/ })).toBeVisible();
});

test('deselecting the main mart promotes the next joined one; a mart the main one cannot join becomes the main one', async ({ page }) => {
  const data = await ordersGrid(page);
  await martCard(page, 'Customers').click();
  await expect(data.getByRole('heading', { name: 'Orders + Customers', exact: true })).toBeVisible();
  await martCard(page, 'Orders').click();
  await expect(data.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible();
  await expect(martCard(page, 'Customers')).toHaveAttribute('aria-pressed', 'true');
  // Customers cannot join Sessions, so it becomes the main mart, alone
  await martCard(page, 'Sessions').click();
  await expect(data.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
});

async function tick(page: Page, label: string | RegExp, group?: string) {
  await band(page, 'data').getByRole('button', { name: `Columns of ${group ?? 'Orders'}` }).click();
  await page.getByRole('dialog').getByLabel(label, { exact: true }).check();
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
  const filler = data.locator('thead th[aria-hidden]');
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

test('a filter popover is at most 20rem tall and keeps its title while the list scrolls', async ({ page }) => {
  const data = await ordersGrid(page);
  await tick(page, 'created_at');
  await data.getByLabel('Filter created_at').click();
  const body = page.locator('[data-popover-body]');
  await expect(body).toBeVisible();
  const box = await page.locator('[data-popover-body]').evaluate((el) => (el.parentElement as HTMLElement).getBoundingClientRect().height);
  expect(box).toBeLessThanOrEqual(20 * 16 + 1);
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const title = await body.locator('.dm-popover-title').boundingBox();
  const top = await body.boundingBox();
  expect(Math.abs(title!.y - top!.y)).toBeLessThanOrEqual(2);
});

test('a joined column: tick Customers · email in the picker, and it filters', async ({ page }) => {
  const data = await ordersGrid(page);
  await tick(page, 'email', 'Customers');
  await expect(data.getByRole('columnheader', { name: /Customers · email/ })).toBeVisible();
  await expect(data.getByRole('row').nth(3)).toContainText('@example.com');
  await data.getByLabel('Filter Customers · email').click();
  await page.getByLabel('Value').fill('anna');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(data.getByRole('row').nth(3)).toContainText('anna');
});

test('the first load draws every band header before the bodies, with a bar that fills and then goes', async ({ page }) => {
  const bars = page.getByRole('progressbar', { name: 'Reading the project' });
  await expect(bars.first()).toBeVisible();
  for (const name of ['Data Sources', 'Data', 'Rows', 'Row']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(band(page, 'data').getByRole('row')).toHaveCount(0);
  await expect(bars).toHaveCount(0, { timeout: 15_000 });
  await expect(band(page, 'data').getByRole('row')).toHaveCount(202);
});

test('a table wider than the page scrolls inside its card and never widens the bands', async ({ page }) => {
  const data = await ordersGrid(page);
  for (const label of ['created_at', 'Acquisition Session ID', 'Net Revenue', 'Amount']) await tick(page, label);
  await tick(page, 'email', 'Customers');
  await tick(page, 'Name', 'Products');
  await tick(page, 'is_gift');
  await tick(page, 'city', 'Stores');
  await expect(data.getByRole('columnheader', { name: /Products · Name/ })).toBeVisible();
  const scroller = data.locator('.dm-bigcard div.overflow-auto').first();
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const [bm, bd] = [await band(page, 'marts').boundingBox(), await data.boundingBox()];
  expect(bm!.width).toBeCloseTo(bd!.width, 0);
  expect(bd!.x + bd!.width).toBeLessThanOrEqual(1440);
});

test('a group row names each selected mart; the x on a joined group removes it and deselects its card', async ({ page }) => {
  const data = await ordersGrid(page);
  // one tab spanning the columns, no x while it is the only mart
  await expect(data.locator('thead tr[data-group-row] th')).toHaveText(['Orders']);
  await expect(data.getByRole('button', { name: 'Remove Orders from the grid' })).toHaveCount(0);
  await martCard(page, 'Customers').click();
  const groups = data.locator('thead tr[data-group-row] th');
  await expect(groups).toHaveText(['Orders', 'Customers']);
  const x = data.getByRole('button', { name: 'Remove Customers from the grid' });
  await expect(x).toHaveCSS('opacity', '0');
  await groups.nth(1).hover();
  await expect(x).toHaveCSS('opacity', '1');
  await x.click();
  await expect(data.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible();
  await expect(data.locator('thead tr[data-group-row] th')).toHaveText(['Orders']);
  await expect(martCard(page, 'Customers')).not.toHaveClass(/dm-joined/);
});

test('the Columns picker is on each tab and lists only that mart; the toolbar has none', async ({ page }) => {
  const data = await ordersGrid(page);
  await expect(data.getByRole('button', { name: /^Columns \(/ })).toHaveCount(0);
  await martCard(page, 'Customers').click();
  await data.getByRole('button', { name: 'Columns of Customers' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('checkbox')).toHaveCount(5);
  await expect(dialog.getByLabel('email', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('status', { exact: true })).toHaveCount(0);
});

test('selecting a mart adds a text field and a metric; the filter mark carries no text', async ({ page }) => {
  const data = await ordersGrid(page);
  await martCard(page, 'Products').click();
  await expect(data.locator('thead tr[data-group-row] th')).toHaveText(['Orders', 'Products']);
  await expect(data.locator('thead tr[data-group-row] th').nth(1)).toHaveAttribute('colspan', '2');
  await data.getByLabel('Filter id').click();
  await page.getByLabel('Value').fill('3');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(data.getByLabel('Filter id')).toHaveText('');
  await expect(data.getByLabel('Filter id')).toHaveClass(/text-primary/);
});

test('the Data band shows the marts connected to a joined mart', async ({ page }) => {
  await ordersGrid(page);
  await expect(band(page, 'marts').getByText('Countries', { exact: true })).toHaveCount(0);
  await martCard(page, 'Customers').click();
  await expect(band(page, 'marts').getByText('Countries', { exact: true })).toBeVisible();
});
