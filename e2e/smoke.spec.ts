import { expect, test, type Page } from '@playwright/test';

const band = (page: Page, id: 'sources' | 'marts' | 'data' | 'row') => page.locator(`#band-${id}`);
const martCard = (page: Page, title: string) => band(page, 'marts').locator('article', { hasText: title }).first();

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });

async function ordersGrid(page: Page) {
  const data = band(page, 'data');
  await expect(data.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expect(data.getByRole('row')).toHaveCount(201);
  return data;
}

test('the first load selects Orders: its rows, its joined marts, the sources, badges and icons', async ({ page }) => {
  const data = await ordersGrid(page);
  await expect(martCard(page, 'Orders')).toHaveAttribute('aria-pressed', 'true');
  await expect(band(page, 'marts').getByText('Customers', { exact: true })).toBeVisible();
  await expect(band(page, 'sources').getByText('Shopify', { exact: true })).toBeVisible();
  await expect(data.getByText('200+ rows')).toBeVisible();
  await expect(band(page, 'row').getByText('Select a row.')).toBeVisible();
  await expect(martCard(page, 'Orders').getByLabel(/^Passed/)).toBeVisible();
  await expect(martCard(page, 'Orders').getByLabel('Open in OWOX')).toBeVisible();
  // The count badge lands once the card is on screen.
  await expect(martCard(page, 'Orders').locator('.dm-badge').first()).toHaveText(/\d/);
});

test('a source click narrows the marts; clicking it again returns', async ({ page }) => {
  await ordersGrid(page);
  const shopify = band(page, 'sources').locator('article', { hasText: 'Shopify' });
  await shopify.click();
  await expect(band(page, 'marts').getByText('Sessions', { exact: true })).toHaveCount(0);
  await expect(band(page, 'data').getByText('Select a data mart.')).toBeVisible();
  await shopify.click();
  await expect(band(page, 'data').getByRole('heading', { name: 'Orders' })).toBeVisible();
});

test('search narrows the marts', async ({ page }) => {
  await ordersGrid(page);
  await page.getByLabel('Search data marts').fill('campaign');
  await expect(band(page, 'marts').getByText('Campaigns', { exact: true })).toBeVisible();
  await expect(band(page, 'marts').getByText('Orders', { exact: true })).toHaveCount(0);
});

test('filter, reset, columns, a row fills the Row band, Back returns', async ({ page }) => {
  const data = await ordersGrid(page);
  await data.getByLabel('Filter id').click();
  await page.getByLabel('Operator').selectOption('lte');
  await page.getByLabel('Value').fill('3');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(data.getByRole('row')).toHaveCount(4);
  await data.getByRole('button', { name: 'Reset' }).click();
  await expect(data.getByRole('row')).toHaveCount(201);
  await data.getByRole('button', { name: /Columns/ }).click();
  await page.getByLabel(/amount/i).check();
  await expect(data.getByRole('columnheader')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await data.getByRole('row').nth(1).click();
  const row = band(page, 'row');
  await expect(row.getByRole('heading', { name: /^Orders · 1$/ })).toBeVisible();
  await expect(row.getByText('status')).toBeVisible();
  await row.getByRole('button', { name: /Back/ }).click();
  await expect(row.getByText('Select a row.')).toBeVisible();
});

test('a card click selects its mart and Back restores the previous one', async ({ page }) => {
  await ordersGrid(page);
  await martCard(page, 'Customers').click();
  await expect(band(page, 'data').getByRole('heading', { name: 'Customers' })).toBeVisible();
  await expect(martCard(page, 'Customers')).toHaveAttribute('aria-pressed', 'true');
  await band(page, 'row').getByRole('button', { name: /Back/ }).click();
  await expect(band(page, 'data').getByRole('heading', { name: 'Orders' })).toBeVisible();
});

test('a related title moves the selection, and Back restores the mart and the record', async ({ page }) => {
  const data = await ordersGrid(page);
  const row = band(page, 'row');
  await data.getByRole('row').nth(1).click();
  await expect(row.getByRole('heading', { name: /^Orders · 1$/ })).toBeVisible();
  // A customer's name in the grid is a related title: it opens that customer.
  await data.getByRole('cell').filter({ hasText: /^[A-Z][a-z]+ [A-Z][a-z]+$/ }).first().getByRole('button').click();
  await expect(data.getByRole('heading', { name: 'Customers' })).toBeVisible();
  await expect(row.getByRole('heading', { name: /^Customers · \d+$/ })).toBeVisible();
  await expect(martCard(page, 'Customers')).toHaveAttribute('aria-pressed', 'true');
  await row.getByRole('button', { name: /Back/ }).click();
  await expect(data.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expect(row.getByRole('heading', { name: /^Orders · 1$/ })).toBeVisible();
  await expect(martCard(page, 'Orders')).toHaveAttribute('aria-pressed', 'true');
});

test('Refresh keeps the cards, counts and quality icons on screen', async ({ page }) => {
  await ordersGrid(page);
  const badge = martCard(page, 'Orders').locator('.dm-badge').first();
  await expect(badge).toHaveText(/\d/);
  await page.getByRole('button', { name: 'Refresh model' }).click();
  await expect(martCard(page, 'Orders').getByLabel(/^Passed/)).toBeVisible();
  await expect(martCard(page, 'Orders').getByLabel('Counting rows')).toHaveCount(0);
  await expect(badge).toHaveText(/\d/);
  await expect(band(page, 'data').getByRole('row')).toHaveCount(201);
});
