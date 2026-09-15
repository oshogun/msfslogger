// tests/setPassword.test.ts — src/setPassword.ts's parseUsername() seam, plus
// the require.main guard. Dynamic import throughout, with FLIGHTS_DB_PATH
// pointed at a scratch file first, in case the guard ever regresses: this
// script's main() opens flights.db directly.
//
// process.exit is stubbed per test (not in a shared helper — this is the only
// file that calls it) so a failing parse throws instead of killing the
// worker; console.error/log are already stubbed by tests/setup.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScratchDb, destroyScratchDb, useScratchDbEnv, type ScratchDb } from './helpers/db';

describe('src/setPassword.ts', () => {
  let scratch: ScratchDb;
  let restoreEnv: () => void;

  beforeEach(() => {
    scratch = createScratchDb();
    restoreEnv = useScratchDbEnv(scratch.file);
    vi.resetModules();
  });

  afterEach(() => {
    restoreEnv();
    destroyScratchDb(scratch);
  });

  function stubExit() {
    return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  }

  it('does not run main() at import time', async () => {
    const dbMod = await import('../src/db');
    await import('../src/setPassword');
    expect(dbMod.getDb()).toBeUndefined();
  });

  it('defaults to "operator" when no --username is given', async () => {
    const mod = await import('../src/setPassword');
    expect(mod.parseUsername([])).toBe('operator');
  });

  it('accepts --username <value>', async () => {
    const mod = await import('../src/setPassword');
    expect(mod.parseUsername(['--username', 'alice'])).toBe('alice');
  });

  it('accepts --username=<value>', async () => {
    const mod = await import('../src/setPassword');
    expect(mod.parseUsername(['--username=bob'])).toBe('bob');
  });

  it('trims the result', async () => {
    const mod = await import('../src/setPassword');
    expect(mod.parseUsername(['--username=  carol  '])).toBe('carol');
  });

  it('exits 1 when --username has no value', async () => {
    const mod = await import('../src/setPassword');
    const exit = stubExit();
    expect(() => mod.parseUsername(['--username'])).toThrow('process.exit(1)');
    expect(exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith('--username needs a value.');
  });

  it('rejects --password without ever reading the value it was given', async () => {
    const mod = await import('../src/setPassword');
    const exit = stubExit();
    expect(() => mod.parseUsername(['--password', 'hunter2'])).toThrow('process.exit(1)');
    expect(exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('This tool never takes a password as an argument')
    );
    // The rejection message itself is the only observable outcome — nowhere
    // does the string "hunter2" reach a variable, a log line, or a return
    // value this test (or the real tool) could inspect.
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('hunter2'));
  });

  it('rejects --password=<value> the same way', async () => {
    const mod = await import('../src/setPassword');
    const exit = stubExit();
    expect(() => mod.parseUsername(['--password=hunter2'])).toThrow('process.exit(1)');
    expect(exit).toHaveBeenCalledWith(1);
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('hunter2'));
  });

  it('exits 1 on an unrecognised argument', async () => {
    const mod = await import('../src/setPassword');
    const exit = stubExit();
    expect(() => mod.parseUsername(['--bogus'])).toThrow('process.exit(1)');
    expect(exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unrecognised argument "--bogus"'));
  });
});
