import { expect, test } from '@playwright/test';

test('at a very narrow width the context badges fold into a "+N more" chip whose popover still toggles them', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  const group = marts.getByRole('group', { name: 'Contexts' });
  const chip = group.locator('[data-context-more]');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('more');
  const row = (await group.boundingBox())!;
  for (const b of await group.getByRole('button').all()) {
    const box = (await b.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(row.x + row.width + 1);
  }
  await chip.click();
  const list = page.getByRole('group', { name: 'Hidden contexts' });
  const first = list.getByRole('button').first();
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(chip).toHaveAttribute('data-on', '');
});

test('across widths the badges never overflow, the chip plus the badges add up, and a width gives the same result from above and from below', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 700 });
  await page.goto('/?mock');
  const group = page.locator('#band-marts').getByRole('group', { name: 'Contexts' });
  await expect(group).toBeVisible();
  // Every context name: the probe holds one entry per context plus the chip.
  const total = (await group.locator('.dm-context-probe').locator('> span').count()) - 1;
  expect(total).toBeGreaterThan(2);
  const widths: number[] = [];
  for (let w = 1400; w >= 320; w -= 40) widths.push(w);
  const settle = async () => { await page.waitForTimeout(150); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); };
  const read = async (w: number) => {
    const row = (await group.boundingBox())!;
    const buttons = await group.getByRole('button').all();
    let chip = 0;
    let shown = 0;
    for (const b of buttons) {
      const box = (await b.boundingBox())!;
      expect(box.x + box.width, `width ${w}`).toBeLessThanOrEqual(row.x + row.width + 1);
      if ((await b.getAttribute('data-context-more')) !== null) chip = Number(((await b.textContent()) ?? '').match(/\+(\d+)/)![1]);
      else shown += 1;
    }
    expect(shown + chip).toBe(total);
    const tops = new Set<number>();
    for (const b of buttons) tops.add(Math.round((await b.boundingBox())!.y));
    expect(tops.size, `lines at width ${w}`).toBeLessThanOrEqual(2);
    return `${shown}/${chip}`;
  };
  const down = new Map<number, string>();
  for (const w of widths) { await page.setViewportSize({ width: w, height: 700 }); await settle(); down.set(w, await read(w)); }
  for (const w of [...widths].reverse()) {
    await page.setViewportSize({ width: w, height: 700 });
    await settle();
    expect(await read(w), `width ${w}`).toBe(down.get(w));
  }
});

test('the badges sit right-aligned next to the Storage button, and a narrow header wraps them onto at most two lines', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 700 });
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  const group = marts.getByRole('group', { name: 'Contexts' });
  const storage = marts.locator('.dm-band-tools').getByText('Storage');
  await expect(group).toBeVisible();
  await expect(storage).toBeVisible();
  // The badges leave the title group.
  await expect(marts.locator('.dm-band-titlegroup').getByRole('group', { name: 'Contexts' })).toHaveCount(0);
  const edges = async () => {
    const storageBox = (await marts.locator('.dm-band-tools button, .dm-band-tools summary').filter({ hasText: 'Storage' }).first().boundingBox())!;
    const right = Math.max(...(await Promise.all((await group.getByRole('button').all()).map(async (b) => { const box = (await b.boundingBox())!; return box.x + box.width; }))));
    return storageBox.x - right;
  };
  expect(await edges()).toBeGreaterThanOrEqual(0);
  expect(await edges()).toBeLessThanOrEqual(16);

  await page.setViewportSize({ width: 400, height: 700 });
  await page.waitForTimeout(300);
  const tops = new Set<number>();
  for (const b of await group.getByRole('button').all()) tops.add(Math.round((await b.boundingBox())!.y));
  expect(tops.size).toBeLessThanOrEqual(2);
  expect(await edges()).toBeLessThanOrEqual(16);
  await page.locator('#band-marts header').screenshot({ path: 'tmp/w7t1-narrow.png' });
});

test('at a very narrow width the badges take two lines and the rest goes behind the chip, right-aligned', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/?mock');
  const group = page.locator('#band-marts').getByRole('group', { name: 'Contexts' });
  const chip = group.locator('[data-context-more]');
  await expect(chip).toBeVisible();
  const tops = new Set<number>();
  for (const b of await group.getByRole('button').all()) tops.add(Math.round((await b.boundingBox())!.y));
  expect(tops.size).toBeLessThanOrEqual(2);
  // The chip ends the last line, flush with the row's right edge.
  const row = (await group.boundingBox())!;
  const box = (await chip.boundingBox())!;
  expect(row.x + row.width - (box.x + box.width)).toBeLessThanOrEqual(2);
});

test('header screenshot at 2x', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1400, height: 700 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto('/?mock');
  await expect(page.locator('#band-marts').getByRole('group', { name: 'Contexts' })).toBeVisible();
  await page.waitForTimeout(300);
  await page.locator('#band-marts header').screenshot({ path: 'tmp/w7t1-header.png' });
  await context.close();
});
