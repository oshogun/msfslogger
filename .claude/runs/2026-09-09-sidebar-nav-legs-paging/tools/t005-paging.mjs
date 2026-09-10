import puppeteer from 'puppeteer';

const BASE = 'http://localhost:3101';

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

await page.goto(`${BASE}/trip/1?page=3`, { waitUntil: 'networkidle0' });

const rowCount = await page.$$eval('.legs-section td.td-aircraft', els => els.length);
const pageLabel = await page.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /Page \d+ of \d+/.test(e.textContent || ''));
  return el ? el.textContent.trim() : null;
});

console.log('rowCount', rowCount, 'pageLabel', pageLabel);

await browser.close();
