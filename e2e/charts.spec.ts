import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });
const data = (page: Page) => page.locator('#band-data');

test('Charts mode shows scorecards, a stacked time series and a pie, and Table brings the grid back', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await data(page).getByRole('button', { name: 'Fields of Orders' }).click();
  await page.getByLabel(/created_at/i).click();
  await page.keyboard.press('Escape');
  const widths = () => data(page).locator('th[data-group]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  const tableWidths = await widths();
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  await expect(data(page).getByText('Count Unique', { exact: true }).first()).toBeVisible();
  const group = data(page).locator('td[data-chart-group]').first();
  await expect(group).toBeVisible();
  const head = data(page).locator(`th[data-group="${await group.getAttribute('data-chart-group')}"]`);
  await expect(data(page).getByRole('columnheader', { name: /status/i }).first()).toBeVisible();
  const [gx, hx] = [(await group.boundingBox())!.x, (await head.boundingBox())!.x];
  expect(Math.abs(gx - hx)).toBeLessThanOrEqual(1);
  const series = data(page).locator('svg[data-orientation]');
  await expect(series).toHaveAttribute('data-orientation', 'vertical');
  // The scorecards must not make a group wider than the same group in Table.
  (await widths()).forEach((w, i) => expect(w).toBeLessThanOrEqual(tableWidths[i]!));
  await page.screenshot({ path: 'tmp/charts-e2e.png' });
  await page.screenshot({ path: 'tmp/charts-e2e-full.png', fullPage: true });

  await data(page).getByRole('button', { name: 'Time series options' }).click();
  await page.getByRole('menuitem', { name: 'Stack by' }).click();
  await page.getByRole('menuitemradio', { name: 'status' }).click();
  await expect(data(page).locator('.dm-chart-legend').first()).toBeVisible();

  await data(page).getByRole('button', { name: 'Time series options' }).click();
  await page.getByRole('menuitem', { name: 'Orientation' }).click();
  await page.getByRole('menuitemradio', { name: 'Horizontal' }).click();
  await expect(series).toHaveAttribute('data-orientation', 'horizontal');
  await page.screenshot({ path: 'tmp/charts-e2e-horizontal.png' });

  await data(page).getByRole('radio', { name: 'Table' }).click();
  await expect(data(page).getByRole('row')).toHaveCount(202);
});

test('a one-column group shows its scorecard value in full', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  // The picker may close after each change: open it again for every column that goes.
  for (const name of ['status', 'Customer', 'Product', 'Store']) {
    await data(page).getByRole('button', { name: 'Fields of Orders' }).click();
    await page.getByLabel(name, { exact: true }).click();
    await page.keyboard.press('Escape');
  }
  await expect(data(page).getByRole('columnheader', { name: /^Sort by/ })).toHaveCount(1); // only id is left
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  const value = data(page).locator('[data-card-value]').first();
  await expect(value).toHaveText('450');
  // A number must never be clipped: a cut value reads as another number.
  expect(await value.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.screenshot({ path: 'tmp/charts-e2e-narrow.png' });
});

test('the time series and the pie sit side by side when the band is wide, and Charts keep the table area', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  const frame = data(page).locator('.dm-grid-frame');
  const tableHeight = (await frame.boundingBox())!.height;
  // Amount is a default column now: only created_at is ticked.
  for (const name of [/created_at/i]) {
    await data(page).getByRole('button', { name: 'Fields of Orders' }).click();
    await page.getByLabel(name).click();
    await page.keyboard.press('Escape');
  }
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  const panels = data(page).locator('section.dm-chart');
  await expect(panels).toHaveCount(2);
  await expect(data(page).locator('svg[data-orientation]')).toBeVisible();
  const [a, b] = [(await panels.nth(0).boundingBox())!, (await panels.nth(1).boundingBox())!];
  // One row of two at 1440px: same top, the pie to the right of the time series, a clear gap between them.
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(16);
  // The pie takes only the width it needs: at most 26rem (416px).
  expect(b.width).toBeLessThanOrEqual(417);
  // The panels' left edge is the scorecards' left edge, and the panels end inside the band.
  const card = (await data(page).locator('[data-card]').first().boundingBox())!;
  expect(Math.abs(a.x - card.x)).toBeLessThanOrEqual(1);
  const frameBox = (await frame.boundingBox())!;
  expect(b.x + b.width).toBeLessThanOrEqual(frameBox.x + frameBox.width);
  expect(Math.round((await frame.boundingBox())!.height)).toBe(Math.round(tableHeight));
  // A long sum shows short; hovering it shows the exact value.
  const amount = data(page).locator('[data-card="amount"] [data-card-value]');
  const exact = (await amount.getAttribute('data-exact'))!;
  await expect(amount).toHaveText(/^[\d.,]+\s?[KMB]$/);
  await amount.hover();
  await expect(page.getByRole('tooltip').filter({ hasText: exact })).toBeVisible();
  await page.screenshot({ path: 'tmp/charts-e2e-side.png' });
  await page.setViewportSize({ width: 640, height: 900 });
  // The panels take the scroller's width once its resize is observed: wait for them to stack.
  await expect.poll(async () => { const [c, d] = [(await panels.nth(0).boundingBox())!, (await panels.nth(1).boundingBox())!]; return d.y >= c.y + c.height - 1; }).toBe(true);
});

