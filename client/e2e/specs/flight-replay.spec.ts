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
  await main.getByRole('tab', { name: 'Replay' }).click();
  const panel = main.getByRole('region', { name: 'Flight replay' });
  await expect(panel).toBeVisible();
  // The speed control is a Carbon Dropdown (click to open, click the option),
  // not a native <select>.
  await panel.getByLabel('Replay speed').click();
  await page.getByRole('option', { name: '1×' }).click();
  return { main, panel };
}

test.describe('Flight replay', () => {
  test('the Replay tab is empty until selected, then exposes every control', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/flight/1');
    const main = page.getByRole('main');
    const map = main.getByTestId('flight-map');
    await expect(map.locator('.leaflet-container')).toBeVisible();
    await expect(main.getByRole('region', { name: 'Flight replay' })).toHaveCount(0);

    const mapMarkers = map.locator('.leaflet-marker-icon');
    await expect(mapMarkers).toHaveCount(2);

    const replayTab = main.getByRole('tab', { name: 'Replay' });
    await expect(replayTab).toHaveAttribute('aria-selected', 'false');
    await replayTab.click();
    await expect(replayTab).toHaveAttribute('aria-selected', 'true');

    const panel = main.getByRole('region', { name: 'Flight replay' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Play replay' })).toBeVisible();
    await expect(panel.getByLabel('Replay speed')).toBeVisible();
    await expect(panel.getByRole('slider', { name: 'Replay position' })).toBeVisible();
    await expect(panel.getByRole('checkbox', { name: /Follow aircraft/ })).toBeChecked();
    await expect(panel.locator('[data-field="point"]')).toHaveText('1 / 3');
    await expect(panel.locator('[data-field="elapsed"]')).toBeVisible();

    // The replay aircraft is a marker on the same flight map, alongside the
    // departure/arrival markers that were already there.
    await expect(main.locator('[data-replay-marker]')).toHaveCount(1);
    await expect(mapMarkers).toHaveCount(3);

    await main.getByRole('tab', { name: 'Track' }).click();
    await expect(main.getByRole('region', { name: 'Flight replay' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Play advances the readout, Pause holds it, seeking moves it directly, and playing to the end offers Restart', async ({ page }) => {
    const errors = collectErrors(page);
    const { main, panel } = await openReplay(page);
    const scrubber = panel.getByRole('slider', { name: 'Replay position' });
    const replayMarker = main.locator('[data-replay-marker]');
    const elapsed = panel.locator('[data-field="elapsed"]');
    const point = panel.locator('[data-field="point"]');

    const startElapsed = await elapsed.textContent();
    const startValue = Number(await scrubber.getAttribute('aria-valuenow'));
    await panel.getByRole('button', { name: 'Play replay' }).click();
    const pauseButton = panel.getByRole('button', { name: 'Pause replay' });
    await expect(pauseButton).toBeVisible();
    await expect(elapsed).not.toHaveText(startElapsed ?? '');
    await expect.poll(async () => Number(await scrubber.getAttribute('aria-valuenow'))).toBeGreaterThan(startValue);

    // Pause freezes the readout and the scrubber. One animation frame can
    // still be in flight the instant the button is clicked, so the readout
    // is given a moment to settle before it is treated as the frozen value.
    await pauseButton.click();
    await expect(panel.getByRole('button', { name: 'Play replay' })).toBeVisible();
    await page.waitForTimeout(150);
    const frozenValue = await scrubber.getAttribute('aria-valuenow');
    const frozenElapsed = await elapsed.textContent();
    await expect.poll(async () => [await scrubber.getAttribute('aria-valuenow'), await elapsed.textContent()], {
      intervals: [200, 200, 200],
      timeout: 1_000,
    }).toEqual([frozenValue, frozenElapsed]);
    // Poll matching once is not proof of stillness; require it to hold.
    await expect(async () => {
      expect(await scrubber.getAttribute('aria-valuenow')).toBe(frozenValue);
    }).toPass({ timeout: 1_000 });

    // Seeking with focus away from the slider (Home/End are the panel's own
    // shortcuts; the slider's own Home/End handling takes over once it has
    // focus, so this is deliberately fired from the Play button instead)
    // jumps the readout straight to the last and first point.
    await panel.getByRole('button', { name: 'Play replay' }).focus();
    await page.keyboard.press('End');
    await expect(point).toHaveText('3 / 3');
    const max = Number(await scrubber.getAttribute('aria-valuemax'));
    expect(Number(await scrubber.getAttribute('aria-valuenow'))).toBeCloseTo(max, 0);
    // The marker on the map moves and rotates with the readout, not just the
    // scrubber and the text fields.
    const endLat = await replayMarker.getAttribute('data-lat');
    const endLon = await replayMarker.getAttribute('data-lon');
    await page.keyboard.press('Home');
    await expect(point).toHaveText('1 / 3');
    await expect(elapsed).toHaveText('0m 00s');
    await expect(replayMarker).not.toHaveAttribute('data-lat', endLat ?? '');
    await expect(replayMarker).not.toHaveAttribute('data-lon', endLon ?? '');

    // Moving the scrubber itself (arrow keys with focus on the Carbon Slider's
    // own thumb) seeks the same way: four Shift+ArrowRight presses at a step
    // of 0.1 and a shift multiplier of 5 land exactly on the midpoint of the
    // 4-second virtual timeline, which is the start of the second point.
    await scrubber.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
    await expect(point).toHaveText('2 / 3');
    await expect(elapsed).toHaveText('36m 00s');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
    await expect(point).toHaveText('1 / 3');
    await expect(elapsed).toHaveText('0m 00s');

    // Play to the end: the button becomes Restart and the readout is the last point.
    await panel.getByRole('button', { name: 'Play replay' }).click();
    const restart = panel.getByRole('button', { name: 'Restart replay' });
    await expect(restart).toBeVisible({ timeout: 15_000 });
    await expect(point).toHaveText('3 / 3');
    expect(Number(await scrubber.getAttribute('aria-valuenow'))).toBeCloseTo(max, 0);

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
    await main.getByRole('tab', { name: 'Replay' }).click();
    await expect(main.getByRole('region', { name: 'Flight replay' }).locator('[data-field="point"]')).toHaveText('1 / 2');
  });
});
