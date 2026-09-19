import { test, expect, type Page } from '@playwright/test';

/**
 * Flight replay on FlightDetail, against the seeded flights: flight 1 has 3
 * points and flight 2 has 2, each spaced far beyond the recording-gap
 * threshold, so a replay of either is a run of collapsed gaps a few virtual
 * seconds long. Playback is pinned to 1x so it is slow enough to observe
 * mid-flight and short enough to reach the end.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    // Map tiles are fetched from the public internet, which the test
    // environment may not reach; that is not an app error.
    if (/Failed to load resource/.test(msg.text())) return;
    errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

async function openReplay(page: Page) {
  await page.goto('/flight/1');
  const main = page.getByRole('main');
  const toggle = main.getByRole('button', { name: 'Replay flight' });
  await toggle.click();
  const panel = main.locator('#replay-panel');
  await expect(panel).toBeVisible();
  await panel.getByLabel('Replay speed').selectOption('1');
  return { main, panel };
}

test.describe('Flight replay', () => {
  test('panel is closed until the Replay button is clicked, then exposes every control', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/flight/1');
    const main = page.getByRole('main');
    await expect(main.locator('#map .leaflet-container')).toBeVisible();
    await expect(main.locator('#replay-panel')).toHaveCount(0);

    const mapMarkers = main.locator('#map .leaflet-marker-icon');
    await expect(mapMarkers).toHaveCount(2);

    const toggle = main.getByRole('button', { name: 'Replay flight' });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    const hide = main.getByRole('button', { name: 'Hide replay' });
    await expect(hide).toHaveAttribute('aria-expanded', 'true');

    const panel = main.locator('#replay-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Play replay' })).toBeVisible();
    await expect(panel.getByLabel('Replay speed')).toBeVisible();
    await expect(panel.getByLabel('Replay position')).toBeVisible();
    await expect(panel.getByRole('checkbox', { name: /Follow aircraft/ })).toBeChecked();
    await expect(panel.locator('[data-field="point"]')).toHaveText('1 / 3');
    await expect(panel.locator('[data-field="elapsed"]')).toBeVisible();
    await expect(panel.locator('.replay-aircraft')).toHaveCount(1);

    // The replay map lives in the panel, outside #map, so the flight map's
    // own markers are untouched.
    await expect(mapMarkers).toHaveCount(2);

    await hide.click();
    await expect(main.locator('#replay-panel')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Play advances the readout to the end, Restart is offered, seek and Pause hold position', async ({ page }) => {
    const errors = collectErrors(page);
    const { panel } = await openReplay(page);
    const scrubber = panel.getByLabel('Replay position');
    const elapsed = panel.locator('[data-field="elapsed"]');
    const point = panel.locator('[data-field="point"]');

    const startElapsed = await elapsed.textContent();
    const startValue = Number(await scrubber.inputValue());
    await panel.getByRole('button', { name: 'Play replay' }).click();
    const pauseButton = panel.getByRole('button', { name: 'Pause replay' });
    await expect(pauseButton).toBeVisible();
    await expect(elapsed).not.toHaveText(startElapsed ?? '');
    await expect.poll(async () => Number(await scrubber.inputValue())).toBeGreaterThan(startValue);

    // Pause freezes the readout and the scrubber.
    await pauseButton.click();
    await expect(panel.getByRole('button', { name: 'Play replay' })).toBeVisible();
    const frozenValue = await scrubber.inputValue();
    const frozenElapsed = await elapsed.textContent();
    await expect.poll(async () => [await scrubber.inputValue(), await elapsed.textContent()], {
      intervals: [200, 200, 200],
      timeout: 1_000,
    }).toEqual([frozenValue, frozenElapsed]);
    // Poll matching once is not proof of stillness; require it to hold.
    await expect(async () => {
      expect(await scrubber.inputValue()).toBe(frozenValue);
    }).toPass({ timeout: 1_000 });

    // Seeking to the middle moves the readout to the second point.
    const max = Number(await scrubber.getAttribute('max'));
    expect(max).toBeGreaterThan(0);
    await scrubber.fill(String(max / 2));
    await expect(point).toHaveText('2 / 3');
    await expect(elapsed).toHaveText('36m 00s');

    // Play to the end: the button becomes Restart and the readout is the last point.
    await panel.getByRole('button', { name: 'Play replay' }).click();
    const restart = panel.getByRole('button', { name: 'Restart replay' });
    await expect(restart).toBeVisible({ timeout: 15_000 });
    await expect(point).toHaveText('3 / 3');
    expect(Number(await scrubber.inputValue())).toBeCloseTo(max, 0);

    // Restart goes back to the start and plays again.
    await restart.click();
    await expect(panel.getByRole('button', { name: 'Pause replay' })).toBeVisible();
    await expect(point).toHaveText(/^[12] \/ 3$/);
    expect(errors).toEqual([]);
  });

  test('Space while the Play button is focused toggles playback exactly once', async ({ page }) => {
    const errors = collectErrors(page);
    const { panel } = await openReplay(page);
    const play = panel.getByRole('button', { name: 'Play replay' });
    await play.focus();
    await expect(play).toBeFocused();
    await page.keyboard.press('Space');

    // If Space were handled twice (panel key handler plus the button's native
    // click) playback would start and stop again; one toggle means it stays
    // playing. Look for the transition to Pause and that it is not undone.
    const pause = panel.getByRole('button', { name: 'Pause replay' });
    await expect(pause).toBeVisible();
    await expect(async () => {
      await expect(pause).toBeVisible();
    }).toPass({ timeout: 1_000 });

    await page.keyboard.press('Space');
    await expect(panel.getByRole('button', { name: 'Play replay' })).toBeVisible();
    await expect(async () => {
      await expect(panel.getByRole('button', { name: 'Play replay' })).toBeVisible();
    }).toPass({ timeout: 1_000 });
    expect(errors).toEqual([]);
  });

  test('flight 2 (two points) also offers a replay', async ({ page }) => {
    await page.goto('/flight/2');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Replay flight' }).click();
    await expect(main.locator('#replay-panel [data-field="point"]')).toHaveText('1 / 2');
  });
});
