// tests/config.test.ts — design.md §7, §11, §12 (run 2026-09-10-security-hardening).
//
// New file, no existing test file edited (design §19 item 5). Every loadConfig
// call below passes a synthetic env object, never process.env. console.warn is
// already spied and silenced by tests/setup.ts's global beforeEach — this file
// asserts against that same spy via vi.mocked(console.warn).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as tls from 'tls';
import { ConfigError, ENV_VARS, getConfig, loadConfig, parseBooleanEnv } from '../src/config';

// A base env with the two mandatory-by-default settings satisfied, so tests
// that are not exercising TLS/ingest specifically don't trip an unrelated
// fatal branch. BIND_HOST defaults to '0.0.0.0' (non-loopback), so plaintext
// needs the explicit opt-out.
function baseEnv(over: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    INGEST_TOKEN: 'x'.repeat(24),
    ALLOW_PLAINTEXT_HTTP: '1',
    ...over,
  } as NodeJS.ProcessEnv;
}

describe('ENV_VARS', () => {
  it('lists every env var this design introduces or changes', () => {
    expect(ENV_VARS).toEqual([
      'TLS_CERT_FILE',
      'TLS_KEY_FILE',
      'TLS_KEY_PASSPHRASE',
      'ALLOW_PLAINTEXT_HTTP',
      'BIND_HOST',
      'SESSION_SECRET',
      'ALLOW_UNAUTHENTICATED_INGEST',
      'INGEST_TOKEN',
    ]);
  });
});

describe('parseBooleanEnv (§7.2 truth table)', () => {
  it.each([
    ['1', true],
    ['true', true],
    ['yes', true],
    ['on', true],
    ['TRUE', true],
    [' On ', true],
    [undefined, false],
    ['', false],
    ['0', false],
    ['no', false],
    ['maybe', false],
    ['2', false],
  ] as const)('parseBooleanEnv(%p) -> %p', (input, expected) => {
    expect(parseBooleanEnv(input)).toBe(expected);
  });
});

describe('§7.3 fatal branches', () => {
  it('step 1: TLS pair set one-sided (cert only)', () => {
    expect(() => loadConfig(baseEnv({ TLS_CERT_FILE: '/some/cert.pem', TLS_KEY_FILE: undefined }))).toThrow(
      new ConfigError(
        'TLS_CERT_FILE and TLS_KEY_FILE must be set together. Set both to enable HTTPS, or neither to run plaintext HTTP (README § HTTPS).'
      )
    );
  });

  it('step 1: TLS pair set one-sided (key only)', () => {
    expect(() => loadConfig(baseEnv({ TLS_KEY_FILE: '/some/key.pem' }))).toThrow(
      new ConfigError(
        'TLS_CERT_FILE and TLS_KEY_FILE must be set together. Set both to enable HTTPS, or neither to run plaintext HTTP (README § HTTPS).'
      )
    );
  });

  it('step 3: non-loopback, no TLS, no opt-out', () => {
    expect(() => loadConfig({ INGEST_TOKEN: 'x'.repeat(24) } as NodeJS.ProcessEnv)).toThrow(
      new ConfigError(
        'Refusing to start: no TLS configured and BIND_HOST is 0.0.0.0, which is not loopback. Set TLS_CERT_FILE and TLS_KEY_FILE (README § HTTPS), or set ALLOW_PLAINTEXT_HTTP=1 to accept an unencrypted LAN deployment.'
      )
    );
  });

  it('step 3: non-loopback with a non-default BIND_HOST, no TLS, no opt-out', () => {
    expect(() =>
      loadConfig({ INGEST_TOKEN: 'x'.repeat(24), BIND_HOST: '10.0.0.5' } as NodeJS.ProcessEnv)
    ).toThrow(
      new ConfigError(
        'Refusing to start: no TLS configured and BIND_HOST is 10.0.0.5, which is not loopback. Set TLS_CERT_FILE and TLS_KEY_FILE (README § HTTPS), or set ALLOW_PLAINTEXT_HTTP=1 to accept an unencrypted LAN deployment.'
      )
    );
  });

  it('step 4: missing INGEST_TOKEN, no opt-out — the §12.2 three-line message, verbatim, newlines included', () => {
    let caught: unknown;
    try {
      loadConfig({ BIND_HOST: '127.0.0.1' } as NodeJS.ProcessEnv);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).message).toBe(
      '[Config] Refusing to start: INGEST_TOKEN is not set.\n' +
        '[Config] The agent ingest endpoints (/api/ingest/frame, /event, /traffic) would accept flight data from anyone who can reach this server.\n' +
        '[Config] Set INGEST_TOKEN to a shared secret and set the same value on the agent (agent/README.md), or set ALLOW_UNAUTHENTICATED_INGEST=1 to run ingest unauthenticated (insecure - LAN only).'
    );
  });

  it('step 7: SESSION_SECRET set but shorter than 16 characters', () => {
    expect(() => loadConfig(baseEnv({ SESSION_SECRET: 'short' }))).toThrow(
      new ConfigError(
        'SESSION_SECRET is set but shorter than 16 characters. Unset it to have the server generate and store a strong one, or set a longer value.'
      )
    );
  });

  it('ordering: a one-sided TLS pair AND a missing INGEST_TOKEN throws the step-1 TLS message, not the step-4 ingest message', () => {
    expect(() => loadConfig({ TLS_CERT_FILE: '/some/cert.pem' } as NodeJS.ProcessEnv)).toThrow(
      new ConfigError(
        'TLS_CERT_FILE and TLS_KEY_FILE must be set together. Set both to enable HTTPS, or neither to run plaintext HTTP (README § HTTPS).'
      )
    );
  });
});

