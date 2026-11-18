import { expect, test } from '@playwright/test';

test('at a narrow width the context badges fold into a "+N more" chip whose popover still toggles them', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 700 });
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
  for (let w = 1400; w >= 360; w -= 40) widths.push(w);
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
