import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import puppeteer from '/home/guilherme/msfslogger/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
const ui = resolve('/home/guilherme/msfslogger/windows-client/ui');
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const path = resolve(ui, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!path.startsWith(`${ui}${sep}`)) { res.writeHead(403).end(); return; }
    const body = await readFile(path);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
let browser;
try {
  await new Promise((ok, bad) => { server.once('error', bad); server.listen(0, '127.0.0.1', ok); });
  const port = server.address().port;
  assert.notEqual(port, 3000);
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    const invoked = [];
    window.__INVOKED__ = invoked;
    window.__TAURI__ = {
      core: { invoke: (cmd) => { invoked.push(cmd); return Promise.resolve(cmd === 'config_get'
        ? { exists: true, path: 'C:\\t\\config.json', config: { version: 1 }, raw: { version: 1 } }
        : cmd === 'config_path' ? 'C:\\t\\config.json' : null); } },
      event: { listen: () => Promise.resolve(() => {}) },
    };
  });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.FMC?.getConfigCache());
  assert.equal(await page.$eval('#bridge-mode', (el) => el.textContent), 'TAURI');
  assert.equal(await page.$eval('#bridge-mode', (el) => el.dataset.stub), 'false');
  assert.equal(await page.evaluate(() => '__FMC_STUB__' in window), false);
  await page.click('[data-lsk="R6"]');
  await page.waitForFunction(() => window.__INVOKED__.includes('uplink_start'));
  console.log('PASS tauri branch: adapter chosen, labelled TAURI, data-stub false, R6 invokes uplink_start');
} finally { if (browser) await browser.close(); server.close(); }