test('a chart’s ⋮ shows on hover, in Sheets grey, and stays while its menu is open; the header ⋮ is always there', async ({ page }) => {
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  const panel = data(page).locator('section[data-chart-kind="Pie"]');
  const dots = panel.getByRole('button', { name: 'Pie options' });
  const header = data(page).getByRole('button', { name: 'Charts options' });
  await expect(panel).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(dots).toHaveCSS('opacity', '0');
  await expect(header).toHaveCSS('opacity', '1');
  await panel.hover();
  await expect(dots).toHaveCSS('opacity', '1');
  await expect(dots).toHaveCSS('color', 'rgb(95, 99, 104)');
  await dots.click();
  await page.mouse.move(0, 0);
  await expect(dots).toHaveCSS('opacity', '1');
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);
  await dots.blur();
  await expect(dots).toHaveCSS('opacity', '0');
  await dots.focus();
  await expect(dots).toHaveCSS('opacity', '1');
});

test('a chart that changes type animates its width instead of snapping', async ({ page }) => {
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  const panel = data(page).locator('section[data-chart-kind="Pie"]');
  await expect(panel).toHaveCSS('transition-property', /width/);
  await expect(panel.locator('.dm-chart-body')).toHaveCSS('transition-property', /height/);
});

test.describe('grouped submenus', () => {
  test.use({ deviceScaleFactor: 2 });
  test('a Dimension submenu lists its fields under each data mart, and the arrow keys skip the mart headers', async ({ page }) => {
    await expect(data(page).getByRole('row')).toHaveCount(202);
    await page.locator('#band-marts').getByText('Customers', { exact: true }).first().click();
    await expect(data(page).getByRole('button', { name: 'Fields of Customers' })).toBeVisible();
    await data(page).getByRole('radio', { name: 'Charts' }).click();
    const pie = data(page).locator('section[data-chart-kind="Pie"]');
    await pie.hover();
    await pie.getByRole('button', { name: 'Pie options' }).click();
    // Every row of the chart menu leads with an icon.
    const menu = page.getByRole('menu', { name: 'Pie menu' });
    await expect(menu).toBeVisible();
    const rows = menu.getByRole('menuitem');
    expect(await rows.count()).toBeGreaterThan(2);
    for (const row of await rows.all()) await expect(row.locator('.dm-menu-glyph svg')).toHaveCount(1);
    await page.getByRole('menuitem', { name: 'Dimension' }).click();
    const sub = page.getByRole('menu', { name: 'Dimension' });
    const orders = sub.getByRole('group', { name: 'Orders' });
    const customers = sub.getByRole('group', { name: 'Customers' });
    await expect(orders.locator('.dm-menu-head')).toHaveText('Orders');
    await expect(customers.locator('.dm-menu-head')).toHaveText('Customers');
    await expect(customers.getByRole('menuitemradio', { name: 'name' })).toBeVisible();
    await expect(sub.getByRole('menuitemradio', { name: /·/ })).toHaveCount(0);
    // The headers are not menu items: ArrowDown walks the options only.
    const options = sub.getByRole('menuitemradio');
    const count = await options.count();
    await expect(options.first()).toBeFocused();
    for (let i = 1; i < count; i++) {
      await page.keyboard.press('ArrowDown');
      await expect(options.nth(i)).toBeFocused();
    }
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(0)).toBeFocused();
  });
});
