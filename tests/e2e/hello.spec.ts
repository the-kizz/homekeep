import { test, expect } from '@playwright/test';

test('hello page renders HomeKeep heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('HomeKeep');
});
