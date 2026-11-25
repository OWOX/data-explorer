import { expect, test, type Locator, type Page } from '@playwright/test';
import { groupTitles } from './config-menu';

// A slice on a joined column, driven with the real mouse like a member.
test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });
const data = (page: Page) => page.locator('#band-data');

async function centre(loc: Locator) { const b = (await loc.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function click(page: Page, loc: Locator) { const p = await centre(loc); await page.mouse.move(p.x, p.y, { steps: 8 }); await page.mouse.down(); await page.mouse.up(); }
async function addCustomers(page: Page) {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await page.locator('#band-marts').getByText('Customers', { exact: true }).first().click();
  await expect(groupTitles(page).filter({ hasText: 'Customers' })).toHaveCount(1);
}
async function openSub(page: Page, column: string, row: 'Filter' | 'Slice' | 'Aggregate') {
  const icon = data(page).getByLabel(`Column menu ${column}`, { exact: true });
  await icon.scrollIntoViewIfNeeded();
  await icon.locator('xpath=ancestor::th').hover();
  await click(page, icon);
  await click(page, page.getByRole('menuitem', { name: row, exact: true }));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('a slice that matches no customer empties the joined columns, keeps every row, and Undo removes it', async ({ page }) => {
  await addCustomers(page);
  const names = data(page).getByRole('cell', { name: /^[A-Z][a-z]+ [A-Z][a-z]+$/ });
  await expect(names.first()).toBeVisible();
  const dialog = await openSub(page, 'Customers · name', 'Slice');
  await expect(dialog.getByText('Slices filter the joined data mart before it is joined — reducing the rows pulled in.')).toBeVisible();
  // The second-level panels are 19.6rem wide at most (30 percent under the old 28rem).
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(19.6 * 16 + 1);
  await dialog.getByLabel('Operator').selectOption('contains');
  await dialog.getByLabel('Value').fill('zzzz-none');
  await click(page, dialog.getByRole('button', { name: 'Apply' }));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const layers = data(page).getByRole('button', { name: /^Slice Customers · name/ });
  await expect(layers).toBeVisible();
  expect(await layers.locator('svg.lucide-layers').count()).toBe(1);
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await expect(data(page).getByRole('cell', { name: 'paid', exact: true }).first()).toBeVisible();
  await expect(names).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(data(page).getByRole('button', { name: /^Slice Customers · name/ })).toHaveCount(0);
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await expect(names.first()).toBeVisible();
});

test('a slice that matches some customers keeps their names, empties the rest, and keeps every row', async ({ page }) => {
  await addCustomers(page);
  const names = data(page).getByRole('cell', { name: /^[A-Z][a-z]+ [A-Z][a-z]+$/ });
  await expect(names.first()).toBeVisible();
  const before = await names.count();
  const dialog = await openSub(page, 'Customers · name', 'Slice');
  await dialog.getByLabel('Operator').selectOption('starts_with');
  await dialog.getByLabel('Value').fill('S');
  await click(page, dialog.getByRole('button', { name: 'Apply' }));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(data(page).getByRole('button', { name: /^Slice Customers · name/ })).toBeVisible();
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await expect.poll(async () => names.count()).toBeLessThan(before);
  const after = await names.allTextContents();
  expect(after.length).toBeGreaterThan(0);
  for (const text of after) expect(text.startsWith('S')).toBe(true);
});
