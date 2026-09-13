// Puppeteer check for T-003: the SimBrief User ID field on TripDetail.tsx.
// Run against the scratch server on :3100 set up for this task's report.
import puppeteer from 'puppeteer';

const BASE = 'http://127.0.0.1:3100';
const TRIP_ID = 1;

function log(label, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
  await page.type('input[name="username"]', 'testop');
  await page.type('input[name="password"]', 'testpassword12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('button[type="submit"]'),
  ]);

  // ── Load: field prefilled from a previously-saved value ──
  await page.goto(`${BASE}/trip/${TRIP_ID}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#simbrief-user-id');
  const prefilled = await page.$eval('#simbrief-user-id', el => el.value);
  log('field prefilled from GET on load', prefilled === '1099607', `value="${prefilled}"`);

  // ── Save a new valid value, then reload and confirm it stuck ──
  await page.$eval('#simbrief-user-id', el => { el.value = ''; });
  await page.type('#simbrief-user-id', '7654321');
  await page.click('.simbrief-import-section button');
  await page.waitForFunction(
    () => document.querySelector('.simbrief-import-section button')?.textContent === 'Save'
  );
  const afterSave = await page.$eval('#simbrief-user-id', el => el.value);
  log('input reflects saved value immediately after Save', afterSave === '7654321', `value="${afterSave}"`);

  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#simbrief-user-id');
  const afterReload = await page.$eval('#simbrief-user-id', el => el.value);
  log('field still shows saved value after reload', afterReload === '7654321', `value="${afterReload}"`);

  // ── Rejection: invalid ID renders the server's message, reverts the input ──
  await page.$eval('#simbrief-user-id', el => { el.value = ''; });
  await page.type('#simbrief-user-id', 'notdigits');
  await page.click('.simbrief-import-section button');
  await page.waitForSelector('.simbrief-import-section .edit-error');
  const errText = await page.$eval('.simbrief-import-section .edit-error', el => el.textContent);
  const revertedValue = await page.$eval('#simbrief-user-id', el => el.value);
  log('rejection message rendered inline', /digits only/.test(errText || ''), `"${errText}"`);
  log('previously saved value still displayed after rejection', revertedValue === '7654321', `value="${revertedValue}"`);

  // ── The .lnmpln section is untouched and still present ──
  const lnmplnPresent = await page.$('.planned-legs-import-section input[type="file"]') !== null;
  log('.lnmpln file input still renders', lnmplnPresent);

  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
