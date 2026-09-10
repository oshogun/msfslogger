import puppeteer from 'puppeteer';

const BASE = 'http://localhost:3100';

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

page.on('dialog', async d => { await d.accept(); });

await page.goto(`${BASE}/flights`, { waitUntil: 'networkidle0' });

// Select the two seeded flights with points (65, 63).
await page.evaluate(() => {
  const rows = [65, 63].map(id => document.querySelector(`tr[data-id="${id}"] input.row-check`));
  for (const cb of rows) {
    if (!cb) throw new Error('checkbox not found');
    cb.click();
  }
});

await new Promise(r => setTimeout(r, 300));

await page.click('.combine-toolbar button.btn-primary');

await page.waitForFunction(() => /\/flight\/\d+$/.test(location.pathname), { timeout: 5000 });

console.log('URL after combine:', await page.evaluate(() => location.pathname));

await browser.close();
