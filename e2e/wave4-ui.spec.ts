import { expect, test, type Page } from '@playwright/test';

test.use({ deviceScaleFactor: 2 });
const data = (page: Page) => page.locator('#band-data');
const marts = (page: Page) => page.locator('#band-marts');
const bg = (loc: ReturnType<Page['locator']>) => loc.evaluate((e) => getComputedStyle(e).backgroundColor);

test('the Export menu draws a visible line between the assistants, the destinations and the other items', async ({ page }) => {
  await page.goto('/?mock&sheets=1');
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await data(page).getByText('Export', { exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Create Data Mart' })).toBeVisible();
  const seps = menu.getByRole('separator');
  await expect(seps).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const s = await seps.nth(i).evaluate((e) => { const c = getComputedStyle(e); return { w: c.borderTopWidth, st: c.borderTopStyle, col: c.borderTopColor, box: e.getBoundingClientRect().width }; });
    expect(s.st).toBe('solid');
    expect(s.w).toBe('1px');
    expect(s.box).toBeGreaterThan(100);
  }
  await page.screenshot({ path: 'tmp/w4t1-export-menu.png', clip: (await menu.boundingBox())! });
});

test('Grid tints only the focused card, Graph only the pinned one', async ({ page }) => {
  await page.goto('/?mock');
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await marts(page).getByText('Customers', { exact: true }).first().click();
  await expect(data(page).getByRole('button', { name: 'Fields of Customers' })).toBeVisible();
  const cards = marts(page).locator('article[aria-pressed="true"]');
  await expect(cards).toHaveCount(2);
  const plain = await bg(marts(page).locator('article[data-focused]').first()).catch(() => null);
  const states = await cards.evaluateAll((els) => els.map((e) => ({ focused: e.hasAttribute('data-focused'), bg: getComputedStyle(e).backgroundColor })));
  const tinted = states.filter((s) => s.focused);
  const rest = states.filter((s) => !s.focused);
  expect(tinted).toHaveLength(1);
  expect(rest).toHaveLength(1);
  expect(tinted[0]!.bg).not.toBe(rest[0]!.bg);
  void plain;
  await marts(page).screenshot({ path: 'tmp/w4t1-grid.png' });
  await marts(page).getByRole('radio', { name: 'Graph' }).click();
  const articles = marts(page).locator('article:not([data-ghost])');
  await expect(articles.first()).toBeVisible();
  expect(await articles.evaluateAll((els) => els.filter((e) => e.hasAttribute('data-focused')).length)).toBe(0);
  await articles.first().click();
  await expect(marts(page).locator('article[data-focused]')).toHaveCount(1);
  await page.mouse.move(5, 5);
  await marts(page).screenshot({ path: 'tmp/w4t1-graph.png' });
});

test('the Filter and Slice notes read in the OWOX wording with one bold word', async ({ page }) => {
  await page.goto('/?mock');
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await marts(page).getByText('Customers', { exact: true }).first().click();
  await expect(data(page).getByRole('button', { name: 'Fields of Customers' })).toBeVisible();
  for (const [col, row, shot, text, word] of [
    ['Customers · name', 'Filter', 'filter', 'Filters narrow the final result — applied after all joins.', 'after'],
    ['Customers · name', 'Slice', 'slice', 'Slices filter the joined data mart before it is joined — reducing the rows pulled in.', 'before'],
  ] as const) {
    const icon = data(page).getByLabel(`Column menu ${col}`, { exact: true });
    await icon.scrollIntoViewIfNeeded();
    await icon.locator('xpath=ancestor::th').hover();
    await icon.click();
    await page.getByRole('menuitem', { name: row, exact: true }).click();
    const dialog = page.getByRole('dialog');
    const note = dialog.getByText(text);
    await expect(note).toBeVisible();
    await expect(note.locator('strong')).toHaveText(word);
    await page.screenshot({ path: `tmp/w4t1-${shot}.png` });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
});
