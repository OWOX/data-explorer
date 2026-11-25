import { expect, test, type Locator, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/?mock&urls&latency=0'); });
const data = (page: Page) => page.locator('#band-data');
const gridLink = (page: Page, i = 0) => data(page).locator('td a.dm-cell-link').nth(i);
const opened = (page: Page) => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
const selectedText = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? '');
const box = async (loc: Locator) => { await loc.scrollIntoViewIfNeeded(); return (await loc.boundingBox())!; };

/** Scrolls the nearest scrollable ancestor of the link (or the page) by `dy` px (negative: back up). */
const scrollUnder = (link: Locator, dy: number) => link.evaluate((a, d) => {
  let el: HTMLElement | null = a.parentElement;
  while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
  (el ?? document.scrollingElement!).scrollTop += d;
}, dy);

/** The Row band with the first record open, and its status link. */
async function rowLink(page: Page) {
  await expect(gridLink(page)).toBeVisible();
  await data(page).locator('tbody > tr').first().locator(':scope > td:not([aria-hidden])').first().click();
  const link = page.locator('#band-row a.dm-cell-link').first();
  await expect(link).toBeVisible();
  return link;
}
/** A press inside the link text, a drag by `to` px right (and optionally down), release. */
async function dragIn(page: Page, link: Locator, from: number, to: number, dy = 0) {
  const b = await box(link);
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + from, y);
  await page.mouse.down();
  await page.mouse.move(b.x + to, y + dy, { steps: 8 });
  await page.mouse.up();
}

test.describe('a URL in the Row band', () => {
  test('a drag inside the link selects its text and opens nothing', async ({ page }) => {
    const link = await rowLink(page);
    await dragIn(page, link, 10, 120);
    expect((await selectedText(page)).length).toBeGreaterThan(5);
    expect(await opened(page)).toEqual([]);
  });

  test('a drag out of the link and back into it opens nothing', async ({ page }) => {
    const link = await rowLink(page);
    const b = await box(link);
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + 10, y);
    await page.mouse.down();
    await page.mouse.move(b.x + 40, y + 60, { steps: 6 });
    await page.mouse.move(b.x + 120, y, { steps: 6 });
    await page.mouse.up();
    expect(await opened(page)).toEqual([]);
  });

  test('a press, a scroll of the page and a release at the same screen point open nothing', async ({ page }) => {
    // A short window, so the page has room to scroll.
    await page.setViewportSize({ width: 1440, height: 500 });
    const link = await rowLink(page);
    await link.evaluate((a) => a.scrollIntoView({ block: 'start' }));
    const b = await box(link);
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + 10, y);
    await page.mouse.down();
    await scrollUnder(link, -8);
    expect((await link.boundingBox())!.y).toBeGreaterThan(b.y + 6);
    await page.mouse.up();
    expect(await opened(page)).toEqual([]);
  });

  test('a click opens it once, and Enter opens it once', async ({ page }) => {
    const link = await rowLink(page);
    await link.click();
    expect(await opened(page)).toHaveLength(1);
    await link.focus();
    await page.keyboard.press('Enter');
    expect(await opened(page)).toHaveLength(2);
  });

  test('a click and Enter open it while an old selection overlaps it', async ({ page }) => {
    const link = await rowLink(page);
    await dragIn(page, link, 10, 120);
    expect(await selectedText(page)).not.toBe('');
    await link.click();
    expect(await opened(page)).toHaveLength(1);
    await link.click({ button: 'right' });
    await page.keyboard.press('Escape');
    await link.click();
    expect(await opened(page)).toHaveLength(2);
    await page.keyboard.press('ControlOrMeta+a');
    await link.click();
    expect(await opened(page)).toHaveLength(3);
    await link.focus();
    await page.keyboard.press('Enter');
    expect(await opened(page)).toHaveLength(4);
  });

  test('a double click opens one tab, a shift-click, a right click and a middle click open none more', async ({ page }) => {
    const link = await rowLink(page);
    await link.dblclick();
    expect(await opened(page)).toHaveLength(1);
    await link.click({ modifiers: ['Shift'] });
    await link.click({ button: 'right' });
    await page.keyboard.press('Escape');
    await link.click({ button: 'middle' });
    expect(await opened(page)).toHaveLength(1);
  });
});

test.describe('a URL in the grid', () => {
  test('a click opens it once and a drag over cells opens nothing', async ({ page }) => {
    await gridLink(page).click();
    expect(await opened(page)).toHaveLength(1);
    const a = await box(gridLink(page, 0));
    const b = await box(gridLink(page, 3));
    await page.mouse.move(a.x + 10, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 10, b.y + b.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(data(page).locator('td[data-range]')).not.toHaveCount(0);
    expect(await opened(page)).toHaveLength(1);
  });

  test('text a right click selected on a link does not win over the grid copy once the selection moves', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      document.addEventListener('copy', (e) => { w.__copied.push(e.clipboardData?.getData('text/plain') ?? ''); });
    });
    const link = gridLink(page, 0);
    await link.click();
    // On macOS a right click selects the link's text; any platform can select it from the page.
    await link.evaluate((a) => { const r = document.createRange(); r.selectNodeContents(a); getSelection()!.removeAllRanges(); getSelection()!.addRange(r); });
    expect(await selectedText(page)).not.toBe('');
    await page.keyboard.press('ArrowDown');
    expect(await selectedText(page)).toBe('');
    await page.keyboard.press('ControlOrMeta+c');
    const next = (await gridLink(page, 1).textContent()) ?? '';
    await expect.poll(() => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([next]);
  });

  test('a drag over the data mart title keeps its text, and a click on a cell then clears it so Cmd+C copies the cell', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      document.addEventListener('copy', (e) => { w.__copied.push(e.clipboardData?.getData('text/plain') ?? ''); });
    });
    await data(page).locator('th.dm-letter').first().click();
    const title = data(page).locator('th[data-group] .truncate').first();
    const b = await box(title);
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + 2, y);
    await page.mouse.down();
    await page.mouse.move(b.x + Math.min(b.width - 2, 60), y, { steps: 6 });
    await page.mouse.up();
    expect(await selectedText(page)).not.toBe('');
    await expect(data(page).locator('[data-selected]')).toHaveCount(0);
    const cell = data(page).locator('tbody > tr').first().locator(':scope > td:not([aria-hidden])').first();
    await cell.click();
    expect(await selectedText(page)).toBe('');
    await page.keyboard.press('ControlOrMeta+c');
    const text = (await cell.textContent()) ?? '';
    await expect.poll(() => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([text]);
  });
});
