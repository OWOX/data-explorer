import { expect, test, type Locator, type Page } from '@playwright/test';
import { openFields, closeConfig, groupTitles, configButton } from './config-menu';

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });
const data = (page: Page) => page.locator('#band-data');

test('add a Sankey from Add chart, a many-to-one joined column draws, a fan-out column says why it cannot sum, filter by a node', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  // A third dimension: Customers joins its name; is_gift is Orders' boolean.
  await page.locator('#band-marts').getByText('Customers', { exact: true }).first().click();
  await expect(groupTitles(page).filter({ hasText: 'Customers' })).toHaveCount(1);
  for (const name of ['is_gift', /created_at/i]) {
    await openFields(page, 'Orders');
    await page.getByRole('option', { name }).click();
    await closeConfig(page);
  }
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  await expect(data(page).locator('section.dm-chart')).toHaveCount(2);

  await configButton(page).click();
  await page.getByRole('menuitem', { name: 'Add chart' }).click();
  await page.getByRole('menuitemradio', { name: 'Sankey' }).click();
  const sankey = data(page).locator('section[data-chart-kind="Sankey"]');
  await expect(sankey.locator('path[data-link]').first()).toBeVisible();
  await expect(sankey.locator('text.dm-chart-axis-title')).toHaveCount(2);

  await sankey.scrollIntoViewIfNeeded();
  await sankey.getByRole('button', { name: 'Sankey options' }).click();
  await page.getByRole('menuitem', { name: 'Columns' }).click();
  await page.getByRole('menuitem', { name: 'Column 3' }).click();
  await page.getByRole('menuitem', { name: 'Customers' }).click();
  await page.getByRole('menuitemradio', { name: 'Name' }).click();
  // The third column is Customers' name, a many-to-one lookup: Orders' metric still counts each order once, so it draws.
  await expect(sankey.locator('text.dm-chart-axis-title')).toHaveCount(3);
  await expect(sankey.locator('path[data-link]').first()).toBeVisible();
  await sankey.getByRole('button', { name: 'Sankey options' }).click();
  await page.getByRole('menuitem', { name: 'Columns' }).click();
  await page.getByRole('menuitem', { name: 'Column 3' }).click();
  await page.getByRole('menuitemradio', { name: 'None' }).click();
  await expect(sankey.locator('text.dm-chart-axis-title')).toHaveCount(2);
  await expect(sankey.locator('path[data-link]').first()).toBeVisible();
  await sankey.screenshot({ path: 'tmp/sankey-e2e.png' });

  // A node click filters the grid to that value: the Sankey is still drawn, narrowed to it.
  const before = await sankey.locator('rect[data-node]').count();
  await sankey.locator('rect[data-node][role="button"]').first().click();
  await expect.poll(() => sankey.locator('rect[data-node]').count()).toBeLessThan(before);
});

test('a column of a one-to-many joined mart says why it cannot sum', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  // Shipments hang several rows on one order: Orders' metric would count an order once per shipment.
  await page.locator('#band-marts').getByText('Shipments', { exact: true }).first().click();
  await expect(groupTitles(page).filter({ hasText: 'Shipments' })).toHaveCount(1);
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  await configButton(page).click();
  await page.getByRole('menuitem', { name: 'Add chart' }).click();
  await page.getByRole('menuitemradio', { name: 'Sankey' }).click();
  const sankey = data(page).locator('section[data-chart-kind="Sankey"]');
  await expect(sankey.getByText(/joined one-to-one/)).toBeVisible();
  await expect(sankey.locator('path[data-link]')).toHaveCount(0);
});

