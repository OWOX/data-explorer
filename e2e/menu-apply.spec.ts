import { expect, test, type Locator, type Page } from '@playwright/test';

// These drive the menu with the real mouse and wheel (no auto-scrolling), the way a member does.
test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });
const data = (page: Page) => page.locator('#band-data');

async function centre(loc: Locator) { const b = (await loc.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function click(page: Page, loc: Locator) { const p = await centre(loc); await page.mouse.move(p.x, p.y, { steps: 8 }); await page.mouse.down(); await page.mouse.up(); }
async function tick(page: Page, label: string) {
  await data(page).getByRole('button', { name: 'Fields of Orders' }).click();
  await page.getByRole('dialog').getByLabel(label, { exact: true }).check();
  await page.keyboard.press('Escape');
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
/** Wheels over the panel until its form is at the end, then keeps going the way trackpad momentum does. */
async function wheelPastEnd(page: Page, dialog: Locator) {
  const p = await centre(dialog);
  await page.mouse.move(p.x, p.y);
  for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(60); }
}

test('Aggregate: a long function list scrolls to Apply, and wheeling past its end does not close the menu', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await tick(page, 'Net Revenue');
  const dialog = await openSub(page, 'Net Revenue', 'Aggregate');
  await wheelPastEnd(page, dialog);
  await expect(page.getByRole('dialog')).toBeVisible();
  const apply = dialog.getByRole('button', { name: 'Apply' });
  await expect(apply).toBeDisabled();
  await dialog.getByLabel('Sum').scrollIntoViewIfNeeded();
  await click(page, dialog.getByLabel('Sum'));
  await expect(apply).toBeEnabled();
  await click(page, apply);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(data(page).getByRole('columnheader', { name: /Net Revenue · Sum/ })).toBeVisible();
  await expect(data(page).getByRole('button', { name: 'Aggregate Net Revenue' })).toBeVisible();
  // The rows are grouped now: the 200 order rows collapse to far fewer.
  await expect.poll(async () => data(page).getByRole('row').count()).toBeLessThan(50);
});

test('Filter on a date: the presets scroll to Last N days and its Apply, and wheeling past the end does not close the menu', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await tick(page, 'created_at');
  const dialog = await openSub(page, 'created_at', 'Filter');
  await wheelPastEnd(page, dialog);
  await expect(page.getByRole('dialog')).toBeVisible();
  await dialog.getByLabel('N').scrollIntoViewIfNeeded();
  await click(page, dialog.getByLabel('N'));
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('5');
  await click(page, dialog.getByRole('button', { name: 'Apply' }));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(data(page).getByRole('button', { name: /^Filter created_at/ })).toBeVisible();
});
