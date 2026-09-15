// tests/db/connection.test.ts — the FLIGHTS_DB_PATH seam and the scratch
// harness's real-file lifecycle. A real database, never mocked (a file that
// calls createScratchDb() must not vi.mock('../src/db')).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDb, closeDb, getDb, resolveDbPath } from '../../src/db';
import { createScratchDb, destroyScratchDb, scratchDbRoot, type ScratchDb } from '../helpers/db';

function withSavedEnv(fn: () => void): void {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'FLIGHTS_DB_PATH');
  const prev = process.env.FLIGHTS_DB_PATH;
  try {
    fn();
  } finally {
    if (had) {
      process.env.FLIGHTS_DB_PATH = prev;
    } else {
      delete process.env.FLIGHTS_DB_PATH;
    }
  }
}

describe('resolveDbPath()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to the working directory joined with the default filename when unset', () => {
    withSavedEnv(() => {
      delete process.env.FLIGHTS_DB_PATH;
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/scratch/somewhere');
      expect(resolveDbPath()).toBe(path.join('/scratch/somewhere', 'flights.db'));
      cwdSpy.mockRestore();
    });
  });

  it('uses FLIGHTS_DB_PATH when it is set', () => {
    withSavedEnv(() => {
      process.env.FLIGHTS_DB_PATH = '/scratch/override/flights.db';
      expect(resolveDbPath()).toBe('/scratch/override/flights.db');
    });
  });

  it('treats an empty string the same as unset', () => {
    withSavedEnv(() => {
      process.env.FLIGHTS_DB_PATH = '';
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/scratch/somewhere');
      expect(resolveDbPath()).toBe(path.join('/scratch/somewhere', 'flights.db'));
      cwdSpy.mockRestore();
    });
  });
});

describe('initDb() precedence', () => {
  const dirs: string[] = [];

  function newScratchDir(): string {
    const dir = fs.mkdtempSync(path.join(scratchDbRoot(), 'msfslogger-test-'));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    closeDb();
    vi.restoreAllMocks();
    while (dirs.length) {
      fs.rmSync(dirs.pop() as string, { recursive: true, force: true });
    }
  });

  it('an explicit argument wins over FLIGHTS_DB_PATH', () => {
    withSavedEnv(() => {
      const wanted = path.join(newScratchDir(), 'flights.db');
      const decoy = path.join(newScratchDir(), 'decoy.db');
      process.env.FLIGHTS_DB_PATH = decoy;

      const db = initDb(wanted);

      expect(db.name).toBe(wanted);
      expect(fs.existsSync(decoy)).toBe(false);
    });
  });

  it('FLIGHTS_DB_PATH wins over the default when no argument is given', () => {
    withSavedEnv(() => {
      const wanted = path.join(newScratchDir(), 'flights.db');
      process.env.FLIGHTS_DB_PATH = wanted;

      const db = initDb();

      expect(db.name).toBe(wanted);
    });
  });

  it('falls back to the working directory joined with the default filename when nothing else is set', () => {
    withSavedEnv(() => {
      delete process.env.FLIGHTS_DB_PATH;
      const dir = newScratchDir();
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dir);

      const db = initDb();

      expect(db.name).toBe(path.join(dir, 'flights.db'));
      cwdSpy.mockRestore();
    });
  });
});

describe('the scratch harness', () => {
  let scratch: ScratchDb | undefined;

  afterEach(() => {
    if (scratch && fs.existsSync(scratch.dir)) {
      destroyScratchDb(scratch);
    }
    scratch = undefined;
  });

  it('creates a real temp-file database, not :memory:, with applySchema() run against it', () => {
    scratch = createScratchDb();
    expect(fs.existsSync(scratch.file)).toBe(true);
    expect(getDb()).toBe(scratch.db);
    const tables = scratch.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(tables.map(t => t.name)).toContain('flights');
  });

  it('destroys the database file, its WAL/SHM siblings, and the temp directory', () => {
    scratch = createScratchDb();
    scratch.db.prepare("INSERT INTO trips (name, created_at) VALUES ('x', '2026-01-01T00:00:00.000Z')").run();
    expect(fs.existsSync(`${scratch.file}-wal`)).toBe(true);

    destroyScratchDb(scratch);

    expect(fs.existsSync(scratch.file)).toBe(false);
    expect(fs.existsSync(`${scratch.file}-wal`)).toBe(false);
    expect(fs.existsSync(`${scratch.file}-shm`)).toBe(false);
    expect(fs.existsSync(scratch.dir)).toBe(false);
  });

  it('is safe to call destroyScratchDb() twice', () => {
    scratch = createScratchDb();
    destroyScratchDb(scratch);
    expect(() => destroyScratchDb(scratch as ScratchDb)).not.toThrow();
  });
});
