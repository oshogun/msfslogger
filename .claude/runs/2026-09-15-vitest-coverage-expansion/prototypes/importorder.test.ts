// Prototype D: the safety net. If a CLI script's guard ever regressed, would a
// dynamic import after the env is pointed at a scratch file still keep the
// live flights.db untouched? And does setup-time env survive to import time?
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let dir: string;
let file: string;
const prior = process.env.FLIGHTS_DB_PATH;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msfslogger-test-'));
  file = path.join(dir, 'flights.db');
  process.env.FLIGHTS_DB_PATH = file;
});
afterAll(() => {
  if (prior === undefined) delete process.env.FLIGHTS_DB_PATH; else process.env.FLIGHTS_DB_PATH = prior;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('dynamic import ordering', () => {
  it('env set in beforeAll is visible to a module imported inside the test', async () => {
    const seen: string[] = [];
    // stand-in for src/db/connection.ts's resolveDbPath()
    const mod = await import('./env-reader');
    seen.push(mod.resolveDbPath());
    expect(seen[0]).toBe(file);
  });

  it('a statically imported module would have seen the env too (forks pool: per-file process)', async () => {
    const mod = await import('./env-reader');
    expect(mod.RESOLVED_AT_IMPORT).toBe(file);
  });
});
