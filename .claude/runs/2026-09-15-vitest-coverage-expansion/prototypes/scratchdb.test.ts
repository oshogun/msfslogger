// Prototype B: can Vitest load better-sqlite3 (native addon), run the REAL
// applySchema() against a temp-file database, WAL, backup() and tear down?
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applySchema } from '../../../../src/db/schema';

const made: string[] = [];

function makeScratchDb(): { db: Database.Database; file: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msfslogger-test-'));
  made.push(dir);
  const file = path.join(dir, 'flights.db');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  return { db, file, dir };
}

afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('scratch sqlite harness', () => {
  it('applies the real schema and round-trips a flight', () => {
    const { db, file, dir } = makeScratchDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    console.info('tables:', tables.map(t => t.name).join(','));
    const info = db.prepare("INSERT INTO flights (aircraft, start_time) VALUES (?, ?)").run('C172', '2026-09-15T00:00:00.000Z');
    expect(Number(info.lastInsertRowid)).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    console.info('siblings after write:', fs.readdirSync(dir).join(','));
    // idempotent second application
    expect(() => applySchema(db)).not.toThrow();
    expect((db.prepare('SELECT COUNT(*) c FROM flights').get() as { c: number }).c).toBe(1);
    db.close();
    console.info('siblings after close:', fs.readdirSync(dir).join(','));
    expect(fs.existsSync(file)).toBe(true);
  });

  it('supports db.backup() to another temp dir (what src/backup.ts does)', async () => {
    const { db, dir } = makeScratchDb();
    db.prepare("INSERT INTO flights (aircraft, start_time) VALUES (?, ?)").run('A320', '2026-09-15T01:00:00.000Z');
    db.close();
    const src = new Database(path.join(dir, 'flights.db'), { readonly: true });
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msfslogger-test-bk-'));
    made.push(destDir);
    const out = path.join(destDir, 'flights.db');
    await src.backup(out);
    src.close();
    const check = new Database(out, { readonly: true });
    expect((check.prepare('SELECT COUNT(*) c FROM flights').get() as { c: number }).c).toBe(1);
    check.pragma('integrity_check');
    check.close();
  });

  it('env override is readable per call', () => {
    const read = () => process.env.MSFSLOGGER_DB_PATH ?? path.join(process.cwd(), 'flights.db');
    const before = read();
    process.env.MSFSLOGGER_DB_PATH = '/tmp/x/flights.db';
    expect(read()).toBe('/tmp/x/flights.db');
    delete process.env.MSFSLOGGER_DB_PATH;
    expect(read()).toBe(before);
  });
});
