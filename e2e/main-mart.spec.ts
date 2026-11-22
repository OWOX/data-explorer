import { expect, test, type Page } from '@playwright/test';

const band = (page: Page, id: 'marts' | 'data') => page.locator(`#band-${id}`);
const martCard = (page: Page, title: string) => band(page, 'marts').locator('article', { hasText: title }).first();

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });

test('dragging Customers onto Orders makes Customers the main data mart, first in the band and in the grid', async ({ page }) => {
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Orders');
  await martCard(page, 'Customers').dragTo(martCard(page, 'Orders'));
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Customers');
  await expect(band(page, 'marts').locator('article').first()).toContainText('Customers');
});

test('Copy SQL is enabled once the grid has loaded', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await expect(band(page, 'data').getByRole('row')).toHaveCount(202);
  await band(page, 'data').getByText('Export').click();
  await expect(page.getByRole('menuitem', { name: 'Copy SQL' })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'Copy SQL' }).click();
  await expect(page.getByText('SQL copied.', { exact: false })).toBeVisible();
});

/** The article ids of the marts band in DOM order, with each one's box. */
const cardsOf = (page: Page) => page.evaluate(() => [...document.querySelectorAll('#band-marts article:not([data-ghost]):not(.dm-leaving)')].map((a) => { const b = a.getBoundingClientRect(); return { id: a.id, top: Math.round(b.top), left: Math.round(b.left) }; }));

/** The main mart's card is the first article and sits top-left: the smallest top, then the smallest left. */
async function expectMainTopLeft(page: Page, id: string) {
  await expect.poll(async () => {
    const cards = await cardsOf(page);
    if (cards.length === 0 || cards[0]!.id !== id) return `first is ${cards[0]?.id}`;
    const best = [...cards].sort((a, b) => a.top - b.top || a.left - b.left)[0]!;
    return best.id === id ? 'ok' : `top-left is ${best.id}`;
  }, { timeout: 5000 }).toBe('ok');
}

test('Make it main on a focused joined card puts it first and top-left', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Orders');
  await martCard(page, 'Customers').click();
  await expect(band(page, 'marts').locator('[id="dm-customers@customers"]')).toBeVisible();
  await page.getByRole('button', { name: /Make it main: Customers/ }).click();
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Customers');
  await expectMainTopLeft(page, 'dm-customers');
});

test('Make it main on a picked card the main mart cannot join puts it first and top-left', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Orders');
  await band(page, 'marts').getByRole('button', { name: 'Marketing' }).click();
  const campaigns = band(page, 'marts').locator('article#dm-campaigns');
  await expect(campaigns).toHaveClass(/dm-unjoinable/);
  await campaigns.click();
  await page.getByRole('button', { name: /Make it main: Campaigns/ }).click();
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Campaigns');
  await expectMainTopLeft(page, 'dm-campaigns');
});

test('Make it main on a ghost the main mart cannot join puts it first and top-left', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Orders');
  await band(page, 'marts').locator('article#dm-orders').hover();
  const ghost = band(page, 'marts').locator('article[data-ghost]').first();
  await expect(ghost).toBeVisible();
  const id = await ghost.getAttribute('id');
  await ghost.click();
  await page.getByRole('button', { name: /Make it main/ }).click();
  await expectMainTopLeft(page, id!);
});

test('Make it main in the Graph, then switching to the Grid, leaves the new main first and top-left', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Orders');
  await martCard(page, 'Customers').click();
  await band(page, 'marts').getByRole('radio', { name: 'Graph' }).click();
  await band(page, 'marts').locator('[id="dm-customers@customers"]').click();
  await page.getByRole('button', { name: /Make it main: Customers/ }).click();
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Customers');
  await band(page, 'marts').getByRole('radio', { name: 'Grid' }).click();
  await expectMainTopLeft(page, 'dm-customers');
});

test('with slow reads the new main is the first card from the moment it becomes main until the reads land', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/?mock&latency=1500');
  const groups = band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first();
  await expect(groups).toHaveText('Orders', { timeout: 30000 });
  await band(page, 'marts').locator('article#dm-orders').hover();
  const ghost = band(page, 'marts').locator('article[data-ghost]').first();
  await expect(ghost).toBeVisible();
  const id = (await ghost.getAttribute('id'))!;
  await ghost.click();
  // Every 25 ms, the first card of the band and the Data band's first group.
  await page.evaluate(() => {
    const w = window as unknown as { samples: { first: string; group: string }[] };
    w.samples = [];
    setInterval(() => {
      w.samples.push({
        first: document.querySelector('#band-marts article:not([data-ghost]):not(.dm-leaving)')?.id ?? '',
        group: document.querySelector('#band-data thead tr[data-group-row] th[data-group]')?.textContent ?? '',
      });
    }, 25);
  });
  await page.getByRole('button', { name: /Make it main/ }).click();
  await page.waitForTimeout(5000);
  const samples = await page.evaluate(() => (window as unknown as { samples: { first: string; group: string }[] }).samples);
  const became = samples.findIndex((s) => s.first === id);
  expect(became).toBeGreaterThanOrEqual(0);
  // From the first sample where the card leads, it never stops leading.
  expect(samples.slice(became).every((s) => s.first === id)).toBe(true);
  // And the band never shows the new main trailing the old one: before it leads, the old main still does.
  expect(samples.slice(0, became).every((s) => s.first === 'dm-orders')).toBe(true);
  await expectMainTopLeft(page, id);
});