describe('§7.3 step 2 — TLS material, against real files in a scratch dir', () => {
  let scratchDir: string;

  beforeAll(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msfslogger-config-test-'));
  });

  afterAll(() => {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  it('(a) cert path does not exist — fatal, exact errno-derived message', () => {
    const missingPath = path.join(scratchDir, 'does-not-exist.pem');
    const keyPath = path.join(scratchDir, 'unused-key.pem');
    fs.writeFileSync(keyPath, 'irrelevant, cert is checked first');

    let expectedErrnoMessage: string;
    try {
      fs.readFileSync(missingPath);
      throw new Error('expected readFileSync to throw');
    } catch (err) {
      expectedErrnoMessage = (err as Error).message;
    }

    expect(() => loadConfig(baseEnv({ TLS_CERT_FILE: missingPath, TLS_KEY_FILE: keyPath }))).toThrow(
      new ConfigError(`Cannot read TLS_CERT_FILE at ${missingPath}: ${expectedErrnoMessage}`)
    );
  });

  it('(b) files exist but contain "not a pem" — fatal, PEM parse failure', () => {
    const certPath = path.join(scratchDir, 'bad-cert.pem');
    const keyPath = path.join(scratchDir, 'bad-key.pem');
    fs.writeFileSync(certPath, 'not a pem');
    fs.writeFileSync(keyPath, 'not a pem');

    let expectedTlsMessage: string;
    try {
      tls.createSecureContext({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) });
      throw new Error('expected createSecureContext to throw');
    } catch (err) {
      expectedTlsMessage = (err as Error).message;
    }

    expect(() => loadConfig(baseEnv({ TLS_CERT_FILE: certPath, TLS_KEY_FILE: keyPath }))).toThrow(
      new ConfigError(
        `TLS certificate or key is not valid PEM (${expectedTlsMessage}). Refusing to start — the server never falls back to plaintext HTTP.`
      )
    );
  });

  it('(c) a real self-signed pair (design §11.5 openssl command) loads successfully', () => {
    const certPath = path.join(scratchDir, 'msfslogger-cert.pem');
    const keyPath = path.join(scratchDir, 'msfslogger-key.pem');

    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
      '-keyout', keyPath, '-out', certPath,
      '-subj', '/CN=msfslogger',
      '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
    ]);

    const config = loadConfig(baseEnv({ TLS_CERT_FILE: certPath, TLS_KEY_FILE: keyPath }));

    expect(config.tls.enabled).toBe(true);
    if (config.tls.enabled) {
      expect(config.tls.certFile).toBe(certPath);
      expect(config.tls.keyFile).toBe(keyPath);
      expect(config.tls.passphrase).toBeNull();
    }
  });
});