for (const height of [900, 700]) {
  test(`the four-level Columns menu stays inside a 1440x${height} viewport and every level is reachable by mouse`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height });
    await expect(data(page).getByRole('row')).toHaveCount(202);
    await page.locator('#band-marts').getByText('Customers', { exact: true }).first().click();
    await expect(groupTitles(page).filter({ hasText: 'Customers' })).toHaveCount(1);
    await openFields(page, 'Orders');
    await page.getByRole('option', { name: 'is_gift' }).click();
    await closeConfig(page);
    await data(page).getByRole('radio', { name: 'Charts' }).click();
    await configButton(page).click();
    await page.getByRole('menuitem', { name: 'Add chart' }).click();
    await page.getByRole('menuitemradio', { name: 'Sankey' }).click();
    const sankey = data(page).locator('section[data-chart-kind="Sankey"]');
    await expect(sankey.locator('path[data-link]').first()).toBeVisible();
    await sankey.scrollIntoViewIfNeeded();
    await sankey.getByRole('button', { name: 'Sankey options' }).click();
    // Each panel, the Sankey menu itself included, sits inside the viewport and shows all its rows (it does not scroll).
    const inside = async (name: string) => {
      const panel = page.getByRole('menu', { name });
      await expect(panel).toBeVisible();
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1440);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      expect(await panel.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    };
    await inside('Sankey menu');
    // Each level opens on a click.
    for (const name of ['Columns', 'Column 3', 'Customers']) {
      await page.getByRole('menuitem', { name }).click();
      await inside(name);
    }
    // The field is clicked by the mouse: it picks it and closes the menu.
    await page.getByRole('menu', { name: 'Customers' }).getByRole('menuitemradio', { name: 'Name' }).click();
    await expect(sankey.locator('text.dm-chart-axis-title')).toHaveCount(3);
  });
}

test('None on Column 2 of a two-column Sankey shows a notice instead of the drawing, and picking a column draws it again', async ({ page }) => {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await page.locator('#band-marts').getByText('Customers', { exact: true }).first().click();
  await expect(groupTitles(page).filter({ hasText: 'Customers' })).toHaveCount(1);
  await openFields(page, 'Orders');
  await page.getByRole('option', { name: 'is_gift' }).click();
  await closeConfig(page);
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  await configButton(page).click();
  await page.getByRole('menuitem', { name: 'Add chart' }).click();
  await page.getByRole('menuitemradio', { name: 'Sankey' }).click();
  const sankey = data(page).locator('section[data-chart-kind="Sankey"]');
  await expect(sankey.locator('path[data-link]').first()).toBeVisible();
  const options = sankey.getByRole('button', { name: 'Sankey options' });
  await sankey.scrollIntoViewIfNeeded();
  await options.click();
  await page.getByRole('menuitem', { name: 'Columns' }).click();
  await page.getByRole('menuitem', { name: 'Column 2' }).click();
  await page.getByRole('menuitemradio', { name: 'None' }).click();
  await expect(sankey.getByText('This Sankey is misconfigured: pick at least 2 columns in its menu.')).toBeVisible();
  await expect(sankey.locator('path[data-link]')).toHaveCount(0);
  // The menu is still on the panel: Column 2 picks a dimension again and the chart draws.
  await options.click();
  await page.getByRole('menuitem', { name: 'Columns' }).click();
  await page.getByRole('menuitem', { name: 'Column 2' }).click();
  await page.getByRole('menuitem', { name: 'Customers' }).click();
  await page.getByRole('menu', { name: 'Customers' }).getByRole('menuitemradio', { name: 'Name' }).click();
  await expect(sankey.locator('path[data-link]').first()).toBeVisible();
  await expect(sankey.getByText(/misconfigured/)).toHaveCount(0);
});

