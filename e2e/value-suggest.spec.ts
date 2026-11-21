import { expect, test, type Page } from '@playwright/test';

// A column filter's text input suggests the column's values; picking adds them to the list.
test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });
const data = (page: Page) => page.locator('#band-data');

async function openFilter(page: Page, column: string) {
  const icon = data(page).getByLabel(`Column menu ${column}`, { exact: true });
  await icon.scrollIntoViewIfNeeded();
  await icon.locator('xpath=ancestor::th').hover();
  await icon.click();
  await page.getByRole('menuitem', { name: 'Filter', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('picking two statuses adds both to the input, and Apply keeps only their rows', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  const dialog = await openFilter(page, 'status');
  await dialog.getByLabel('Operator').selectOption('eq');
  const value = dialog.getByLabel('Value');
  await value.focus();
  const list = page.getByRole('listbox', { name: 'Suggested values' });
  await expect(list).toBeVisible();
  await expect(list.getByRole('option')).toHaveCount(5);
  // Typing narrows the list.
  await value.pressSequentially('SH');
  await expect(list.getByRole('option')).toHaveText(['shipped']);
  await list.getByRole('option', { name: 'shipped' }).click();
  await expect(value).toHaveValue('shipped, ');
  await expect(value).toBeFocused();
  await list.getByRole('option', { name: 'paid' }).click();
  await expect(value).toHaveValue('shipped, paid, ');
  await expect(value).toBeFocused();
  await expect(list.getByRole('option', { name: 'shipped' })).toHaveCount(0);
  // Escape closes the list and leaves the menu open.
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const statuses = data(page).getByRole('cell', { name: /^(new|paid|shipped|delivered|cancelled)$/ });
  await expect.poll(async () => [...new Set(await statuses.allTextContents())].sort()).toEqual(['paid', 'shipped']);
});

test('the keyboard picks: arrows and Enter', async ({ page }) => {
  const dialog = await openFilter(page, 'status');
  await dialog.getByLabel('Operator').selectOption('eq');
  const value = dialog.getByLabel('Value');
  await value.focus();
  await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(value).toHaveValue(/^\w+, $/);
  await expect(dialog).toBeVisible();
});
