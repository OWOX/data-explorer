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
