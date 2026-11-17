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
