/* Drives the real page in headless Chrome against the scratch server on 3100. */
const puppeteer = require('/home/guilherme/msfslogger/node_modules/puppeteer');

const BASE = 'http://127.0.0.1:3100';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function dumpThread(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('.acars-msg')];
    return {
      subtitle: document.querySelector('.flight-subtitle')?.textContent ?? null,
      empty: document.querySelector('.acars-empty')?.textContent ?? null,
      rows: rows.map(r => ({
        rowClass: r.className,
        badges: [...r.querySelectorAll('.badge')].map(b => `${b.className}="${b.textContent}"`),
        head: r.querySelector('.acars-msg-head').innerText.replace(/\s+/g, ' ').trim(),
        body: r.querySelector('.acars-msg-body').textContent,
      })),
      buttons: [...document.querySelectorAll('.acars-send button')].map(b => ({
        text: b.textContent, disabled: b.disabled,
      })),
      sendError: document.querySelector('.notes-section .edit-error')?.textContent ?? null,
    };
  });
}

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.setViewport({ width: 1280, height: 900 });

  // ── login ──
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
  await page.type('input[name="username"]', 'scratchop');
  await page.type('input[name="password"]', 'scratch-password-123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(500);
  console.log('## LOGIN url:', page.url());

  // ── AC1/AC2: thread render, newest first, uplink + downlink, 2+ categories ──
  await page.goto(`${BASE}/flight/81/acars`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.acars-thread');
  console.log('## A. THREAD (seeded uplinks only)');
  console.log(JSON.stringify(await dumpThread(page), null, 1));

  // ── AC3: click each canned button, capture POST responses ──
  const posts = [];
  page.on('response', async res => {
    if (res.request().method() === 'POST' && res.url().endsWith('/acars-messages')) {
      posts.push({ status: res.status(), body: await res.text() });
    }
  });
  const labels = await page.$$eval('.acars-send button', bs => bs.map(b => b.textContent));
  console.log('## B. CANNED LABELS:', JSON.stringify(labels));
  for (const label of labels) {
    const before = await page.$$eval('.acars-msg', r => r.length);
    await page.evaluate(l => {
      [...document.querySelectorAll('.acars-send button')].find(b => b.textContent === l).click();
    }, label);
    await page.waitForFunction(n => document.querySelectorAll('.acars-msg').length > n, {}, before);
  }
  console.log('## C. POST RESPONSES');
  posts.forEach(p => console.log(p.status, p.body));
  console.log('## D. THREAD AFTER CLICKS (no reload, no refetch)');
  console.log(JSON.stringify(await dumpThread(page), null, 1));
  console.log('## E. NO FREE TEXT INPUT ON PAGE:',
    await page.evaluate(() => document.querySelectorAll('#acars-messages input, #acars-messages textarea').length));

  // ── empty thread ──
  await page.goto(`${BASE}/flight/80/acars`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.acars-thread');
  const emptyDump = await dumpThread(page);
  console.log('## F. EMPTY THREAD:', JSON.stringify({ subtitle: emptyDump.subtitle, empty: emptyDump.empty, buttons: emptyDump.buttons.length }));

  // ── flight not found ──
  await page.goto(`${BASE}/flight/999999/acars`, { waitUntil: 'networkidle0' });
  await sleep(400);
  console.log('## G. NOT FOUND:', JSON.stringify(await page.evaluate(() => ({
    error: document.querySelector('.edit-error')?.textContent ?? null,
    back: document.querySelector('.back-link')?.textContent ?? null,
    thread: document.querySelectorAll('.acars-thread').length,
    send: document.querySelectorAll('.acars-send').length,
  }))));

  // ── loading state (thread GET held open) ──
  await page.setRequestInterception(true);
  let holdThread = true;
  const onReqLoading = async req => {
    if (holdThread && req.method() === 'GET' && req.url().endsWith('/81/acars-messages')) {
      await sleep(1500);
    }
    req.continue();
  };
  page.on('request', onReqLoading);
  page.goto(`${BASE}/flight/81/acars`).catch(() => {});
  await page.waitForFunction(() => document.querySelector('.flight-plan-status'), { timeout: 8000 });
  console.log('## H. LOADING:', JSON.stringify(await page.evaluate(() => ({
    status: document.querySelector('.flight-plan-status')?.textContent ?? null,
    sendButtons: document.querySelectorAll('.acars-send button').length,
  }))));
  holdThread = false;
  await page.waitForSelector('.acars-thread');
  page.off('request', onReqLoading);

  // ── send in flight: hold the POST open, read the buttons ──
  let holdPost = true;
  const onReqPost = async req => {
    if (holdPost && req.method() === 'POST' && req.url().endsWith('/acars-messages')) await sleep(2000);
    req.continue();
  };
  page.on('request', onReqPost);
  await page.evaluate(() => document.querySelectorAll('.acars-send button')[0].click());
  await sleep(400);
  console.log('## I. SEND IN FLIGHT:', JSON.stringify((await dumpThread(page)).buttons));
  await sleep(2200);
  holdPost = false;
  page.off('request', onReqPost);

  // ── send rejected: rewrite the body to an unknown id, real server 400 ──
  const beforeReject = await dumpThread(page);
  const onReqBad = req => {
    if (req.method() === 'POST' && req.url().endsWith('/acars-messages')) {
      req.continue({ postData: JSON.stringify({ canned_id: 'no-such-message' }) });
    } else req.continue();
  };
  page.on('request', onReqBad);
  await page.evaluate(() => document.querySelectorAll('.acars-send button')[0].click());
  await sleep(800);
  const afterReject = await dumpThread(page);
  console.log('## J. SEND REJECTED:', JSON.stringify({
    sendError: afterReject.sendError,
    rowsBefore: beforeReject.rows.length,
    rowsAfter: afterReject.rows.length,
    buttonsReEnabled: afterReject.buttons.every(b => !b.disabled),
  }));
  page.off('request', onReqBad);

  // ── canned list fails, thread still loads ──
  const onReqNoCanned = req => {
    if (req.url().endsWith('/api/acars/canned-messages')) req.respond({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
    else req.continue();
  };
  page.on('request', onReqNoCanned);
  await page.goto(`${BASE}/flight/81/acars`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.acars-thread');
  console.log('## K. CANNED UNAVAILABLE:', JSON.stringify(await page.evaluate(() => ({
    error: document.querySelector('.notes-section .edit-error')?.textContent ?? null,
    buttons: document.querySelectorAll('.acars-send button').length,
    rows: document.querySelectorAll('.acars-msg').length,
  }))));
  page.off('request', onReqNoCanned);
  await page.setRequestInterception(false);

  // ── 401 on send: cookie dropped mid-session ──
  await page.goto(`${BASE}/flight/81/acars`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.acars-send button');
  const client = await page.target().createCDPSession();
  await client.send('Network.clearBrowserCookies');
  await page.evaluate(() => document.querySelectorAll('.acars-send button')[0].click());
  await sleep(1200);
  console.log('## L. 401 PATH:', JSON.stringify({
    url: page.url(),
    inlineError: await page.evaluate(() => document.querySelector('.edit-error')?.textContent ?? null),
    loginForm: await page.evaluate(() => document.querySelectorAll('.login-form').length),
  }));

  await browser.close();
})().catch(err => { console.error('FAILED', err); process.exit(1); });
