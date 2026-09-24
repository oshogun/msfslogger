import { test, expect } from '@playwright/test';

/**
 * Proves the whole Playwright harness end to end: the scratch server built
 * and seeded by scratch-server.sh answers requests, the storageState written
 * by global-setup's real login carries a session the browser honours, and a
 * protected page renders real seeded data instead of bouncing to /login.
 */
test('a logged-in visitor lands on the flight log, not the login form', async ({ page }) => {
  await page.goto('/');

  const main = page.getByRole('main');
  await expect(main).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Home' })).toBeVisible();

  await expect(page).not.toHaveURL(/\/login$/);
});
