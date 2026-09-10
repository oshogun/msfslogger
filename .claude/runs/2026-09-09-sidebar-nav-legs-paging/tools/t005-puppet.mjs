import puppeteer from 'puppeteer';

const BASE = 'http://localhost:3100';

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
// Default (narrow, <=900px) viewport: sidebar collapses to just its toggle,
// matching the "exactly one /flights anchor" criterion, which is about
// Home's own content, not sidebar chrome.
const page = await browser.newPage();

async function report(name, fn) {
  try {
    const result = await fn();
    console.log(`PASS ${name}: ${JSON.stringify(result)}`);
  } catch (err) {
    console.log(`FAIL ${name}: ${err.message}`);
  }
}

await page.goto(`${BASE}/flights`, { waitUntil: 'networkidle0' });
await report('flights has #flights-table', async () => {
  const has = await page.$('#flights-table') !== null;
  if (!has) throw new Error('missing #flights-table on /flights');
  return { has };
});

await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
await report('home lacks #flights-table', async () => {
  const has = await page.$('#flights-table') !== null;
  if (has) throw new Error('#flights-table present on /');
  return { has };
});

await report('home stats-grid', async () => {
  const cardCount = await page.$$eval('.stats-grid .stat-card', els => els.length);
  if (cardCount < 4) throw new Error(`only ${cardCount} .stat-card children`);
  return { cardCount };
});

await report('home recent flights list', async () => {
  const hrefs = await page.$$eval('.recent-flights-list a', els => els.map(a => a.getAttribute('href')));
  if (hrefs.length > 5) throw new Error(`recent list has ${hrefs.length} items, expected <=5`);
  for (const h of hrefs) {
    if (!/^\/flight\/\d+$/.test(h)) throw new Error(`bad href ${h}`);
  }
  return { count: hrefs.length, hrefs };
});

await report('home has exactly one link to /flights', async () => {
  const hrefs = await page.$$eval('a', els => els.map(a => a.getAttribute('href')));
  const matches = hrefs.filter(h => h === '/flights');
  if (matches.length !== 1) throw new Error(`found ${matches.length} anchors to /flights: ${JSON.stringify(hrefs.filter(h=>h && h.includes('flights')))}`);
  return { count: matches.length };
});

// Sidebar-active check needs the rail expanded, so use a wide-viewport page.
const widePage = await browser.newPage();
await widePage.setViewport({ width: 1280, height: 900 });
await report('sidebar all-flights is-active on /flights, not on /', async () => {
  await widePage.goto(`${BASE}/flights`, { waitUntil: 'networkidle0' });
  const activeOnFlights = await widePage.$$eval('.sidebar a', els => {
    const el = els.find(a => a.textContent.trim() === 'All flights');
    return el ? el.className.includes('is-active') : null;
  });
  await widePage.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  const activeOnHome = await widePage.$$eval('.sidebar a', els => {
    const el = els.find(a => a.textContent.trim() === 'All flights');
    return el ? el.className.includes('is-active') : null;
  });
  if (activeOnFlights !== true) throw new Error(`expected is-active on /flights, got ${activeOnFlights}`);
  if (activeOnHome !== false) throw new Error(`expected NOT is-active on /, got ${activeOnHome}`);
  return { activeOnFlights, activeOnHome };
});

await browser.close();
