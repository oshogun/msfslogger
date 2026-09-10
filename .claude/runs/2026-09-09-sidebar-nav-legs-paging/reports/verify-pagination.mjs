import puppeteer from 'puppeteer';

const BASE = 'http://127.0.0.1:3100';
const BIG_TRIP = 3;   // 45 flights, seeded by seed-many-legs.mjs
const SMALL_TRIP = 2; // 8 flights

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  (' + detail + ')' : ''}`);
}

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});

async function newPage() {
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => { pageErrors.push(String(err)); });
  page.consoleErrors = consoleErrors;
  page.pageErrors = pageErrors;
  return page;
}

async function legRowCount(page) {
  return page.$$eval('.legs-section tbody tr', (rows) =>
    rows.filter((r) => !r.className.includes('tr-link-picker')).length
  );
}

// ── 1: default page renders 20 rows ────────────────────────────────────────
{
  const page = await newPage();
  await page.goto(`${BASE}/trip/${BIG_TRIP}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.legs-section table');
  const count = await legRowCount(page);
  check('default /trip/<id> renders 20 leg rows', count === 20, `got ${count}`);
  check('no console error on default load', page.consoleErrors.length === 0, JSON.stringify(page.consoleErrors));
  check('no thrown exception on default load', page.pageErrors.length === 0, JSON.stringify(page.pageErrors));
  await page.close();
}

// ── 2: ?page=3 renders 5 rows, and the pagination text/buttons ────────────
{
  const page = await newPage();
  await page.goto(`${BASE}/trip/${BIG_TRIP}?page=3`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.legs-section table');
  const count = await legRowCount(page);
  check('?page=3 renders 5 rows', count === 5, `got ${count}`);
  const text = await page.$eval('.legs-pagination span', (el) => el.textContent.trim());
  check('.legs-pagination text', text === 'Page 3 of 3 · legs 41–45 of 45', text);
  const prevDisabled = await page.$eval('.legs-pagination button:first-of-type', (el) => el.disabled);
  const nextDisabled = await page.$eval('.legs-pagination button:last-of-type', (el) => el.disabled);
  check('Prev disabled on page 3', prevDisabled === false, `prevDisabled=${prevDisabled}`);
  check('Next disabled on page 3 (last page)', nextDisabled === true, `nextDisabled=${nextDisabled}`);
  check('no console error on ?page=3', page.consoleErrors.length === 0, JSON.stringify(page.consoleErrors));
  check('no thrown exception on ?page=3', page.pageErrors.length === 0, JSON.stringify(page.pageErrors));
  await page.close();
}

// ── 2b: Prev disabled on page 1 ────────────────────────────────────────────
{
  const page = await newPage();
  await page.goto(`${BASE}/trip/${BIG_TRIP}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.legs-pagination');
  const prevDisabled = await page.$eval('.legs-pagination button:first-of-type', (el) => el.disabled);
  check('Prev disabled on page 1', prevDisabled === true, `prevDisabled=${prevDisabled}`);
  await page.close();
}

// ── 3: malformed ?page= values clamp silently ──────────────────────────────
for (const [q, expected] of [['?page=0', 20], ['?page=abc', 20], ['?page=999', 5]]) {
  const page = await newPage();
  await page.goto(`${BASE}/trip/${BIG_TRIP}${q}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.legs-section table');
  const count = await legRowCount(page);
  check(`${q} renders ${expected} rows`, count === expected, `got ${count}`);
  check(`no console error on ${q}`, page.consoleErrors.length === 0, JSON.stringify(page.consoleErrors));
  check(`no thrown exception on ${q}`, page.pageErrors.length === 0, JSON.stringify(page.pageErrors));
  await page.close();
}

// ── 4: round-trip — reload keeps page, View->flight->Back restores ?page=3 ─
{
  const page = await newPage();
  await page.goto(`${BASE}/trip/${BIG_TRIP}?page=3`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.legs-section table');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.legs-section table');
  const countAfterReload = await legRowCount(page);
  const urlAfterReload = new URL(page.url());
  check('reload keeps ?page=3', urlAfterReload.searchParams.get('page') === '3', urlAfterReload.href);
  check('reload still shows 5 rows', countAfterReload === 5, `got ${countAfterReload}`);

  // Click the first leg row's View link (flown-flight row, not a ghost row).
  const viewHref = await page.$eval(
    '.legs-section tbody tr:not(.tr-ghost) a.btn-ghost',
    (el) => el.getAttribute('href')
  );
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('.legs-section tbody tr:not(.tr-ghost) a.btn-ghost'),
  ]);
  const flightUrl = new URL(page.url());
  check('View link navigates to /flight/:id', /^\/flight\/\d+$/.test(flightUrl.pathname), flightUrl.pathname);
  check('View href matches navigated path', flightUrl.pathname === viewHref, `${flightUrl.pathname} vs ${viewHref}`);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.goBack(),
  ]);
  const backUrl = new URL(page.url());
  check('Back restores /trip/<id>?page=3', backUrl.pathname === `/trip/${BIG_TRIP}` && backUrl.searchParams.get('page') === '3', backUrl.href);
  await page.waitForSelector('.legs-section table');
  const countAfterBack = await legRowCount(page);
  check('Back still shows page-3 rows (5)', countAfterBack === 5, `got ${countAfterBack}`);
  await page.close();
}

// ── 5: no-op for a small trip ──────────────────────────────────────────────
{
  const page = await newPage();
  await page.goto(`${BASE}/trip/${SMALL_TRIP}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.legs-section table');
  const pagination = await page.$('.legs-pagination');
  check('.legs-pagination is null for small trip', pagination === null, String(pagination));
  const count = await legRowCount(page);
  check('small trip row count is state below (informational)', true, `count=${count}`);
  console.log(`SMALL_TRIP_ROW_COUNT=${count}`);
  await page.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('FAILURES:', failed.map((f) => f.name));
  process.exit(1);
}
