import { test, expect } from '@playwright/test';

/**
 * Exercises Home, AllFlights, FlightDetail and TripDetail against the exact
 * fixture rows the scratch server was seeded with (src/testSeed.ts):
 *
 *   trip 1  "E2E Baltic Hop"
 *   flight 1  Airbus A320neo  EFHK -> EETN  (3 points, in the trip)
 *   flight 2  Cessna 172      EETN -> EEPU  (2 points, ungrouped)
 *   planned leg 1  EETN -> ESSA  (trip-linked, unflown)
 *   planned leg 2  ESSA -> EFHK  (loose, unflown — not shown on trip 1's page)
 *
 * Every assertion below names a specific fixture value, not just "a row
 * exists" — a regression that swapped flight 1 and flight 2's data, or
 * dropped the trip link, fails one of these.
 */

test.describe('Home', () => {
  test('renders the seeded stats, recent flights and ground/leg picker fixtures', async ({ page }) => {
    await page.goto('/');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Flight Log' })).toBeVisible();

    const statValue = (label: string) => main.locator('.stat-card', { hasText: label }).locator('.stat-value');
    await expect(statValue('Total Flights')).toHaveText('2');
    await expect(statValue('Total Trips')).toHaveText('1');
    await expect(statValue('Total Duration')).toContainText('2h 17m');
    await expect(statValue('Total Distance')).toContainText('248.5');

    // Sorted by start_time descending: the Cessna (2026-03-02) before the
    // Airbus (2026-03-01).
    const recentRows = main.locator('.recent-flight-row');
    await expect(recentRows).toHaveCount(2);
    await expect(recentRows.nth(0)).toContainText('Cessna 172');
    await expect(recentRows.nth(0)).toContainText('EETN → EEPU');
    await expect(recentRows.nth(1)).toContainText('Airbus A320neo');
    await expect(recentRows.nth(1)).toContainText('EFHK → EETN');

    // No ground_sessions row was seeded.
    await expect(main.getByText('Not on the ground.')).toBeVisible();

    // The manual-entry planned-leg picker offers both unflown legs, labelled
    // by their owning trip (or its absence).
    const legPicker = main.locator('#ground-manual-leg');
    await expect(legPicker.locator('option', { hasText: 'E2E Baltic Hop · EETN → ESSA' })).toHaveCount(1);
    await expect(legPicker.locator('option', { hasText: 'No trip · ESSA → EFHK' })).toHaveCount(1);
  });
});

test.describe('AllFlights', () => {
  test('groups flight 1 under its trip and lists flight 2 as ungrouped', async ({ page }) => {
    await page.goto('/flights');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Flight Log' })).toBeVisible();

    await expect(main.getByText('🚗 E2E Baltic Hop')).toBeVisible();
    await expect(main.getByText('1 leg')).toBeVisible();
    await expect(main.getByText('Ungrouped Flights')).toBeVisible();

    const table = main.locator('#flights-table');
    await expect(table.getByRole('cell', { name: /Airbus A320neo/ })).toBeVisible();
    await expect(table.locator('.td-route', { hasText: 'EFHK → EETN' })).toBeVisible();
    await expect(table.getByRole('cell', { name: /Cessna 172/ })).toBeVisible();
    await expect(table.locator('.td-route', { hasText: 'EETN → EEPU' })).toBeVisible();

    // header row + trip-header row + 1 leg + ungrouped-header row + 1 flight.
    await expect(table.getByRole('row')).toHaveCount(5);
  });
});

test.describe('FlightDetail', () => {
  test('flight 1 renders the Airbus, its EFHK -> EETN route and a 3-point track', async ({ page }) => {
    await page.goto('/flight/1');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: /Flight #1.*Airbus A320neo/ })).toBeVisible();

    const statValue = (label: string) => main.locator('.stat-card', { hasText: label }).locator('.stat-value');
    await expect(statValue('Departure')).toContainText('EFHK');
    await expect(main.getByText('Helsinki-Vantaa')).toBeVisible();
    await expect(statValue('Arrival')).toContainText('EETN');
    await expect(main.getByText('Tallinn Lennart Meri')).toBeVisible();
    await expect(statValue('Points')).toHaveText('3');
    await expect(statValue('Distance')).toContainText('152.4');

    await expect(main.locator('#map .leaflet-container')).toBeVisible();
    await expect(main.locator('#map .leaflet-marker-icon')).toHaveCount(2);
  });

  test('flight 2 renders the Cessna and its EETN -> EEPU route, distinctly from flight 1', async ({ page }) => {
    await page.goto('/flight/2');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: /Flight #2.*Cessna 172/ })).toBeVisible();

    const statValue = (label: string) => main.locator('.stat-card', { hasText: label }).locator('.stat-value');
    await expect(statValue('Departure')).toContainText('EETN');
    await expect(statValue('Arrival')).toContainText('EEPU');
    await expect(statValue('Points')).toHaveText('2');
    await expect(statValue('Distance')).toContainText('96.1');
  });
});

test.describe('TripDetail', () => {
  test('trip 1 shows its name, the flown Airbus leg, the unflown EETN -> ESSA ghost leg and an empty SimBrief panel', async ({ page }) => {
    await page.goto('/trip/1');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'E2E Baltic Hop' })).toBeVisible();

    await expect(main.getByRole('cell', { name: /Airbus A320neo/ })).toBeVisible();
    await expect(main.locator('.td-route', { hasText: 'EFHK → EETN' })).toBeVisible();

    // The unflown, trip-linked planned leg renders as a ghost row.
    const ghostRow = main.locator('tr.tr-ghost');
    await expect(ghostRow).toHaveCount(1);
    await expect(ghostRow.locator('.td-route')).toContainText('EETN → ESSA');
    await expect(ghostRow).toContainText('Planned');

    // Leg 2 (ESSA -> EFHK) is loose — it must not appear on trip 1's page.
    await expect(main.getByText('ESSA → EFHK')).toHaveCount(0);

    // No app_setting row for SimBrief was seeded.
    await expect(main.getByText('Enter your SimBrief Pilot ID to enable import.')).toBeVisible();
  });
});
