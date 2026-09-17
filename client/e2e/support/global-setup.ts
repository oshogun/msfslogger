import { request, type APIRequestContext } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { STORAGE_STATE } from './paths';

const READY_TIMEOUT_MS = 180_000; // matches webServer.timeout in the config
const READY_POLL_MS = 500;

/**
 * Waits for the scratch server to answer before anything else runs. Do not
 * remove this in the belief that the web server is always up by now: the login
 * below is the first request of the run, and if it is ever issued against a
 * port nothing is listening on, the whole suite fails with a connection error
 * that looks nothing like the real cause.
 */
async function waitForServer(ctx: APIRequestContext): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = '';
  for (;;) {
    try {
      const res = await ctx.get('/login', { timeout: 5_000 });
      if (res.ok()) return;
      last = `HTTP ${res.status()}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    if (Date.now() >= deadline) {
      throw new Error(`e2e server not ready after ${READY_TIMEOUT_MS} ms: ${last}`);
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
}

export default async function globalSetup(): Promise<void> {
  const port = process.env.MSFSLOGGER_E2E_PORT ?? '3210';
  const baseURL = `http://127.0.0.1:${port}`;
  const username = process.env.MSFSLOGGER_E2E_USERNAME ?? 'e2e';
  const password = process.env.MSFSLOGGER_E2E_PASSWORD ?? 'e2e-password-123';

  const ctx = await request.newContext({ baseURL });
  await waitForServer(ctx);
  const res = await ctx.post('/api/auth/login', { data: { username, password } });
  if (res.status() !== 200) {
    throw new Error(`e2e login failed: ${res.status()} ${await res.text()}`);
  }
  await mkdir(path.dirname(STORAGE_STATE), { recursive: true });
  await ctx.storageState({ path: STORAGE_STATE });
  await ctx.dispose();
}
