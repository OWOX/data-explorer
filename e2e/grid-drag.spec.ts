import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });
const data = (page: Page) => page.locator('#band-data');
const cell = (page: Page, r: number, c: number) => data(page).locator('tbody > tr').nth(r).locator(':scope > td:not([aria-hidden])').nth(c);
const centre = async (loc: ReturnType<typeof cell>) => { const b = (await loc.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

test('dragging with the real mouse selects the block of cells, not text, and Cmd+C copies it', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await page.evaluate(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    document.addEventListener('copy', (e) => { w.__copied.push(e.clipboardData?.getData('text/plain') ?? ''); });
  });
  const a = await centre(cell(page, 1, 1));
  const b = await centre(cell(page, 4, 3));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await expect(data(page).locator('td[data-range]')).toHaveCount(12);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  // No record opened by the drag.
  await expect(page.getByRole('heading', { name: /^Record/ })).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+c');
  const lines: string[] = [];
  for (let r = 1; r <= 4; r++) {
    const cols: string[] = [];
    for (let c = 1; c <= 3; c++) cols.push((await cell(page, r, c).textContent()) ?? '');
    lines.push(cols.join('\t'));
  }
  await expect.poll(() => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([lines.join('\n')]);
});

test('checklist rows use the column menu font and row height', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await data(page).getByLabel('Column menu id', { exact: true }).scrollIntoViewIfNeeded();
  await data(page).getByLabel('Column menu id', { exact: true }).locator('xpath=ancestor::th').hover();
  await data(page).getByLabel('Column menu id', { exact: true }).click();
  const menuRow = page.getByRole('menuitem').first();
  const m = await menuRow.evaluate((el) => { const c = getComputedStyle(el); return { family: c.fontFamily, size: c.fontSize, height: el.getBoundingClientRect().height }; });
  await page.keyboard.press('Escape');
  await data(page).getByRole('button', { name: 'Fields of Orders' }).click();
  const optRow = page.getByRole('dialog').getByRole('option').first();
  const o = await optRow.evaluate((el) => { const c = getComputedStyle(el); return { family: c.fontFamily, size: c.fontSize, height: el.getBoundingClientRect().height }; });
  expect(o.family).toBe(m.family);
  expect(o.size).toBe(m.size);
  expect(o.height).toBe(m.height);
});
