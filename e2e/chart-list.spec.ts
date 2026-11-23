import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });
const data = (page: Page) => page.locator('#band-data');

async function openCharts(page: Page, columns: (string | RegExp)[]) {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  for (const name of columns) {
    await data(page).getByRole('button', { name: 'Fields of Orders' }).click();
    await page.getByRole('option', { name }).click();
    await page.keyboard.press('Escape');
  }
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  await expect(data(page).locator('section.dm-chart')).toHaveCount(2);
}

test('add, switch, configure, hide and remove charts from the header menu', async ({ page }) => {
  await openCharts(page, [/created_at/i, /Net Revenue/i]);
  const listButton = data(page).locator('[data-chart-list-slot]').getByRole('button', { name: 'Charts options' });

  // Add every new type; Spread is offered because Net Revenue allows percentiles.
  for (const type of ['Ranked bar', 'Line', 'Heatmap', 'Scatter', 'Spread']) {
    await listButton.click();
    await page.getByRole('menuitem', { name: 'Add chart' }).click();
    await page.getByRole('menuitemradio', { name: type }).click();
  }
  await expect(data(page).locator('section.dm-chart')).toHaveCount(7);
  for (const kind of ['Ranked bar', 'Line', 'Heatmap', 'Scatter', 'Spread']) {
    await expect(data(page).locator(`section[data-chart-kind="${kind}"] svg[role]`)).toBeVisible();
  }
  // The charts scroll inside the band: lift every clip on the way up so one picture shows them all, then put it back.
  const restore = await data(page).locator('section[data-chart-kind="Spread"]').evaluate((el) => {
    const saved: [HTMLElement, string][] = [];
    for (let e = el.parentElement; e && e.id !== 'band-data'; e = e.parentElement) {
      saved.push([e, e.getAttribute('style') ?? '']);
      e.style.overflow = 'visible'; e.style.height = 'auto'; e.style.maxHeight = 'none';
    }
    (window as unknown as { __restore: () => void }).__restore = () => saved.forEach(([e, st]) => e.setAttribute('style', st));
    return true;
  });
  expect(restore).toBe(true);
  await page.screenshot({ path: 'tmp/chart-list-all.png', fullPage: true });
  await page.evaluate(() => (window as unknown as { __restore: () => void }).__restore());

  // Line: a second measure draws a right axis.
  // A menu closes when the page scrolls, so bring each panel's button into view before opening it.
  const optionsOf = async (name: string) => {
    const button = data(page).getByRole('button', { name: `${name} options` });
    await button.scrollIntoViewIfNeeded();
    await button.click();
  };
  await optionsOf('Line');
  await page.getByRole('menuitem', { name: 'Second measure' }).click();
  await page.getByRole('menuitemradio', { name: /Net Revenue/ }).click();
  await expect(data(page).locator('section[data-chart-kind="Line"] [data-axis="right"]').first()).toBeVisible();

  // Switch the ranked bar to a pie.
  await optionsOf('Ranked bar');
  await page.getByRole('menuitem', { name: 'Chart type' }).click();
  await page.getByRole('menuitemradio', { name: 'Pie' }).click();
  await expect(data(page).locator('section[data-chart-kind="Pie"]')).toHaveCount(2);

  // Hide the scatter from the header list, then remove the heatmap.
  await listButton.click();
  await page.getByRole('menuitemcheckbox', { name: /vs .* per / }).click();
  await page.keyboard.press('Escape');
  await expect(data(page).locator('section[data-chart-kind="Scatter"]')).toHaveCount(0);
  await optionsOf('Heatmap');
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(data(page).locator('section[data-chart-kind="Heatmap"]')).toHaveCount(0);

  // The list survives a trip to Table and back (the mock keeps settings in memory, so a reload would reset them).
  await data(page).getByRole('radio', { name: 'Table' }).click();
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  await expect(data(page).locator('section.dm-chart')).toHaveCount(5);
});

test('Copy to clipboard copies a PNG when the clipboard is allowed', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openCharts(page, [/created_at/i]);
  // Copy before the pie has drawn says "Nothing to copy yet": wait for it.
  await expect(data(page).locator('section[data-chart-kind="Pie"] svg[role]')).toBeVisible();
  await data(page).getByRole('button', { name: 'Pie options' }).click();
  await page.getByRole('menuitem', { name: 'Copy to clipboard' }).click();
  await expect(page.getByText('Chart copied')).toBeVisible();
  const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => i.types));
  expect(types).toContain('image/png');
});
