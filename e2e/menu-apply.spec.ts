import { expect, test, type Locator, type Page } from '@playwright/test';

// These drive the menu with the real mouse and wheel (no auto-scrolling), the way a member does.
test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });
const data = (page: Page) => page.locator('#band-data');

async function centre(loc: Locator) { const b = (await loc.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function click(page: Page, loc: Locator) { const p = await centre(loc); await page.mouse.move(p.x, p.y, { steps: 8 }); await page.mouse.down(); await page.mouse.up(); }
async function tick(page: Page, label: string) {
  await data(page).getByRole('button', { name: 'Fields of Orders' }).click();
  await page.getByRole('dialog').getByLabel(label, { exact: true }).click();
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
/** The panel sits inside the window, and its Apply is on screen without any scrolling. */
async function expectApplyOnScreen(page: Page, panel: Locator) {
  const box = (await panel.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);
  const apply = panel.getByRole('button', { name: 'Apply' });
  await expect(apply).toBeInViewport({ ratio: 1 });
  const a = (await apply.boundingBox())!;
  expect(a.y + a.height).toBeLessThanOrEqual(box.y + box.height);
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
  await expect(dialog.getByRole('option')).toHaveCount(9);
  await expectApplyOnScreen(page, dialog);
  await wheelPastEnd(page, dialog);
  await expect(page.getByRole('dialog')).toBeVisible();
  const apply = dialog.getByRole('button', { name: 'Apply' });
  await expect(apply).toBeDisabled();
  await dialog.getByLabel('Sum').scrollIntoViewIfNeeded();
  await click(page, dialog.getByLabel('Sum'));
  await expect(apply).toBeEnabled();
  await expectApplyOnScreen(page, dialog);
  await click(page, apply);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(data(page).getByRole('columnheader', { name: /Net Revenue · Sum/ })).toBeVisible();
  await expect(data(page).getByRole('button', { name: 'Aggregate Net Revenue' })).toBeVisible();
  // The rows are grouped now: the 200 order rows collapse to far fewer.
  await expect.poll(async () => data(page).getByRole('row').count()).toBeLessThan(50);
});

test('Filter forms keep Apply on screen as soon as they open', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  const dialog = await openSub(page, 'status', 'Filter');
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeVisible();
  await expectApplyOnScreen(page, dialog);
  await wheelPastEnd(page, dialog);
  await expectApplyOnScreen(page, dialog);
});

test('Filter on a date: Last… opens a third panel whose form shows Apply, with a unit dropdown, and wheeling past its end does not close the menu', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await tick(page, 'created_at');
  const dialog = await openSub(page, 'created_at', 'Filter');
  await click(page, dialog.getByRole('menuitemradio', { name: 'Last…' }));
  const last = page.getByRole('menu', { name: 'Last…' });
  await expect(last).toBeVisible();
  const box = (await last.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);
  await wheelPastEnd(page, last);
  await expect(page.getByRole('menu', { name: 'Last…' })).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
  const apply = last.getByRole('button', { name: 'Apply' });
  await expect(apply).toBeInViewport();
  await click(page, last.getByLabel('N', { exact: true }));
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('5');
  await last.getByLabel('Unit').selectOption('weeks');
  await click(page, apply);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('menu', { name: 'Last…' })).toHaveCount(0);
  await expect(data(page).getByRole('button', { name: /^Filter created_at/ })).toBeVisible();
  await data(page).getByRole('button', { name: /^Filter created_at/ }).click();
  await click(page, page.getByRole('dialog').getByRole('menuitemradio', { name: 'Last…' }));
  await expect(page.getByRole('menu', { name: 'Last…' }).getByLabel('Unit')).toHaveValue('weeks');
  await expect(page.getByRole('menu', { name: 'Last…' }).getByLabel('N', { exact: true })).toHaveValue('5');
});

test('a column ticked in Fields can have its menu opened right away, and the menu stays open', async ({ page }) => {
  await tick(page, 'Net Revenue');
  const icon = data(page).getByLabel('Column menu Net Revenue', { exact: true });
  await icon.scrollIntoViewIfNeeded();
  await icon.locator('xpath=ancestor::th').hover();
  await click(page, icon);
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(menu).toBeVisible();
  await click(page, page.getByRole('menuitem', { name: 'Filter', exact: true }));
  await expect(page.getByRole('dialog')).toBeVisible();
});
