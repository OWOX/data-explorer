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

// Dragging a field header moves the column, as in Google Sheets.
const titles = (page: Page) => data(page).locator('th.dm-th[data-column]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.column!));
const header = (page: Page, column: string) => data(page).locator(`th.dm-th[data-column="${column}"]`).first();
const indicator = (page: Page) => data(page).locator('[data-drop-indicator]');

async function dragHeader(page: Page, from: string, to: { x: number; y: number }, check?: () => Promise<void>) {
  const p = await centre(header(page, from));
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  if (check) await check();
  await page.mouse.up();
}

async function dragFirstPastSecond(page: Page, tall = 100) {
  const order = await titles(page);
  const second = (await header(page, order[1]!).boundingBox())!;
  const y = second.y + second.height / 2;
  await dragHeader(page, order[0]!, { x: second.x + second.width - 4, y }, async () => {
    await expect(data(page).locator('[data-drag-ghost]')).toBeVisible();
    await expect(data(page).locator('[data-drag-shade]')).toBeVisible();
    await expect(indicator(page)).toBeVisible();
    const b = (await indicator(page).boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(3);
    expect(b.height).toBeGreaterThan(tall);
  });
  return order;
}

test('dragging a header in Table mode moves the column and shows the drop line', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  const order = await dragFirstPastSecond(page);
  await expect.poll(() => titles(page)).toEqual([order[1], order[0], ...order.slice(2)]);
  await expect(indicator(page)).toHaveCount(0);
  // No sort came with the drag.
  await expect(data(page).locator('th[aria-sort="ascending"], th[aria-sort="descending"]')).toHaveCount(0);
});

test('dragging a header in Charts mode moves the column too', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  await expect(data(page).getByText('Unique Records', { exact: true }).first()).toBeVisible();
  await expect(data(page).locator('svg').first()).toBeVisible();
  const order = await dragFirstPastSecond(page, 40);
  await expect.poll(() => titles(page)).toEqual([order[1], order[0], ...order.slice(2)]);
});

// Holds the pointer at an edge until the auto-scroll has run its course (or there was nothing to scroll).
const settled = (page: Page, done: (el: HTMLElement) => boolean) => async () => {
  const root = data(page).locator('.dm-grid-root');
  await expect.poll(() => root.evaluate(done), { timeout: 10_000 }).toBe(true);
};
const scrolledToEnd = (page: Page) => settled(page, (el) => el.scrollLeft >= el.scrollWidth - el.clientWidth - 1);
const scrolledToStart = (page: Page) => settled(page, (el) => el.scrollLeft <= 1);

async function addCustomers(page: Page) {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await page.locator('#band-marts').getByText('Customers', { exact: true }).first().click();
  await expect(data(page).getByRole('button', { name: 'Fields of Customers' })).toBeVisible();
}

async function joinedLayout(page: Page) {
  await addCustomers(page);
  await data(page).getByRole('button', { name: 'Fields of Customers' }).click();
  await page.getByRole('dialog').getByLabel('city', { exact: true }).click();
  await page.keyboard.press('Escape');
  const order = await titles(page);
  const joined = order.filter((c) => c.startsWith('customers__'));
  expect(joined.length).toBeGreaterThan(1);
  return { own: order.filter((c) => !c.startsWith('customers__')), joined };
}

test('a column dragged past the right edge (the grid scrolls) stays the last of its own data mart', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await addCustomers(page);
  const order = await titles(page);
  const joined = order.filter((c) => c.startsWith('customers__'));
  const own = order.filter((c) => !c.startsWith('customers__'));
  expect(joined.length).toBeGreaterThan(0);
  const box = (await data(page).locator('.dm-grid-root').boundingBox())!;
  await dragHeader(page, own[0]!, { x: box.x + box.width - 5, y: box.y + 40 }, scrolledToEnd(page));
  await expect.poll(() => titles(page)).toEqual([...own.slice(1), own[0]!, ...joined]);
});

test('a joined column dragged far left stays first in its own group, after the main mart\'s columns', async ({ page }) => {
  const { own, joined } = await joinedLayout(page);
  const box = (await data(page).locator('.dm-grid-root').boundingBox())!;
  await dragHeader(page, joined[joined.length - 1]!, { x: box.x + 5, y: box.y + 40 }, scrolledToStart(page));
  await expect.poll(() => titles(page)).toEqual([...own, joined[joined.length - 1]!, ...joined.slice(0, -1)]);
});

test('a click on a header without movement still sorts', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  const order = await titles(page);
  const th = header(page, order[1]!);
  const p = await centre(th.locator('.dm-sort'));
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 2, p.y);
  await page.mouse.up();
  await expect(th).toHaveAttribute('aria-sort', 'ascending');
  expect(await titles(page)).toEqual(order);
});

test('Escape cancels a drag, and the release over the same header does not sort it', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  const order = await titles(page);
  const first = header(page, order[0]!);
  const start = await centre(first.locator('.dm-sort'));
  const second = (await header(page, order[1]!).boundingBox())!;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width - 4, second.y + 10, { steps: 10 });
  await expect(indicator(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(data(page).locator('[data-drag-ghost]')).toHaveCount(0);
  await page.mouse.move(start.x, start.y, { steps: 10 });
  await page.mouse.up();
  await expect(first).toHaveAttribute('aria-sort', 'none');
  expect(await titles(page)).toEqual(order);
});

test('an aggregated column with two functions moves as one block', async ({ page }) => {
  const g = data(page);
  await expect(g.getByRole('row')).toHaveCount(202);
  await g.getByRole('button', { name: 'Fields of Orders' }).click();
  await page.getByRole('dialog').getByLabel('Amount', { exact: true }).click();
  await page.keyboard.press('Escape');
  const icon = g.getByLabel('Column menu Amount', { exact: true });
  await icon.locator('xpath=ancestor::th').hover();
  await icon.click();
  await page.getByRole('menuitem', { name: 'Aggregate', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Sum', { exact: true }).click();
  await page.getByRole('dialog').getByLabel('Average', { exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await expect(g.getByRole('columnheader', { name: /Amount · Average/ })).toBeVisible();
  const order = await titles(page);
  expect(order.filter((c) => c === 'amount')).toHaveLength(2);
  const others = order.filter((c) => c !== 'amount');
  const outputs = g.locator('th.dm-th[data-column="amount"]');
  const a = (await outputs.first().boundingBox())!;
  const first = (await header(page, others[0]!).boundingBox())!;
  await dragHeader(page, 'amount', { x: first.x + 4, y: a.y + a.height / 2 });
  await expect.poll(() => titles(page)).toEqual(['amount', 'amount', ...others]);
});

test('a move is one Undo step', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  const order = await dragFirstPastSecond(page);
  await expect.poll(() => titles(page)).toEqual([order[1], order[0], ...order.slice(2)]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => titles(page)).toEqual(order);
});

test('ticking a field in the main picker keeps the dragged order', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  const order = await dragFirstPastSecond(page);
  const moved = [order[1], order[0], ...order.slice(2)];
  await expect.poll(() => titles(page)).toEqual(moved);
  await data(page).getByRole('button', { name: 'Fields of Orders' }).click();
  await page.getByRole('dialog').getByLabel('Amount', { exact: true }).click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await titles(page)).filter((c) => c !== 'amount')).toEqual(moved);
});
