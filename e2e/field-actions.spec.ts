import { expect, test, type Locator, type Page } from '@playwright/test';
import { closeConfig, openFields } from './config-menu';

// The column menu from a row of the Fields list, driven with the real mouse like a member.
test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });
const data = (page: Page) => page.locator('#band-data');

async function centre(loc: Locator) { const b = (await loc.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function click(page: Page, loc: Locator) { const p = await centre(loc); await page.mouse.move(p.x, p.y, { steps: 8 }); await page.mouse.down(); await page.mouse.up(); }

test('a filter on a field that is not a column, set from the Fields list, narrows the rows and keeps the field hidden', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  const revenueHeader = data(page).getByRole('columnheader', { name: /^Net Revenue/ });
  await expect(revenueHeader).toHaveCount(0);
  await openFields(page, 'Orders');
  const list = page.getByRole('listbox', { name: 'Fields of Orders' });
  await expect(list).toBeVisible();
  const row = list.getByRole('option', { name: 'Net Revenue', exact: true }).locator('xpath=..');
  const icon = row.getByRole('button', { name: 'Column menu Net Revenue' });
  // Grey and hidden until the row is hovered.
  await expect(icon).toHaveCSS('opacity', '0');
  await row.hover();
  await expect(icon).toHaveCSS('opacity', '1');
  await click(page, icon);
  const menu = page.getByRole('menu', { name: 'Menu of Net Revenue' });
  await expect(menu).toBeVisible();
  await click(page, menu.getByRole('menuitem', { name: 'Filter', exact: true }));
  const dialog = page.getByRole('dialog', { name: 'Filter of Net Revenue' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Operator').selectOption('lt');
  await dialog.getByLabel('Value').fill('0');
  await click(page, dialog.getByRole('button', { name: 'Apply' }));
  // The Fields list stays open, the field stays hidden, its icon is green, and no row is left.
  await expect(list).toBeVisible();
  await expect(list.getByRole('option', { name: 'Net Revenue', exact: true })).toHaveAttribute('aria-selected', 'false');
  await expect(icon).toHaveClass(/dm-ctl-on/);
  await expect(data(page).getByText(/No rows|match/i).first()).toBeVisible({ timeout: 10000 });
  await expect(revenueHeader).toHaveCount(0);
  // The title row says there is a filter, and Undo takes it away in one step.
  await closeConfig(page);
  await expect(data(page).getByRole('button', { name: '1 filter', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(data(page).getByRole('button', { name: '1 filter', exact: true })).toHaveCount(0);
  await expect(data(page).getByRole('row')).toHaveCount(202);
});
