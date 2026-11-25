import { expect, test } from '@playwright/test';

test('canvas: add marts through ghosts, move countries from customers to stores, undo', async ({ page }) => {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  await marts.getByRole('radio', { name: 'Graph' }).click();
  await expect(marts.locator('article#dm-orders')).toBeVisible();

  // Add customers and stores through the main card's ghosts, then countries through customers.
  await marts.locator('article#dm-orders [data-join-plus]').hover();
  await marts.locator('article[data-ghost][data-mart-id="customers"]').click();
  await expect(marts.locator('article[data-ghost][data-mart-id="customers"]')).toHaveCount(0);
  // The added card is pinned and shows its own ghosts: Escape lets the pin go.
  await page.keyboard.press('Escape');
  await marts.locator('article#dm-orders [data-join-plus]').hover();
  await expect(marts.locator('article[data-ghost][data-mart-id="stores"]')).toBeVisible();
  await marts.locator('article[data-ghost][data-mart-id="stores"]').click();
  await expect(marts.locator('article[data-ghost][data-mart-id="stores"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await marts.locator('[id="dm-customers@customers"] [data-join-plus]').hover();
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
  await marts.locator('article#dm-orders [data-join-plus]').hover();
  await marts.locator('article[data-ghost][data-mart-id="customers"]').click();
  await page.keyboard.press('Escape');
  await marts.locator('article#dm-orders [data-join-plus]').hover();
  await marts.locator('article[data-ghost][data-mart-id="stores"]').click();
  await page.keyboard.press('Escape');
  for (const parent of ['customers', 'stores']) {
    await marts.locator(`[id="dm-${parent}@${parent}"] [data-join-plus]`).hover();
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

test('grid: the × on a middle mart header takes only its own columns; the Countries behind it keep theirs', async ({ page }) => {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  const data = page.locator('#band-data');
  await marts.getByRole('radio', { name: 'Graph' }).click();
  await marts.locator('article#dm-orders [data-join-plus]').hover();
  await marts.locator('article[data-ghost][data-mart-id="customers"]').click();
  await page.keyboard.press('Escape');
  await expect(marts.locator('[id="dm-customers@customers"]')).toBeVisible();
  await page.mouse.move(0, 0);
  await marts.locator('[id="dm-customers@customers"] [data-join-plus]').hover();
  await expect(marts.locator('article[data-ghost][data-mart-id="countries"]')).toBeVisible();
  await marts.locator('article[data-ghost][data-mart-id="countries"]').click();
  await page.keyboard.press('Escape');
  await expect(data.locator('th[data-group="countries"]')).toHaveCount(1);
  await expect(data.locator('th[data-group="customers"]')).toHaveCount(1);

  await data.locator('th[data-group="customers"]').hover();
  await data.getByRole('button', { name: 'Remove Customers from the grid' }).click();
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

test('canvas: focus on a (+) shows its ghosts and blur lets them go; a pinned card yields to another card\'s (+) while it is hovered', async ({ page }) => {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  await marts.getByRole('radio', { name: 'Graph' }).click();
  const plus = marts.locator('article#dm-orders [data-join-plus]');
  await plus.focus();
  await expect(marts.locator('article[data-ghost]').first()).toBeVisible();
  await plus.evaluate((n) => (n as HTMLElement).blur());
  await expect(marts.locator('article[data-ghost]')).toHaveCount(0);

  await plus.hover();
  await marts.locator('article[data-ghost][data-mart-id="customers"]').click();
  await expect(marts.locator('article[data-ghost][data-mart-id="countries"]')).toBeVisible();
  await plus.hover();
  await expect(marts.locator('article[data-ghost][data-mart-id="products"]')).toBeVisible();
  await expect(marts.locator('article[data-ghost][data-mart-id="countries"]')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await expect(marts.locator('article[data-ghost][data-mart-id="countries"]')).toBeVisible();
  await expect(marts.locator('article[data-ghost][data-mart-id="products"]')).toHaveCount(0);
});

test('canvas: the dimming holds on a card the pointer reached across the gap, and a blur does not undo what the pointer holds', async ({ page }) => {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  await marts.getByRole('radio', { name: 'Graph' }).click();
  for (const id of ['customers', 'stores']) {
    await marts.locator('article#dm-orders [data-join-plus]').hover();
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

test('canvas: the (+) of a ghost of a pinned card adds its level by hover and by focus; the pin\'s own ghosts stay after it', async ({ page }) => {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  await marts.getByRole('radio', { name: 'Graph' }).click();
  const ghost = (id: string) => marts.locator(`article[data-ghost][data-mart-id="${id}"]`);
  await marts.locator('article#dm-orders [data-join-plus]').click();
  await ghost('customers').hover({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(100);
  await expect(ghost('countries')).toHaveCount(0);
  await ghost('customers').locator('[data-join-plus]').hover();
  await expect(ghost('countries')).toBeVisible();
  // It stays while the pointer crosses to it and rests there.
  await ghost('countries').hover({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(600);
  await expect(ghost('countries')).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(ghost('countries')).toHaveCount(0);
  await expect(ghost('customers')).toBeVisible();

  const plus = ghost('customers').locator('[data-join-plus]');
  await plus.focus();
  await expect(ghost('countries')).toBeVisible();
  await plus.evaluate((n) => (n as HTMLElement).blur());
  await expect(ghost('countries')).toHaveCount(0);
  await expect(ghost('customers')).toBeVisible();
});

test('canvas: after Escape or a second click the (+) under a still pointer shows nothing until the pointer has left it', async ({ page }) => {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  await marts.getByRole('radio', { name: 'Graph' }).click();
  const ghosts = marts.locator('article[data-ghost]');
  const plus = marts.locator('article#dm-orders [data-join-plus]');
  // The (+) of a joined card too: the scroll box shrinks as its ghosts go.
  await plus.hover();
  await marts.locator('article[data-ghost][data-mart-id="customers"]').click();
  await expect(marts.locator('[id="dm-customers@customers"]')).toBeVisible();
  await page.keyboard.press('Escape');
  for (const target of [plus, marts.locator('[id="dm-customers@customers"] [data-join-plus]')]) {
    for (const close of ['Escape', 'Escape pinned', 'second click']) {
      await page.mouse.move(0, 0);
      await page.waitForTimeout(600);
      await target.hover();
      await expect(ghosts.first()).toBeVisible();
      if (close !== 'Escape') await target.click();
      if (close === 'second click') await target.click();
      else await page.keyboard.press('Escape');
      await expect(ghosts).toHaveCount(0);
      await page.waitForTimeout(600);
      await expect(ghosts).toHaveCount(0);
      const dot = (await target.boundingBox())!;
      await page.mouse.move(dot.x + dot.width / 2 + 1, dot.y + dot.height / 2 + 1);
      await page.waitForTimeout(100);
      await expect(ghosts).toHaveCount(0);
    }
  }
  await page.mouse.move(0, 0);
  await plus.hover();
  await expect(ghosts.first()).toBeVisible();
});

test('canvas: the ghosts go a grace after the pointer left them, at once or wandering over another card', async ({ page }) => {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  await marts.getByRole('radio', { name: 'Graph' }).click();
  const ghosts = marts.locator('article[data-ghost]');
  const plus = marts.locator('article#dm-orders [data-join-plus]');
  await plus.hover();
  await marts.locator('article[data-ghost][data-mart-id="customers"]').click();
  const customers = marts.locator('[id="dm-customers@customers"]');
  await expect(customers).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);
  await page.waitForTimeout(600);
  const dot = (await plus.boundingBox())!;
  const other = (await customers.boundingBox())!;

  // Over the (+) and off it with nothing in between.
  for (let i = 0; i < 5; i++) {
    await Promise.all([page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2), page.mouse.move(0, 0)]);
    await page.waitForTimeout(700);
    await expect(ghosts).toHaveCount(0);
  }

  // Never still on the other card: the ghosts are there well into the grace and gone after it.
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await expect(ghosts.first()).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { goneAfter?: number };
    let left: number | null = null;
    document.addEventListener('pointerover', (e) => { if (left === null && (e.target as Element).closest('[data-tree-path="customers"]')) left = performance.now(); }, true);
    const look = () => {
      if (left !== null && document.querySelector('article[data-ghost]') === null) w.goneAfter = performance.now() - left;
      else requestAnimationFrame(look);
    };
    look();
  });
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(other.x + 30 + (i % 2) * 120, other.y + 20 + (i % 3) * 30);
    await page.waitForTimeout(45);
  }
  const goneAfter = await page.evaluate(() => (window as unknown as { goneAfter?: number }).goneAfter);
  expect(goneAfter).toBeGreaterThan(350);
  expect(goneAfter).toBeLessThan(800);
});