describe('§7.3 warning branches — non-fatal, exact message via console.warn', () => {
  it('step 3, loopback: warns and does not throw', () => {
    expect(() => loadConfig({ INGEST_TOKEN: 'x'.repeat(24), BIND_HOST: '127.0.0.1' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      'No TLS configured — serving plaintext HTTP on loopback only.'
    );
  });

  it('step 3, explicit opt-out: warns and does not throw', () => {
    expect(() => loadConfig(baseEnv())).not.toThrow();
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      'WARNING: serving plaintext HTTP on 0.0.0.0:3000 because ALLOW_PLAINTEXT_HTTP is set. The session cookie and the ingest token cross the network unencrypted. Configure TLS_CERT_FILE and TLS_KEY_FILE (README § HTTPS).'
    );
  });

  it('step 5: INGEST_TOKEN shorter than 16 characters warns and does not throw', () => {
    expect(() => loadConfig(baseEnv({ INGEST_TOKEN: 'short-token' }))).not.toThrow();
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      'INGEST_TOKEN is shorter than 16 characters — consider a longer random value.'
    );
  });

  it('step 6: both INGEST_TOKEN and ALLOW_UNAUTHENTICATED_INGEST set — token wins, warns, does not throw', () => {
    expect(() =>
      loadConfig(baseEnv({ ALLOW_UNAUTHENTICATED_INGEST: '1' }))
    ).not.toThrow();
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      'ALLOW_UNAUTHENTICATED_INGEST is set but INGEST_TOKEN is also set — the token is enforced and the opt-out ignored.'
    );
  });

  it('§12.2 opt-out with no token: starts unauthenticated and warns on every start', () => {
    const config = loadConfig({
      ALLOW_UNAUTHENTICATED_INGEST: '1',
      BIND_HOST: '127.0.0.1',
    } as NodeJS.ProcessEnv);
    expect(config.ingest.token).toBeNull();
    expect(config.ingest.allowUnauthenticated).toBe(true);
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      '[Config] WARNING: ALLOW_UNAUTHENTICATED_INGEST is set - /api/ingest/* accepts data from anyone who can reach this server.'
    );
  });
});

describe('defaults (§7.1, §8.5, §10.4)', () => {
  it('loadConfig({ INGEST_TOKEN, ALLOW_PLAINTEXT_HTTP }) resolves every default', () => {
    const token = 'x'.repeat(24);
    const config = loadConfig({ INGEST_TOKEN: token, ALLOW_PLAINTEXT_HTTP: '1' } as NodeJS.ProcessEnv);

    expect(config.port).toBe(3000);
    expect(config.bindHost).toBe('0.0.0.0');
    expect(config.tls.enabled).toBe(false);
    expect(config.jsonBodyLimit).toBe('100kb');
    expect(config.sessionMaxAgeMs).toBe(2592000000);
    expect(config.sessionSecretFromEnv).toBeNull();
    expect(config.ingest.token).toBe(token);
    // NOTE: the task record's acceptance criteria state
    // `ingest.allowUnauthenticated true` for this exact input, but the frozen
    // contract (contracts/config.ts) documents the field as "token is null
    // when this is true" — an invariant that a non-null token here would
    // violate. That case is INGEST_TOKEN-only (ALLOW_UNAUTHENTICATED_INGEST is
    // not part of this env at all, so parseBooleanEnv(undefined) is false
    // regardless). Implemented and asserted per the contract's documented
    // invariant; flagged for the Reviewer/Orchestrator in the dispatch report.
    expect(config.ingest.allowUnauthenticated).toBe(false);
  });
});

describe('no secret leaks', () => {
  it('the SESSION_SECRET fatal message does not contain the secret value', () => {
    // Deliberately not the literal word "short" — that substring also
    // appears in the fixed message text ("...is set but shorter than...")
    // and would make this assertion pass for the wrong reason.
    const secret = 'zqx7f2';
    let message = '';
    try {
      loadConfig(baseEnv({ SESSION_SECRET: secret }));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain(secret);
  });

  it('the INGEST_TOKEN strength warning does not contain the token value', () => {
    const weakToken = 'weak-tok-9f3a';
    expect(weakToken.length).toBeLessThan(16);
    loadConfig(baseEnv({ INGEST_TOKEN: weakToken }));
    const allWarnings = vi.mocked(console.warn).mock.calls.map((call) => call.join(' ')).join('\n');
    expect(allWarnings).not.toContain(weakToken);
  });
});

describe('getConfig() singleton', () => {
  it('throws before loadConfig() has run, and returns the same object after', async () => {
    vi.resetModules();
    const fresh = await import('../src/config');

    expect(() => fresh.getConfig()).toThrow(fresh.ConfigError);

    const loaded = fresh.loadConfig(baseEnv());
    expect(fresh.getConfig()).toBe(loaded);
    expect(fresh.getConfig()).toBe(fresh.getConfig());
  });
});
