import { expect, test } from '@playwright/test';
for (const route of ['/', '/privacy', '/terms', '/support', '/delete-account']) {
  test(`${route} fits a phone with no sideways scroll`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
