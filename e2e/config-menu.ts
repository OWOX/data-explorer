import { expect, type Locator, type Page } from '@playwright/test';

/** The config button of the Data band, next to the Table / Charts switch. */
export const configButton = (page: Page) => page.locator('#band-data').getByRole('button', { name: 'Configure data' });

/** The titles of the Data band's group row, one per data mart in the grid. */
export const groupTitles = (page: Page) => page.locator('#band-data thead tr[data-group-row] th[data-group] .truncate');

/** Opens the config menu (a click when it is closed) and returns it. */
export async function openConfig(page: Page): Promise<Locator> {
  const button = configButton(page);
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  const menu = page.getByRole('menu', { name: 'Configure data' });
  await expect(menu).toBeVisible();
  return menu;
}

/** Opens the config menu and clicks a data mart's row; returns the dialog with its fields, its joinable data marts and Remove from report. */
export async function openFields(page: Page, title: string): Promise<Locator> {
  // A scroll closes the menu, and a click may scroll the page to reach the button or a row in a short window: retry until the menu holds still.
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await expect(async () => {
    const menu = await openConfig(page);
    await menu.getByRole('menuitem', { name: title, exact: true }).click({ timeout: 2000 });
    await expect(dialog).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  return dialog;
}

/** Closes the config menu with whatever panels it has open (Escape closes one level at a time). */
export async function closeConfig(page: Page): Promise<void> {
  for (let i = 0; i < 4 && (await page.getByRole('menu', { name: 'Configure data' }).count()) > 0; i++) await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Configure data' })).toHaveCount(0);
}
