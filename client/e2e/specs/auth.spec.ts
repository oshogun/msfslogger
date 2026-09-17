import { test, expect } from '@playwright/test';

// Same defaults as global-setup.ts and testSeed.ts — kept in sync by env var
// name, not by importing anything (this file never imports from src/).
const USERNAME = process.env.MSFSLOGGER_E2E_USERNAME ?? 'e2e';
const PASSWORD = process.env.MSFSLOGGER_E2E_PASSWORD ?? 'e2e-password-123';

test.describe('login form (unauthenticated)', () => {
  // The default project storageState is a logged-in operator; the login form
  // itself has to be exercised with no session at all.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('valid credentials land on the flight log, not the login form', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Username').fill(USERNAME);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: /^log in$/i }).click();

    await expect(page).not.toHaveURL(/\/login$/);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Flight Log' })).toBeVisible();
  });

  test('a wrong password is rejected with the real 401 message, and the form stays put', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Username').fill(USERNAME);
    await page.getByLabel('Password').fill('definitely-the-wrong-password');
    await page.getByRole('button', { name: /^log in$/i }).click();

    // This is src/auth/routes.ts's login handler's own 401 body rendered
    // verbatim by Login.tsx — not a mocked response, the real scrypt-verify
    // failure path.
    await expect(page.getByRole('alert')).toHaveText('Invalid username or password');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('an unknown username gets the same message as a wrong password', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Username').fill('nobody-by-this-name');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: /^log in$/i }).click();

    await expect(page.getByRole('alert')).toHaveText('Invalid username or password');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('visiting a protected page with no session redirects to the login form', async ({ page }) => {
    await page.goto('/flights');

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: /^log in$/i })).toBeVisible();
  });
});

test.describe('authenticated session', () => {
  // Uses the default project storageState — the one real login global-setup
  // performed once for the whole run.

  test('the session survives a reload', async ({ page }) => {
    await page.goto('/');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Flight Log' })).toBeVisible();

    await page.reload();

    await expect(page).not.toHaveURL(/\/login$/);
    await expect(main.getByRole('heading', { name: 'Flight Log' })).toBeVisible();
  });

});

test.describe('logout', () => {
  // Deliberately NOT the shared, default storageState: every other spec file
  // in this suite reuses that one real login from global-setup, and logging
  // it out here would destroy the session server-side out from under every
  // test that runs after this one. This test logs itself in instead, so the
  // only session it ever touches is its own.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('logging out clears the session and returns to the login form', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill(USERNAME);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: /^log in$/i }).click();
    await expect(page.getByRole('main').getByRole('heading', { name: 'Flight Log' })).toBeVisible();

    await page.getByRole('button', { name: /log out/i }).click();
    await expect(page).toHaveURL(/\/login$/);

    // The logout actually cleared server-side state, not just the client's
    // in-memory view of it: a fresh navigation to a protected page bounces
    // back to /login again rather than rendering from a stale cookie.
    await page.goto('/flights');
    await expect(page).toHaveURL(/\/login$/);
  });
});
