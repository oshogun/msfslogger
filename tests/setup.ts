import { beforeEach, vi } from 'vitest';
import os from 'os';
import path from 'path';

// Nothing in the suite may resolve to the repository's real flights.db. Tests
// that need a database create their own scratch file and point this at it; this
// default only has to be somewhere harmless.
process.env.FLIGHTS_DB_PATH ??= path.join(os.tmpdir(), `msfslogger-test-fallback-${process.pid}.db`);

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
