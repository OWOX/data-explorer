import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });
const data = (page: Page) => page.locator('#band-data');

/** Records what the grid puts on the clipboard: a listener on the document runs after the grid's own handler. */
async function watchCopy(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    document.addEventListener('copy', (e) => { w.__copied.push(e.clipboardData?.getData('text/plain') ?? ''); });
  });
}
const copied = (page: Page) => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);

test('Ctrl/Cmd+C copies the selected cell, a block and a column as tab-separated text', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await watchCopy(page);
  const row = (n: number) => data(page).locator('tbody > tr').nth(n);
  const text = async (n: number, c: number) => (await row(n).locator(':scope > td:not([aria-hidden])').nth(c).textContent()) ?? '';
  await row(0).locator(':scope > td').first().click();
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => copied(page)).toEqual([await text(0, 0)]);
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('ControlOrMeta+c');
  const block = [0, 1].map(async (r) => `${await text(r, 0)}\t${await text(r, 1)}`);
  await expect.poll(async () => (await copied(page))[1]).toBe((await Promise.all(block)).join('\n'));
  await data(page).locator('th.dm-letter').first().click();
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(async () => (await copied(page))[2]?.split('\n').length).toBe(201);
});

test('Cmd/Ctrl+Z undoes an applied filter and Shift+Z applies it again', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  const icon = data(page).getByLabel('Column menu id');
  await icon.locator('xpath=ancestor::th').hover();
  await icon.click();
  await page.getByRole('menuitem', { name: 'Filter', exact: true }).click();
  await page.getByLabel('Operator').selectOption('lte');
  await page.getByLabel('Value').fill('3');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(data(page).getByRole('row')).toHaveCount(5);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(data(page).getByRole('row')).toHaveCount(5);
});
