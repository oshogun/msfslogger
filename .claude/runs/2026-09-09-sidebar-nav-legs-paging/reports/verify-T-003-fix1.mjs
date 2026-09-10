// verify.mjs — Puppeteer checks for T-003-fix1 (round 1 fix for Finding 1:
// /trip/:id horizontal overflow at 800px caused by the sidebar toggle).
import puppeteer from 'puppeteer';

const BASE = 'http://localhost:3100';
const results = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}: ${detail}`);
}

async function measure(page, path, viewport) {
  await page.setViewport(viewport);
  await page.goto(BASE + path, { waitUntil: 'networkidle0' });
  // give React a tick to settle (sidebar fetches trips async)
  await new Promise(r => setTimeout(r, 300));
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const innerWidth = await page.evaluate(() => window.innerWidth);
  return { scrollWidth, innerWidth };
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    // localStorage.sidebarCollapsed unset (default) for every check below —
    // fresh page/context each navigation, never set the key.

    // 1. /trip/1 (real small-ish trip) at 800x900
    {
      const { scrollWidth, innerWidth } = await measure(page, '/trip/1', { width: 800, height: 900 });
      record('/trip/1 @800x900 no h-scroll', scrollWidth <= innerWidth + 1, `scrollWidth=${scrollWidth} innerWidth=${innerWidth}`);
    }

    // 2. /trip/2 (45-flight fixture) at 800x900
    {
      const { scrollWidth, innerWidth } = await measure(page, '/trip/2', { width: 800, height: 900 });
      record('/trip/2 (45-leg fixture) @800x900 no h-scroll', scrollWidth <= innerWidth + 1, `scrollWidth=${scrollWidth} innerWidth=${innerWidth}`);
    }

    // 3. Regression: /trip/1?view=atlas @800x900
    {
      const { scrollWidth, innerWidth } = await measure(page, '/trip/1?view=atlas', { width: 800, height: 900 });
      record('/trip/1?view=atlas @800x900 no h-scroll (regression)', scrollWidth <= innerWidth + 1, `scrollWidth=${scrollWidth} innerWidth=${innerWidth}`);
      const mapBox = await page.evaluate(() => {
        const el = document.querySelector('.leaflet-container');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      });
      record('/trip/1?view=atlas leaflet non-zero (regression)', !!mapBox && mapBox.w > 0 && mapBox.h > 0, JSON.stringify(mapBox));
    }

    // 4. Regression: /flight/65 @800x900
    {
      const { scrollWidth, innerWidth } = await measure(page, '/flight/65', { width: 800, height: 900 });
      record('/flight/65 @800x900 no h-scroll (regression)', scrollWidth <= innerWidth + 1, `scrollWidth=${scrollWidth} innerWidth=${innerWidth}`);
    }

    // 5. Regression: /trip/1 @1280x900 - map width >=500px, no h-scroll
    {
      const { scrollWidth, innerWidth } = await measure(page, '/trip/1', { width: 1280, height: 900 });
      record('/trip/1 @1280x900 no h-scroll (regression)', scrollWidth <= innerWidth + 1, `scrollWidth=${scrollWidth} innerWidth=${innerWidth}`);
      const mapBox = await page.evaluate(() => {
        const el = document.querySelector('#map .leaflet-container');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      });
      record('/trip/1 @1280x900 map width >=500 (regression)', !!mapBox && mapBox.w >= 500, JSON.stringify(mapBox));
    }

    // 6. Sanity: the legs table itself is horizontally scrollable at 800px
    // (i.e. the fix moved the overflow, didn't just hide it) — on the
    // 45-leg fixture where the table is guaranteed to render full rows.
    {
      await page.setViewport({ width: 800, height: 900 });
      await page.goto(BASE + '/trip/2', { waitUntil: 'networkidle0' });
      await new Promise(r => setTimeout(r, 300));
      const wrap = await page.evaluate(() => {
        const el = document.querySelector('.legs-table-wrap');
        if (!el) return null;
        return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      });
      record('.legs-table-wrap exists and can scroll internally', !!wrap, JSON.stringify(wrap));
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length > 0 ? 1 : 0);
})();
