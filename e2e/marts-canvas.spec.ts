import { expect, test } from '@playwright/test';
import { openFields } from './config-menu';

test('canvas: add marts through ghosts, move countries from customers to stores, undo', async ({ page }) => {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  await marts.getByRole('radio', { name: 'Graph' }).click();
  await expect(marts.locator('article#dm-orders')).toBeVisible();

  // Add customers and stores through the main card's ghosts, then countries through customers.
  await marts.locator('article#dm-orders [data-join-plus]').click();
  await marts.locator('article[data-ghost][data-mart-id="customers"]').click();
  await expect(marts.locator('article[data-ghost][data-mart-id="customers"]')).toHaveCount(0);
  // The added card is selected and its own ghosts wait for its (+).
  await page.keyboard.press('Escape');
  await marts.locator('article#dm-orders [data-join-plus]').click();
  await expect(marts.locator('article[data-ghost][data-mart-id="stores"]')).toBeVisible();
  await marts.locator('article[data-ghost][data-mart-id="stores"]').click();
  await expect(marts.locator('article[data-ghost][data-mart-id="stores"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await marts.locator('[id="dm-customers@customers"] [data-join-plus]').click();
  await expect(marts.locator('article[data-ghost][data-mart-id="countries"]')).toBeVisible();
  await marts.locator('article[data-ghost][data-mart-id="countries"]').click();
  await expect(page.locator('#tree-wires path[data-from="dm-customers@customers"][data-to="dm-countries@customers.countries"]')).toHaveCount(1);
  await expect(page.locator('#band-data th[data-group="countries"]')).toHaveCount(1);

  // Drag countries onto stores: a dashed line shows while dragging.
  const from = await marts.locator('[id="dm-countries@customers.countries"]').boundingBox();
  const to = await marts.locator('[id="dm-stores@stores"]').boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + from!.width / 2 + 10, from!.y + from!.height / 2 + 10, { steps: 4 });
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 6 });
  // One dashed line to the other target (stores), drawn stronger as the closest.
  await expect(marts.locator('svg#drag-line path')).toHaveCount(1);
  await expect(marts.locator('svg#drag-line path.closest')).toHaveAttribute('data-target', 'stores');
  const card = (id: string) => marts.locator(`[id="dm-${id}"]`);
  await expect(card('orders')).toHaveClass(/dm-faded/);
  await expect(card('stores@stores')).not.toHaveClass(/dm-faded/);
  await expect(card('customers@customers')).not.toHaveClass(/dm-faded/);
  // The tree wire to the mart it hangs from now is the one solid line; the other target gets a dashed one.
  await expect(page.locator('#tree-wires path[data-from="dm-customers@customers"][data-to="dm-countries@customers.countries"]')).toHaveCount(1);
  await expect(marts.locator('svg#drag-line path.joined')).toHaveCount(0);
  await expect(marts.locator('svg#drag-line path.ghost')).toHaveAttribute('data-target', 'stores');
  await page.mouse.up();
  await expect(marts.locator('svg#drag-line')).toHaveCount(0);

  // Countries now hangs from stores: its tree wire comes from dm-stores.
  await expect(page.locator('#tree-wires path[data-from="dm-stores@stores"][data-to="dm-countries@stores.countries"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#tree-wires path[data-from="dm-customers@customers"][data-to="dm-countries@customers.countries"]')).toHaveCount(1);
});