test('a node tooltip opens on the right, reads name: value (x%) with no fraction above 10, can be entered and copied without filtering the grid', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await page.locator('#band-marts').getByText('Customers', { exact: true }).first().click();
  await expect(groupTitles(page).filter({ hasText: 'Customers' })).toHaveCount(1);
  await openFields(page, 'Orders');
  await page.getByRole('option', { name: 'is_gift' }).click();
  await closeConfig(page);
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  await configButton(page).click();
  await page.getByRole('menuitem', { name: 'Add chart' }).click();
  await page.getByRole('menuitemradio', { name: 'Sankey' }).click();
  const sankey = data(page).locator('section[data-chart-kind="Sankey"]');
  await expect(sankey.locator('path[data-link]').first()).toBeVisible();
  await sankey.scrollIntoViewIfNeeded();
  const nodes = sankey.locator('rect[data-node]');
  const nodeCount = await nodes.count();
  const rowsBefore = await data(page).getByRole('row').count();

  const node = nodes.first();
  await node.hover();
  const bubble = page.locator('.dm-hint-body');
  await expect(bubble).toBeVisible();
  const [n, b] = [(await node.boundingBox())!, (await bubble.boundingBox())!];
  // To the right of the node, or flipped to its left when there is no room on the right.
  const right = b.x >= n.x + n.width - 1;
  const left = b.x + b.width <= n.x + 1;
  expect(right || left).toBe(true);
  expect(await bubble.getAttribute('data-side')).toBe(right ? 'right' : 'left');
  const text = (await page.getByRole('tooltip').textContent())!;
  expect(text).toMatch(/^.+: [^(]+ \(\d+%\)$/);
  // The mock's sums are in the hundreds: no fraction on them.
  const value = text.replace(/ \(\d+%\)$/, '').split(': ').pop()!;
  if (Number(value.replace(/,/g, '')) > 10) expect(value).not.toMatch(/[.,]\d{1,2}$|\.\d/);

  // The pointer crosses to the bubble (over other nodes and ribbons on the way) and the bubble stays.
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.waitForTimeout(500);
  await expect(bubble).toBeVisible();
  expect(await page.getByRole('tooltip').textContent()).toBe(text);

  // Copy puts exactly the text on the clipboard, keeps the bubble, and does not filter the grid or the chart.
  await bubble.getByRole('button', { name: 'Copy to clipboard' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  await expect(bubble).toBeVisible();
  await expect(sankey.locator('rect[data-node]')).toHaveCount(nodeCount);
  expect(await data(page).getByRole('row').count()).toBe(rowsBefore);

  // Leaving the bubble closes it; Escape closes a reopened one.
  await page.mouse.move(5, 5, { steps: 6 });
  await expect(bubble).toHaveCount(0);
  await node.hover();
  await expect(bubble).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bubble).toHaveCount(0);
});

// The hoverable bubbles let go: what the pointer rests on next gets its own tooltip.
async function openSankey(page: Page) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await expect(data(page).getByRole('row')).toHaveCount(202);
  await page.locator('#band-marts').getByText('Customers', { exact: true }).first().click();
  await expect(groupTitles(page).filter({ hasText: 'Customers' })).toHaveCount(1);
  await openFields(page, 'Orders');
  await page.getByRole('option', { name: 'is_gift' }).click();
  await closeConfig(page);
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  await configButton(page).click();
  await page.getByRole('menuitem', { name: 'Add chart' }).click();
  await page.getByRole('menuitemradio', { name: 'Sankey' }).click();
  const sankey = data(page).locator('section[data-chart-kind="Sankey"]');
  await expect(sankey.locator('path[data-link]').first()).toBeVisible();
  await sankey.scrollIntoViewIfNeeded();
  return sankey;
}
/** A point a ribbon really answers at, as far right as the chart goes (clear of the bubble of a node in the first column). */
const ribbonPoint = (page: Page) => page.evaluate(() => {
  let best: { x: number; y: number } | null = null;
  for (const el of document.querySelectorAll('path[data-link]')) {
    const r = el.getBoundingClientRect();
    for (let i = 0; i <= 30; i++) for (let j = 0; j <= 12; j++) {
      const x = r.left + (r.width * i) / 30, y = r.top + (r.height * j) / 12;
      if (document.elementFromPoint(x, y) === el && (!best || x > best.x)) best = { x, y };
    }
  }
  return best;
});
const tipText = (page: Page) => page.getByRole('tooltip').textContent();
const centre = async (el: Locator) => { const b = (await el.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

test('the tooltip of the next node, then of a ribbon, replaces the last bubble once the pointer rests there', async ({ page }) => {
  const sankey = await openSankey(page);
  const bubble = page.locator('.dm-hint-body');
  const first = sankey.locator('rect[data-node^="0|"]').first();
  const second = sankey.locator('rect[data-node^="1|"]').first();
  // What the second node says when nothing else is open.
  await page.mouse.move(...(Object.values(await centre(second)) as [number, number]));
  await expect(bubble).toBeVisible();
  const want = (await tipText(page))!;
  await page.mouse.move(5, 5, { steps: 5 });
  await expect(bubble).toHaveCount(0, { timeout: 1500 });
  const wantFirst = await (async () => { await first.hover(); await expect(bubble).toBeVisible(); return (await tipText(page))!; })();
  expect(wantFirst).not.toBe(want);

  // Rest on the first, move to the second and rest: the second's text.
  await page.mouse.move(5, 5, { steps: 5 });
  await expect(bubble).toHaveCount(0, { timeout: 1500 });
  await first.hover();
  await expect(bubble).toBeVisible();
  expect(await tipText(page)).toBe(wantFirst);
  const to = await centre(second);
  await page.mouse.move(to.x, to.y, { steps: 20 });
  await expect.poll(() => tipText(page).catch(() => null), { timeout: 1500 }).toBe(want);
  await page.waitForTimeout(400);
  expect(await tipText(page)).toBe(want);
  await expect(bubble).toHaveCount(1);

  // Rest on a ribbon: the ribbon's plain tooltip, on top, with no copy button.
  await page.mouse.move(5, 5, { steps: 5 });
  await expect(bubble).toHaveCount(0, { timeout: 1500 });
  const at = (await ribbonPoint(page))!;
  expect(at).not.toBeNull();
  await first.hover();
  await expect(bubble).toBeVisible();
  await page.mouse.move(at.x, at.y, { steps: 20 });
  await expect.poll(() => tipText(page).catch(() => ''), { timeout: 1500 }).toMatch(/→/);
  await page.waitForTimeout(400);
  expect(await tipText(page)).toMatch(/→/);
  await expect(bubble).toHaveCount(1);
  expect(await bubble.getAttribute('data-side')).toBe('top');
  await expect(bubble.getByRole('button', { name: 'Copy to clipboard' })).toHaveCount(0);
});

test('a node bubble lets go within a second; slow and diagonal moves to it keep it and Copy works; the bubble takes the pointer', async ({ page }) => {
  const sankey = await openSankey(page);
  const bubble = page.locator('.dm-hint-body');
  const node = sankey.locator('rect[data-node^="0|"]').first();
  await node.hover();
  await expect(bubble).toBeVisible();
  expect(await bubble.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('auto');
  const text = (await tipText(page))!;
  const n = (await node.boundingBox())!;
  const b = (await bubble.boundingBox())!;
  expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.dm-hint-body'), { x: b.x + b.width / 2, y: b.y + b.height / 2 })).toBe(true);

  // Slow: 25 steps with a pause between them.
  await page.mouse.move(n.x + n.width / 2, n.y + n.height / 2);
  for (let i = 1; i <= 25; i++) {
    await page.mouse.move(n.x + n.width / 2 + ((b.x + 6 - n.x - n.width / 2) * i) / 25, n.y + n.height / 2 + ((b.y + b.height / 2 - n.y - n.height / 2) * i) / 25);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(400);
  await expect(bubble).toBeVisible();
  await bubble.getByRole('button', { name: 'Copy to clipboard' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);

  // Diagonal, from the far corner of the node to the far corner of the bubble.
  await page.mouse.move(5, 5, { steps: 5 });
  await expect(bubble).toHaveCount(0, { timeout: 1500 });
  await page.mouse.move(n.x + 1, n.y + n.height - 1);
  await expect(bubble).toBeVisible();
  const b2 = (await bubble.boundingBox())!;
  await page.mouse.move(b2.x + b2.width - 3, b2.y + 3, { steps: 8 });
  await page.waitForTimeout(500);
  await expect(bubble).toBeVisible();
  await bubble.getByRole('button', { name: 'Copy to clipboard' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);

  // Away from both: gone within about a second.
  await page.mouse.move(5, 5, { steps: 6 });
  await expect(bubble).toHaveCount(0, { timeout: 1000 });
});

test('a long node bubble stays inside a 500px wide viewport with its Copy button', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 900 });
  const sankey = await openSankey(page);
  const node = sankey.locator('rect[data-node^="0|"]').first();
  await node.hover();
  const bubble = page.locator('.dm-hint-body');
  await expect(bubble).toBeVisible();
  // The mock has no long names: lengthen the shown text in place.
  await bubble.evaluate((el) => { const t = el.querySelector('.dm-tip-copyrow > span')!; t.textContent = `${'A very long customer segment name '.repeat(8)}: $9,299 (23%)`; });
  await page.waitForTimeout(200);
  const b = (await bubble.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(500);
  const c = (await bubble.getByRole('button', { name: 'Copy to clipboard' }).boundingBox())!;
  expect(c.x).toBeGreaterThanOrEqual(0);
  expect(c.x + c.width).toBeLessThanOrEqual(500);
});
