import { expect, type Locator, type Page } from '@playwright/test';

/** Waits until the rows of a joined Customers column have arrived in the grid: a cell holding an email. */
export const joinedRowsArrived = (page: Page) => expect(page.locator('#band-data').getByRole('cell').filter({ hasText: '@example.com' }).first()).toBeAttached();

/** The config button of the Data band, next to the Table / Charts switch. */
export const configButton = (page: Page) => page.locator('#band-data [data-chart-list-slot]').getByRole('button', { name: 'Configure data' });

/** The titles of the Data band's group row, one per data mart in the grid. */
export const groupTitles = (page: Page) => page.locator('#band-data thead tr[data-group-row] th[data-group] .truncate');

/** Opens the config menu (a click when it is closed) and returns it. */
export async function openConfig(page: Page): Promise<Locator> {
  const button = configButton(page);
  if ((await button.getAttribute('aria-expanded')) !== 'true') {
    // Playwright scrolls an off-screen button into view and clicks in the same frame; the document's late scroll event then dismisses the menu, which a mouse cannot do. Scroll first and let it settle.
    await button.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    await button.click();
  }
  const menu = page.getByRole('menu', { name: 'Configure data' });
  await expect(menu).toBeVisible();
  return menu;
}

/** Opens the config menu and clicks a data mart's row; returns the dialog with its fields, its joinable data marts and Remove from report. */
export async function openFields(page: Page, title: string): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  const menu = await openConfig(page);
  await menu.getByRole('menuitem', { name: title, exact: true }).click();
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Closes the config menu with whatever panels it has open (Escape closes one level at a time). */
export async function closeConfig(page: Page): Promise<void> {
  await expect(page.getByRole('menu', { name: 'Configure data' })).toBeVisible();
  for (let i = 0; i < 4 && (await page.getByRole('menu', { name: 'Configure data' }).count()) > 0; i++) await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Configure data' })).toHaveCount(0);
}

/** Asserts that the config menu and the given panels are still open after a short wait. The caller waits first for what the edit loads (joined rows arrive well after 250 ms), so this covers a menu that closes by itself once that has landed. */
export async function expectStillOpen(page: Page, ...panels: Locator[]): Promise<void> {
  await page.waitForTimeout(250);
  await expect(page.getByRole('menu', { name: 'Configure data' })).toBeVisible();
  for (const panel of panels) await expect(panel).toBeVisible();
}
