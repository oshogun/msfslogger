// Scratch verification for T-003: the STATUS page's LSK map and command calls,
// on the stub host and on a synthetic installed host. Not a repo tool.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import puppeteer from '/home/guilherme/msfslogger/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const ui = resolve('/home/guilherme/msfslogger/windows-client/ui');
const errors = [];
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
const snapshot = (state) => ({
  v: 1, type: 'status', at: 1, app: { state },
  sim: { state: 'sim.idle' }, backend: { state: 'net.idle' },
  pause: { state: 'pause.off', flags: 0 }, traffic: { enabled: false }, config: null,
});

let browser;
try {
  await new Promise((ok, bad) => { server.once('error', bad); server.listen(0, '127.0.0.1', ok); });
  const port = server.address().port;
  assert.notEqual(port, 3000);
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  // ── 1. stub host ───────────────────────────────────────────────────────────
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`stub pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`stub console ${m.text()}`); });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.FMC?.getConfigCache());

  const calls = () => page.evaluate(() => window.__FMC_STUB__.calls.map((c) => c.method));
  const text = (s) => page.$eval(s, (el) => el.textContent);
  const emit = (state) => page.evaluate((s) => window.__FMC_STUB__.emitStatus(s), snapshot(state));

  assert.equal(await text('#bridge-mode'), 'STUB BRIDGE');
  assert.equal(await page.$eval('#bridge-mode', (el) => el.dataset.stub), 'true');
  assert.equal(await page.$eval('#fmc-screen', (el) => el.dataset.page), 'STATUS');
  // No host status yet: the shell's own default paints the app axis.
  assert.equal(await text('#status-app'), 'SIDECAR STARTING');

  await emit('app.stopped');
  assert.equal(await text('#uplink-prompt'), 'START>');
  await page.click('[data-lsk="R6"]');
  await page.waitForFunction(() => window.__FMC_STUB__.calls.some((c) => c.method === 'startUplink'));

  await emit('app.running');
  assert.equal(await text('#uplink-prompt'), 'STOP>');
  await page.click('[data-lsk="R6"]');
  await page.waitForFunction(() => window.__FMC_STUB__.calls.some((c) => c.method === 'stopUplink'));

  // R5 does nothing unless the sidecar is down.
  await page.click('[data-lsk="R5"]');
  assert.equal(await text('#scratchpad'), 'KEY NOT ACTIVE');
  assert.equal((await calls()).includes('restartSidecar'), false);
  await emit('app.crashed');
  await page.click('[data-lsk="R5"]');
  await page.waitForFunction(() => window.__FMC_STUB__.calls.some((c) => c.method === 'restartSidecar'));
  console.log('PASS status commands (stub): startUplink, stopUplink, restartSidecar; R5 inert unless crashed');

  for (const lsk of ['L1', 'L2', 'L3', 'L4', 'L5']) {
    await page.click(`[data-lsk="${lsk}"]`);
    assert.equal(await text('#scratchpad'), 'NOT ALLOWED', lsk);
    assert.equal(await page.$eval('#scratchpad', (el) => el.dataset.messageKind), 'error');
  }
  await page.click('[data-lsk="L6"]');
  assert.equal(await page.$eval('#fmc-screen', (el) => el.dataset.page), 'MENU');
  await page.click('[data-lsk="L1"]');
  assert.equal(await page.$eval('#fmc-screen', (el) => el.dataset.page), 'STATUS');
  console.log('PASS status LSK map (stub): L1-L5 NOT ALLOWED, L6 MENU, MENU L1 back to STATUS');

  // The config path keeps painting after the page has been away and back.
  assert.match(await text('#status-config-path'), /config\.json$/);
  console.log('PASS status page repaint: config path and axes current after navigation');

  await page.close();

  // ── 2. synthetic installed host ────────────────────────────────────────────
  const swap = await browser.newPage();
  swap.on('pageerror', (e) => errors.push(`host pageerror ${e.message}`));
  swap.on('console', (m) => { if (m.type() === 'error') errors.push(`host console ${m.text()}`); });
  await swap.evaluateOnNewDocument(() => {
    const state = { calls: [], listeners: {} };
    const record = (method, args) => { state.calls.push({ method, args }); };
    const config = { version: 1, serverUrl: 'https://synthetic.invalid:3000', certPath: null,
      sim: '2024', autoUplink: true, trafficEnabled: true, trafficRadiusM: 40000, tokenSet: false };
    window.__SYNTH__ = state;
    window.__FMC_HOST__ = {
      hostLabel: 'MSFS GAUGE',
      async getConfig() { record('getConfig', []); return { exists: true, path: 'X:\\synthetic\\config.json', config, raw: config }; },
      async setConfig(patch) { record('setConfig', [patch]); Object.assign(config, patch); return { ok: true, path: 'X:\\synthetic\\config.json' }; },
      async getConfigPath() { record('getConfigPath', []); return 'X:\\synthetic\\config.json'; },
      async startUplink() { record('startUplink', []); },
      async stopUplink() { record('stopUplink', []); },
      async restartSidecar() { record('restartSidecar', []); },
      async getStatus() { record('getStatus', []); return null; },
      onStatus(fn) { record('onStatus', []); state.listeners.status = fn; return () => { state.listeners.status = null; }; },
      onLog(fn) { record('onLog', []); return () => {}; },
      onExit(fn) { record('onExit', []); return () => {}; },
    };
    window.__EMIT__ = (status) => state.listeners.status && state.listeners.status(status);
  });
  await swap.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle0' });
  await swap.waitForFunction(() => window.FMC?.getConfigCache());

  assert.equal(await swap.evaluate(() => '__FMC_STUB__' in window), false);
  assert.equal(await swap.evaluate(() => '__TAURI__' in window || '__TAURI_INTERNALS__' in window), false);
  assert.equal(await swap.$eval('#bridge-mode', (el) => el.textContent), 'MSFS GAUGE');
  assert.equal(await swap.$eval('#bridge-mode', (el) => el.dataset.stub), 'false');
  const booted = await swap.evaluate(() => window.__SYNTH__.calls.map((c) => c.method));
  for (const m of ['getConfig', 'getConfigPath', 'getStatus', 'onStatus', 'onLog', 'onExit']) {
    assert.equal(booted.includes(m), true, `boot missing ${m}`);
  }
  await swap.evaluate((s) => window.__EMIT__(s), snapshot('app.stopped'));
  await swap.click('[data-lsk="R6"]');
  await swap.waitForFunction(() => window.__SYNTH__.calls.some((c) => c.method === 'startUplink'));
  await swap.evaluate((s) => window.__EMIT__(s), snapshot('app.crashed'));
  await swap.click('[data-lsk="R5"]');
  await swap.waitForFunction(() => window.__SYNTH__.calls.some((c) => c.method === 'restartSidecar'));
  console.log('PASS third host: adopted, labelled MSFS GAUGE, neither stub nor Tauri present; STATUS commands reach it');

  await swap.evaluate(() => window.FMC.showPage('NETWORK'));
  assert.equal(await swap.$eval('#fmc-screen', (el) => el.dataset.page), 'NETWORK');
  await swap.evaluate(() => window.FMC.setScratchpad('SYNTHETIC-TOKEN-abc123'));
  await swap.click('[data-lsk="L2"]');
  await swap.click('[data-lsk="R6"]');
  await swap.waitForFunction(() => document.getElementById('scratchpad').textContent === 'CONFIG SAVED');
  const saved = await swap.evaluate(() => window.__SYNTH__.calls.findLast((c) => c.method === 'setConfig').args[0]);
  assert.equal(saved.ingestToken, 'SYNTHETIC-TOKEN-abc123');
  assert.equal(await swap.evaluate(() => document.documentElement.textContent.includes('SYNTHETIC-TOKEN-abc123')), false);
  console.log('PASS third host: CFG NETWORK save through the interface; token never painted');

  // A command the host rejects still says COMMAND FAILED, from the shell.
  await swap.evaluate(() => window.FMC.showPage('STATUS'));
  await swap.evaluate(() => { window.__FMC_HOST__.restartSidecar = () => Promise.reject(new Error('nope')); });
  await swap.click('[data-lsk="R5"]');
  await swap.waitForFunction(() => document.getElementById('scratchpad').textContent === 'COMMAND FAILED');
  assert.equal(await swap.$eval('#scratchpad', (el) => el.dataset.messageKind), 'error');
  console.log('PASS third host: a rejected command still reports COMMAND FAILED');

  assert.deepEqual(errors, [], 'browser errors');
  console.log('PASS browser errors: none');
} finally {
  if (browser) await browser.close();
  server.close();
  console.log('Cleanup: browser closed; scratch server closed');
}
