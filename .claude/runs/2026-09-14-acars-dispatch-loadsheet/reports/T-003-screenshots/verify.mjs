// Scratch Playwright walkthrough — not part of the repo — exercises the
// REQUEST LOADSHEET action against the mock server on :3100.
import { chromium } from 'playwright';

const BASE = 'http://localhost:3100';
const SHOT_DIR = process.env.SHOT_DIR || '.';

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('OK: ' + msg);
}

const browser = await chromium.launch({
  executablePath: '/home/guilherme/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
});
const page = await browser.newPage();

// --- Case 1: flight 1, planned_leg_id 42, has dispatch data ---
await page.goto(`${BASE}/flight/1/acars`, { waitUntil: 'networkidle' });
await page.waitForSelector('#acars-messages');

const subtitleBefore = await page.textContent('.flight-subtitle');
assert(subtitleBefore.includes('planned leg 42'), 'subtitle mentions planned leg 42 when plannedLegId is set');

const btn = page.getByRole('button', { name: 'REQUEST LOADSHEET' });
assert(await btn.isEnabled(), 'REQUEST LOADSHEET is enabled when plannedLegId is set');

const countsBefore = await (await page.request.get(`${BASE}/__debug/counts`)).json();

await btn.click();
await page.waitForSelector('.acars-msg--downlink .acars-msg-body:has-text("REQUEST LOADSHEET")');

const countsAfter = await (await page.request.get(`${BASE}/__debug/counts`)).json();
assert(countsAfter['1'] === countsBefore['1'], 'GET thread endpoint was not called again (no refetch): ' + JSON.stringify(countsBefore) + ' -> ' + JSON.stringify(countsAfter));

const rows = await page.locator('.acars-msg').count();
assert(rows === 2, 'exactly 2 new rows rendered in the thread, got ' + rows);

const uplinkBadge = await page.locator('.acars-msg--uplink .badge-uplink').textContent();
assert(uplinkBadge.trim() === 'Dispatch', 'uplink row uses existing Dispatch badge label');
const downlinkBadge = await page.locator('.acars-msg--downlink .badge-downlink').textContent();
assert(downlinkBadge.trim() === 'Cockpit', 'downlink row uses existing Cockpit badge label');

const dispatchBadges = await page.locator('.badge-acars-dispatch').count();
assert(dispatchBadges === 2, 'both rows use the existing badge-acars-dispatch class, got ' + dispatchBadges);

const replyBody = await page.locator('.acars-msg--uplink .acars-msg-body').textContent();
assert(replyBody.includes('LOADSHEET'), 'reply body renders the LOADSHEET text');

await page.screenshot({ path: `${SHOT_DIR}/1-loadsheet-success.png`, fullPage: true });

// --- POST call was made to the exact path/method, verified via request interception on a fresh load ---
const page2 = await browser.newPage();
let capturedRequest = null;
page2.on('request', req => {
  if (req.url().includes('/acars-messages/loadsheet')) {
    capturedRequest = { url: req.url(), method: req.method() };
  }
});
await page2.goto(`${BASE}/flight/1/acars`, { waitUntil: 'networkidle' });
await page2.getByRole('button', { name: /REQUEST LOADSHEET|Requesting/ }).click();
await page2.waitForTimeout(300);
assert(capturedRequest !== null, 'a POST to the loadsheet endpoint was observed');
assert(capturedRequest.method === 'POST', 'method is POST, got ' + capturedRequest.method);
assert(capturedRequest.url === `${BASE}/api/planned-legs/42/acars-messages/loadsheet`, 'exact URL, got ' + capturedRequest.url);
await page2.close();

// --- Case 2: flight 2, plannedLegId null ---
const page3 = await browser.newPage();
await page3.goto(`${BASE}/flight/2/acars`, { waitUntil: 'networkidle' });
await page3.waitForSelector('#acars-messages');
const subtitle2 = await page3.textContent('.flight-subtitle');
assert(!subtitle2.includes('planned leg'), 'subtitle does not mention a planned leg when plannedLegId is null');
const btn2 = page3.getByRole('button', { name: 'REQUEST LOADSHEET' });
assert(await btn2.isDisabled(), 'REQUEST LOADSHEET is disabled when plannedLegId is null');
await page3.screenshot({ path: `${SHOT_DIR}/2-disabled-no-planned-leg.png`, fullPage: true });
await page3.close();

// --- Case 3: flight 3, planned_leg_id 99, NO dispatch data on file (409) ---
const page4 = await browser.newPage();
await page4.goto(`${BASE}/flight/3/acars`, { waitUntil: 'networkidle' });
await page4.waitForSelector('#acars-messages');
const btn3 = page4.getByRole('button', { name: 'REQUEST LOADSHEET' });
assert(await btn3.isEnabled(), 'REQUEST LOADSHEET is enabled for a leg that exists but has no dispatch data');
await btn3.click();
await page4.waitForSelector('.edit-error');
const errText = await page4.textContent('.edit-error');
assert(errText.trim() === 'NO DISPATCH DATA ON FILE', 'inline error is the literal NO DISPATCH DATA ON FILE string, got: ' + JSON.stringify(errText));
const rowsAfterRejection = await page4.locator('.acars-msg').count();
assert(rowsAfterRejection === 0, 'no rows were appended on rejection, got ' + rowsAfterRejection);
await page4.screenshot({ path: `${SHOT_DIR}/3-no-dispatch-data-error.png`, fullPage: true });
await page4.close();

await browser.close();
console.log('ALL CHECKS PASSED');