test('canvas: Countries under both Customers and Stores, × on a middle card keeps its leaf, Undo restores it', async ({ page }) => {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  const data = page.locator('#band-data');
  await marts.getByRole('radio', { name: 'Graph' }).click();
  await marts.locator('article#dm-orders [data-join-plus]').click();
  await marts.locator('article[data-ghost][data-mart-id="customers"]').click();
  await page.keyboard.press('Escape');
  await marts.locator('article#dm-orders [data-join-plus]').click();
  await marts.locator('article[data-ghost][data-mart-id="stores"]').click();
  await page.keyboard.press('Escape');
  for (const parent of ['customers', 'stores']) {
    await marts.locator(`[id="dm-${parent}@${parent}"] [data-join-plus]`).click();
    await marts.locator('article[data-ghost][data-mart-id="countries"]').click();
    await expect(marts.locator(`[id="dm-countries@${parent}.countries"]`)).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await expect(marts.locator('article[data-mart-id="countries"]:not([data-ghost])')).toHaveCount(2);
  await expect(data.locator('th[data-group="countries"]')).toHaveCount(2);

  await page.mouse.move(0, 0);
  await marts.locator('[id="dm-stores@stores"]').getByRole('button', { name: 'Remove Stores from the report' }).click();
  // Stores loses its own columns but stays as a bare card, joined, with Countries under it still showing its columns.
  await expect(data.locator('th[data-group="stores"]')).toHaveCount(0);
  await expect(marts.locator('[id="dm-stores@stores"]')).toBeVisible();
  await expect(marts.locator('[id="dm-countries@stores.countries"]')).toBeVisible();
  await expect(data.locator('th[data-group="countries"]')).toHaveCount(2);
  // The × on the bare card takes its whole subtree.
  await marts.locator('[id="dm-stores@stores"]').getByRole('button', { name: 'Remove Stores from the report' }).click();
  await expect(marts.locator('[id="dm-stores@stores"]')).toHaveCount(0);
  await expect(marts.locator('[id="dm-countries@stores.countries"]')).toHaveCount(0);
  await expect(data.locator('th[data-group="countries"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(marts.locator('[id="dm-stores@stores"]')).toBeVisible();
  await expect(data.locator('th[data-group="countries"]')).toHaveCount(2);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(marts.locator('[id="dm-stores@stores"]')).toBeVisible();
  await expect(marts.locator('[id="dm-countries@stores.countries"]')).toBeVisible();
  await expect(data.locator('th[data-group="countries"]')).toHaveCount(2);
  await page.mouse.move(0, 0);
});

test('grid: Remove from report on a middle mart takes only its own columns; the Countries behind it keep theirs', async ({ page }) => {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  const data = page.locator('#band-data');
  await marts.getByRole('radio', { name: 'Graph' }).click();
  await marts.locator('article#dm-orders [data-join-plus]').click();
  await marts.locator('article[data-ghost][data-mart-id="customers"]').click();
  await page.keyboard.press('Escape');
  await expect(marts.locator('[id="dm-customers@customers"]')).toBeVisible();
  await page.mouse.move(0, 0);
  await marts.locator('[id="dm-customers@customers"] [data-join-plus]').click();
  await expect(marts.locator('article[data-ghost][data-mart-id="countries"]')).toBeVisible();
  await marts.locator('article[data-ghost][data-mart-id="countries"]').click();
  await page.keyboard.press('Escape');
  await expect(data.locator('th[data-group="countries"]')).toHaveCount(1);
  await expect(data.locator('th[data-group="customers"]')).toHaveCount(1);

  // Remove from report, in the config menu, takes only the mart's own place and columns.
  const customers = await openFields(page, 'Customers');
  await customers.getByRole('menuitem', { name: 'Remove from report' }).click();
  await expect(data.locator('th[data-group="customers"]')).toHaveCount(0);
  await expect(data.locator('th[data-group="countries"]')).toHaveCount(1);
  // Customers stays on the canvas as a bare card, joined, with Countries under it.
  await expect(marts.locator('[id="dm-customers@customers"]')).toBeVisible();
  await expect(marts.locator('[id="dm-countries@customers.countries"]')).toBeVisible();
  await page.mouse.move(0, 0);
});

test('canvas: hovering a card shows no ghosts; its (+) sits on the middle of the right edge, opaque and unclipped, and a click keeps the ghosts', async ({ page }) => {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  await marts.getByRole('radio', { name: 'Graph' }).click();
  const card = marts.locator('article#dm-orders');
  const plus = card.locator('[data-join-plus]');
  await expect(card).toBeVisible();
  await expect(plus).toHaveCSS('opacity', '0');
  await card.hover({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(600);
  await expect(marts.locator('article[data-ghost]')).toHaveCount(0);
  await expect(plus).toHaveCSS('opacity', '1');
  await expect(plus).toHaveCSS('background-color', /rgb\(/);

  // Centred on the right edge, middle of its height, 19.2px, and as big as the ×'s corner control.
  const box = (await card.boundingBox())!;
  const dot = (await plus.boundingBox())!;
  expect(dot.width).toBeCloseTo(19.2, 0);
  expect(dot.height).toBeCloseTo(19.2, 0);
  expect(Math.abs(dot.x + dot.width / 2 - (box.x + box.width))).toBeLessThanOrEqual(1.5);
  expect(Math.abs(dot.y + dot.height / 2 - (box.y + box.height / 2))).toBeLessThanOrEqual(1.5);
  // Nothing clips it: the element at its centre is the (+) itself.
  const atCentre = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-join-plus]') !== null, [dot.x + dot.width / 2, dot.y + dot.height / 2]);
  expect(atCentre).toBe(true);

  await plus.click();
  await expect(marts.locator('article[data-ghost]').first()).toBeVisible();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(600);
  await expect(marts.locator('article[data-ghost]').first()).toBeVisible();
  await expect(plus).toHaveAttribute('aria-expanded', 'true');
  await expect(plus).toHaveCSS('opacity', '1');
  await plus.click();
  await expect(marts.locator('article[data-ghost]')).toHaveCount(0);
});

test('canvas: hover and focus on a (+) open nothing; a click opens its ghosts, a second click or Escape closes them, another card\'s (+) moves them', async ({ page }) => {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  await marts.getByRole('radio', { name: 'Graph' }).click();
  const ghosts = marts.locator('article[data-ghost]');
  const plus = marts.locator('article#dm-orders [data-join-plus]');
  await plus.hover();
  await plus.focus();
  await page.waitForTimeout(600);
  await expect(ghosts).toHaveCount(0);
  await expect(plus).toHaveAttribute('aria-expanded', 'false');

  await plus.click();
  await expect(ghosts.first()).toBeVisible();
  await expect(plus).toHaveAttribute('aria-expanded', 'true');
  await plus.click();
  await expect(ghosts).toHaveCount(0);
  await plus.click();
  await expect(ghosts.first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(ghosts).toHaveCount(0);

  // A ghost click adds the card and selects it; its own ghosts wait for its (+).
  await plus.click();
  await marts.locator('article[data-ghost][data-mart-id="customers"]').click();
  const customers = marts.locator('[id="dm-customers@customers"]');
  await expect(customers).toHaveAttribute('data-focused', '');
  await page.waitForTimeout(300);
  await expect(ghosts).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Make it main/ })).toBeVisible();

  // Another card's (+) moves the ghosts there, and hovering the first card's (+) changes nothing.
  await customers.locator('[data-join-plus]').click();
  await expect(marts.locator('article[data-ghost][data-mart-id="countries"]')).toBeVisible();
  await plus.hover();
  await page.waitForTimeout(600);
  await expect(marts.locator('article[data-ghost][data-mart-id="countries"]')).toBeVisible();
  await expect(marts.locator('article[data-ghost][data-mart-id="products"]')).toHaveCount(0);
  await plus.click();
  await expect(marts.locator('article[data-ghost][data-mart-id="products"]')).toBeVisible();
  await expect(marts.locator('article[data-ghost][data-mart-id="countries"]')).toHaveCount(0);
});

test('canvas: the dimming holds on a card the pointer reached across the gap, and a blur does not undo what the pointer holds', async ({ page }) => {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  await marts.getByRole('radio', { name: 'Graph' }).click();
  for (const id of ['customers', 'stores']) {
    await marts.locator('article#dm-orders [data-join-plus]').click();
    await marts.locator(`article[data-ghost][data-mart-id="${id}"]`).click();
    await page.keyboard.press('Escape');
  }
  const customers = marts.locator('[id="dm-customers@customers"]');
  const stores = marts.locator('[id="dm-stores@stores"]');
  await expect(stores).toBeVisible();
  await page.mouse.move(0, 0);

  // From one card across the gap to another: 600 ms at rest on the second, the first is still dimmed.
  await customers.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const a = (await customers.boundingBox())!;
  const b = (await stores.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.move((a.x + b.x) / 2 + a.width / 2, (a.y + b.y) / 2 + a.height / 2, { steps: 3 });
  await page.waitForTimeout(100);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
  await page.waitForTimeout(600);
  await expect(customers).toHaveClass(/dm-faded/);

  // Focus on one card's (+), the pointer on another, a click there: the pointer's dimming holds.
  await customers.locator('[data-join-plus]').focus();
  await page.mouse.move(b.x + b.width / 2 + 1, b.y + b.height / 2 + 1);
  await stores.click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(600);
  await expect(customers).toHaveClass(/dm-faded/);
});

test('canvas: the (+) of a ghost adds its level on a click only, a second click closes it, and the open ghosts stay wherever the pointer goes', async ({ page }) => {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  await marts.getByRole('radio', { name: 'Graph' }).click();
  const ghost = (id: string) => marts.locator(`article[data-ghost][data-mart-id="${id}"]`);
  await marts.locator('article#dm-orders [data-join-plus]').click();
  const plus = ghost('customers').locator('[data-join-plus]');
  await plus.hover();
  await plus.focus();
  await page.waitForTimeout(600);
  await expect(ghost('countries')).toHaveCount(0);
  await plus.click();
  await expect(ghost('countries')).toBeVisible();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(600);
  await expect(ghost('countries')).toBeVisible();
  await expect(ghost('customers')).toBeVisible();
  await plus.click();
  await expect(ghost('countries')).toHaveCount(0);
  await expect(ghost('customers')).toBeVisible();
});

test('canvas: a still pointer over a joined card\'s (+) never opens or closes the ghosts as the page grows or shrinks', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  await marts.getByRole('radio', { name: 'Graph' }).click();
  const ghosts = marts.locator('article[data-ghost]');
  await marts.locator('article#dm-orders [data-join-plus]').click();
  await marts.locator('article[data-ghost][data-mart-id="customers"]').click();
  const plus = marts.locator('[id="dm-customers@customers"] [data-join-plus]');
  await plus.click();
  await expect(ghosts.first()).toBeVisible();
  // Scrolled down while they show, then closed: the page shrinks under the pointer.
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight));
  await plus.click();
  await expect(ghosts).toHaveCount(0);
  const counts: number[] = [];
  for (let i = 0; i < 12; i++) { counts.push(await ghosts.count()); await page.waitForTimeout(100); }
  expect(counts.every((n) => n === 0)).toBe(true);
});
