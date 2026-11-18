import { expect, test, type Locator, type Page } from '@playwright/test';

// Apply on a joined column's Aggregate and Filter panels, driven with the real mouse like a member.
test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });
const data = (page: Page) => page.locator('#band-data');

async function centre(loc: Locator) { const b = (await loc.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function click(page: Page, loc: Locator) { const p = await centre(loc); await page.mouse.move(p.x, p.y, { steps: 8 }); await page.mouse.down(); await page.mouse.up(); }
async function addCustomers(page: Page) {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await page.locator('#band-marts').getByText('Customers', { exact: true }).first().click();
  await expect(data(page).getByRole('button', { name: 'Fields of Customers' })).toBeVisible();
}
async function openSub(page: Page, column: string, row: 'Filter' | 'Aggregate') {
  const icon = data(page).getByLabel(`Column menu ${column}`, { exact: true });
  await icon.scrollIntoViewIfNeeded();
  await icon.locator('xpath=ancestor::th').hover();
  await click(page, icon);
  await click(page, page.getByRole('menuitem', { name: row, exact: true }));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('Aggregate Apply on a joined column groups the rows', async ({ page }) => {
  await addCustomers(page);
  const dialog = await openSub(page, 'Customers · name', 'Aggregate');
  await click(page, dialog.getByLabel('Count Unique'));
  await click(page, dialog.getByRole('button', { name: 'Apply' }));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(data(page).getByRole('columnheader', { name: /name · Count Unique/ })).toBeVisible();
});

test('Filter Apply on a joined column filters the rows', async ({ page }) => {
  await addCustomers(page);
  const dialog = await openSub(page, 'Customers · name', 'Filter');
  await dialog.getByLabel('Operator').selectOption('contains');
  await dialog.getByLabel('Value').fill('zzzz-none');
  await click(page, dialog.getByRole('button', { name: 'Apply' }));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(data(page).getByRole('button', { name: 'Filter Customers · name' })).toBeVisible();
  await expect.poll(async () => data(page).getByRole('row').count()).toBeLessThan(10);
});

test('a filter on status, then Aggregate (two functions) on a joined column, then a filter on it', async ({ page }) => {
  await addCustomers(page);
  let dialog = await openSub(page, 'status', 'Filter');
  await dialog.getByLabel('Operator').selectOption('neq');
  await dialog.getByLabel('Value').fill('zzzz');
  await click(page, dialog.getByRole('button', { name: 'Apply' }));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(data(page).getByRole('button', { name: 'Filter status' })).toBeVisible();
  dialog = await openSub(page, 'Customers · name', 'Aggregate');
  await click(page, dialog.getByLabel('Count Unique'));
  await click(page, dialog.getByLabel('Combined'));
  await click(page, dialog.getByRole('button', { name: 'Apply' }));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(data(page).getByRole('columnheader', { name: /name · Count Unique/ })).toBeVisible();
  await expect(data(page).getByRole('columnheader', { name: /name · Combined/ })).toBeVisible();
  await expect(data(page).getByRole('button', { name: 'Filter status' })).toBeVisible();
  dialog = await openSub(page, 'status', 'Filter');
  await dialog.getByLabel('Value').fill('paid');
  await click(page, dialog.getByRole('button', { name: 'Apply' }));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(data(page).getByRole('columnheader', { name: /name · Count Unique/ })).toBeVisible();
});

for (const [w, h] of [[1000, 640], [800, 500]] as const) {
  test(`narrow window ${w}x${h}: Aggregate and Filter Apply on a joined column`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await addCustomers(page);
    let dialog = await openSub(page, 'Customers · name', 'Aggregate');
    await click(page, dialog.getByLabel('Count Unique'));
    await click(page, dialog.getByRole('button', { name: 'Apply' }));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(data(page).getByRole('columnheader', { name: /name · Count Unique/ })).toBeVisible();
    dialog = await openSub(page, 'status', 'Filter');
    await dialog.getByLabel('Operator').selectOption('neq');
    await dialog.getByLabel('Value').fill('zzzz');
    await click(page, dialog.getByRole('button', { name: 'Apply' }));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(data(page).getByRole('button', { name: 'Filter status' })).toBeVisible();
  });
}

test('far right: many joined columns ticked, scrolled to the last one, Aggregate Apply and Filter Apply', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await addCustomers(page);
  await data(page).getByRole('button', { name: 'Fields of Customers' }).click();
  const picker = page.getByRole('dialog');
  for (const label of ['email', 'city']) await picker.getByLabel(label, { exact: true }).click();
  await page.keyboard.press('Escape');
  await data(page).getByRole('button', { name: 'Fields of Orders' }).click();
  await page.getByRole('dialog').getByRole('option').nth(5).click();
  await page.keyboard.press('Escape');
  let dialog = await openSub(page, 'Customers · city', 'Aggregate');
  await click(page, dialog.getByLabel('Count Unique'));
  await click(page, dialog.getByLabel('Combined'));
  await click(page, dialog.getByRole('button', { name: 'Apply' }));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(data(page).getByRole('columnheader', { name: /city · Count Unique/ })).toBeVisible();
  dialog = await openSub(page, 'status', 'Filter');
  await dialog.getByLabel('Operator').selectOption('neq');
  await dialog.getByLabel('Value').fill('zzzz');
  await click(page, dialog.getByRole('button', { name: 'Apply' }));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(data(page).getByRole('button', { name: 'Filter status' })).toBeVisible();
});
