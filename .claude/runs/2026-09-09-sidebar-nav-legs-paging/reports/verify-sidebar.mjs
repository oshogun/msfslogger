#!/usr/bin/env node
// verify-sidebar.mjs — puppeteer checks for T-003 (Sidebar component + AppShell
// wiring). Run against the scratch server on :3100, seeded via
// seed-sidebar-fixture.mjs on top of the copied live db (trip 1 =
// Circumnavegação, 46 flights, active; trip 2 = Weekend hop, 2 flights, not
// active; 3 standalone flights).
//
// Usage:
//   export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
//   node verify-sidebar.mjs

import puppeteer from 'puppeteer';

const BASE = 'http://localhost:3100';
let pass = 0, fail = 0;

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${detail ?? ''}`); }
}

async function newPage(browser, viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page._errors = errors;
  return page;
}

const allTrips = await (await fetch(`${BASE}/api/trips`)).json();
const trip2 = allTrips.find(t => t.name === 'Weekend hop');
const flightInTrip2 = trip2.flights[0].id;
console.log(`fixture: trip2.id=${trip2.id} flightInTrip2=${flightInTrip2}`);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

try {
  // ── 4. Print/device/override routes never mount Header or Sidebar ──
  for (const path of ['/print/trip/1', '/print/flight/1', '/device', '/override']) {
    const page = await newPage(browser);
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
    const hasSidebar = await page.$('.sidebar') !== null;
    const hasHeader = await page.$('.header') !== null;
    check(`${path}: no .sidebar`, !hasSidebar);
    check(`${path}: no .header`, !hasHeader);
    await page.close();
  }

  // ── 5. Exactly one .sidebar on /, /trip/:id, /flight/:id ──
  for (const path of ['/', '/trip/1', '/flight/1']) {
    const page = await newPage(browser);
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
    const count = await page.$$eval('.sidebar', els => els.length);
    check(`${path}: exactly one .sidebar`, count === 1, `got ${count}`);
    await page.close();
  }

  // ── 6. Sidebar contents match the API ──
  {
    const page = await newPage(browser);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.sidebar-trip');
    const tripRowCount = await page.$$eval('.sidebar-trip', els => els.length);
    const trips = await (await fetch(`${BASE}/api/trips`)).json();
    check('trip row count == GET /api/trips length', tripRowCount === trips.length, `rows=${tripRowCount} api=${trips.length}`);

    // Expand trip 1 (Circumnavegação, 46 flights) by clicking its disclosure button
    // specifically, located by its NavLink href.
    const trip1 = trips.find(t => t.id === 1);
    await page.evaluate(() => {
      const link = [...document.querySelectorAll('.sidebar-trip-link')].find(a => a.getAttribute('href') === '/trip/1');
      const tripEl = link.closest('.sidebar-trip');
      const btn = tripEl.querySelector('.sidebar-disclosure');
      if (btn.getAttribute('aria-expanded') !== 'true') btn.click();
      return null;
    });
    await new Promise(r => setTimeout(r, 100));
    const subItemCount = await page.evaluate(() => {
      const link = [...document.querySelectorAll('.sidebar-trip-link')].find(a => a.getAttribute('href') === '/trip/1');
      const tripEl = link.closest('.sidebar-trip');
      return tripEl.querySelectorAll('.sidebar-leg').length;
    });
    check('trip 1 sub-item count == flights.length', subItemCount === trip1.flights.length, `got ${subItemCount} want ${trip1.flights.length}`);

    const flights = await (await fetch(`${BASE}/api/flights`)).json();
    const tripFlightIds = new Set(trips.flatMap(t => t.flights.map(f => f.id)));
    const ungroupedCount = flights.filter(f => !tripFlightIds.has(f.id)).length;
    const standaloneRows = await page.$$eval('.sidebar-section:last-of-type > .sidebar-item', els => els.length);
    check('standalone-flight item count == ungrouped flights', standaloneRows === ungroupedCount, `got ${standaloneRows} want ${ungroupedCount}`);

    console.log(`NUMBERS trips=${trips.length} trip1Legs=${trip1.flights.length} ungrouped=${ungroupedCount}`);
    await page.close();
  }

  // ── 7. Active state ──
  {
    const page = await newPage(browser);
    await page.goto(`${BASE}/trip/${trip2.id}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.sidebar-trip');
    const activeTripLinks = await page.$$eval('.sidebar-trip-link.is-active', els => els.map(e => e.getAttribute('href')));
    check(`/trip/${trip2.id}: exactly one active trip item, it is trip ${trip2.id}`, activeTripLinks.length === 1 && activeTripLinks[0] === `/trip/${trip2.id}`, JSON.stringify(activeTripLinks));
    await page.close();
  }
  {
    const page = await newPage(browser);
    await page.goto(`${BASE}/flight/${flightInTrip2}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.sidebar-trip');
    const activeLeg = await page.$$eval('.sidebar-leg.is-active', els => els.map(e => e.getAttribute('href')));
    const parentExpanded = await page.evaluate((tripHref) => {
      const link = [...document.querySelectorAll('.sidebar-trip-link')].find(a => a.getAttribute('href') === tripHref);
      const btn = link.closest('.sidebar-trip').querySelector('.sidebar-disclosure');
      return btn.getAttribute('aria-expanded') === 'true';
    }, `/trip/${trip2.id}`);
    check(`/flight/${flightInTrip2}: leg sub-item is-active`, activeLeg.length === 1 && activeLeg[0] === `/flight/${flightInTrip2}`, JSON.stringify(activeLeg));
    check(`/flight/${flightInTrip2}: parent trip auto-expanded without a click`, parentExpanded);
    await page.close();
  }

  // ── 8. Navigation ──
  {
    const page = await newPage(browser);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.sidebar-trip');
    await page.click(`.sidebar-trip-link[href="/trip/${trip2.id}"]`);
    await new Promise(r => setTimeout(r, 150));
    check('clicking trip item navigates to /trip/:id', new URL(page.url()).pathname === `/trip/${trip2.id}`, page.url());

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.sidebar-trip');
    const before = page.url();
    await page.evaluate((tripHref) => {
      const link = [...document.querySelectorAll('.sidebar-trip-link')].find(a => a.getAttribute('href') === tripHref);
      link.closest('.sidebar-trip').querySelector('.sidebar-disclosure').click();
    }, `/trip/${trip2.id}`);
    await new Promise(r => setTimeout(r, 150));
    check('clicking disclosure does not navigate', page.url() === before, `${before} -> ${page.url()}`);
    await page.close();
  }

  // ── 9. Collapse ──
  {
    const page = await newPage(browser);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.sidebar-toggle');
    await page.click('.sidebar-toggle');
    await new Promise(r => setTimeout(r, 100));
    const collapsedClass = await page.$eval('.sidebar', el => el.classList.contains('is-collapsed'));
    const stored = await page.evaluate(() => localStorage.getItem('sidebarCollapsed'));
    check('collapse: .sidebar gets is-collapsed', collapsedClass);
    check("collapse: localStorage sidebarCollapsed === '1'", stored === '1', stored);

    await page.reload({ waitUntil: 'networkidle0' });
    const collapsedAfterReload = await page.$eval('.sidebar', el => el.classList.contains('is-collapsed'));
    const toggleBox = await page.$eval('.sidebar-toggle', el => el.getBoundingClientRect().width);
    check('collapse persists across reload', collapsedAfterReload);
    check('toggle stays visible/clickable (width > 0) when collapsed', toggleBox > 0, toggleBox);
    await page.close();
  }

  // ── 10. Layout: map size + no horizontal overflow ──
  {
    const page = await newPage(browser, { width: 1280, height: 900 });
    await page.goto(`${BASE}/trip/1`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#map .leaflet-container', { timeout: 5000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 300));
    const mapWidth = await page.$eval('#map', el => el.getBoundingClientRect().width);
    const leafletHeight = await page.$eval('#map .leaflet-container', el => el.getBoundingClientRect().height).catch(() => 0);
    check('#map width >= 500px at 1280x900', mapWidth >= 500, mapWidth);
    check('.leaflet-container height > 0', leafletHeight > 0, leafletHeight);

    for (const path of ['/', '/trip/1', '/flight/1']) {
      const p2 = await newPage(browser, { width: 1280, height: 900 });
      await p2.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
      await new Promise(r => setTimeout(r, 200));
      const overflow = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      check(`${path}: no horizontal overflow`, overflow.sw <= overflow.iw + 1, JSON.stringify(overflow));
      await p2.close();
    }
    await page.close();
  }

  // ── 11. Home unchanged: #flights-table row count ──
  {
    const page = await newPage(browser);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#flights-table');
    const rowCount = await page.$$eval('#flights-table tbody tr', els => els.length);
    const trips = await (await fetch(`${BASE}/api/trips`)).json();
    const flights = await (await fetch(`${BASE}/api/flights`)).json();
    // Home's own row math: one row per flight + one header row per trip (+ ungrouped header if any).
    const ungroupedCount = flights.filter(f => !new Set(trips.flatMap(t => t.flights.map(x => x.id))).has(f.id)).length;
    const expected = flights.length + trips.length + (ungroupedCount > 0 && trips.length > 0 ? 1 : 0);
    console.log(`NUMBERS #flights-table rows=${rowCount} expected=${expected}`);
    check('#flights-table row count matches Home\'s own row math', rowCount === expected, `rows=${rowCount} expected=${expected}`);
    check('no console/page errors on /', page._errors.length === 0, JSON.stringify(page._errors));
    await page.close();
  }

} finally {
  await browser.close();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
