// src/config.ts — design.md §7 (run 2026-09-10-security-hardening).
//
// The only module in the server that reads process.env for security-relevant
// settings (§7.4). src/ingest.ts, src/pdfExport.ts and src/index.ts receive
// values from AppConfig instead of reading env themselves. PORT,
// EXPORT_BASE_URL, TRAFFIC_ENABLED and SIMCONNECT_* keep their existing
// readers — untouched (§19).

import * as fs from 'fs';
import * as tls from 'tls';

/** Resolved, validated configuration. Built once at startup, then immutable. */
export interface AppConfig {
  /** PORT, default 3000. Unchanged from today. */
  port: number;
  /** BIND_HOST, default '0.0.0.0'. Unchanged effective behaviour (§11.4). */
  bindHost: string;
  tls: TlsConfig;
  /** SESSION_SECRET if set; null means "load-or-create app_secret row" (§10.3). */
  sessionSecretFromEnv: string | null;
  /** Sliding session lifetime in ms. Frozen constant, not configurable (§10.4). */
  sessionMaxAgeMs: number;
  ingest: IngestConfig;
  /** express.json({ limit }) — frozen constant '100kb' (§8.5). */
  jsonBodyLimit: string;
}

export type TlsConfig =
  | {
      enabled: true;
      /** TLS_CERT_FILE — absolute or cwd-relative path, already read once at startup. */
      certFile: string;
      /** TLS_KEY_FILE */
      keyFile: string;
      /** TLS_KEY_PASSPHRASE, or null. */
      passphrase: string | null;
    }
  | {
      enabled: false;
      /** true iff ALLOW_PLAINTEXT_HTTP was set truthy (§11.3). */
      plaintextOptOut: boolean;
    };

export interface IngestConfig {
  /** INGEST_TOKEN. null iff unauthenticated ingest was explicitly opted into. */
  token: string | null;
  /** ALLOW_UNAUTHENTICATED_INGEST truthy (§12.2). token is null when this is true. */
  allowUnauthenticated: boolean;
}

/** Every environment variable this design introduces or changes. §7.1 is the table. */
export const ENV_VARS = [
  'TLS_CERT_FILE',              // new — §11.1
  'TLS_KEY_FILE',               // new — §11.1
  'TLS_KEY_PASSPHRASE',         // new, optional — §11.1
  'ALLOW_PLAINTEXT_HTTP',       // new — §11.3
  'BIND_HOST',                  // new, default 0.0.0.0 — §11.4
  'SESSION_SECRET',             // new, optional — §10.3
  'ALLOW_UNAUTHENTICATED_INGEST', // new — §12.2
  'INGEST_TOKEN',               // existing, now required by default — §12.1
] as const;

// Frozen constants (§10.4, §8.5) — not configurable, no env var.
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const JSON_BODY_LIMIT = '100kb';
const INGEST_TOKEN_MIN_LEN = 16;
const SESSION_SECRET_MIN_LEN = 16;
const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost'];

/**
 * Truthy iff the trimmed, lower-cased value is exactly one of
 * '1' | 'true' | 'yes' | 'on'. Unset, empty and everything else are false.
 * Deliberately NOT the inverted-list style of parseTrafficEnabled() in
 * src/ingest.ts: these flags default to OFF, so an unrecognised value must
 * fail closed (§7.2).
 */
export function parseBooleanEnv(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

/** A fatal misconfiguration. src/index.ts catches it, prints
 *  `[Config] ${err.message}` to stderr and exits with code 1 — before
 *  initDb(), before any listener is opened (§7.3). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

let cached: AppConfig | null = null;

/**
 * Reads and validates process.env. Throws ConfigError on the first problem, in
 * the order given in §7.3. Never logs a secret value. Pure with respect to the
 * filesystem except for the TLS readability/parse check (§11.2).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const bindHost = env.BIND_HOST || '0.0.0.0';
  const port = env.PORT ? Number(env.PORT) : 3000;

  const certFileSet = !!env.TLS_CERT_FILE;
  const keyFileSet = !!env.TLS_KEY_FILE;

  // Step 1 — TLS pair.
  if (certFileSet !== keyFileSet) {
    throw new ConfigError(
      'TLS_CERT_FILE and TLS_KEY_FILE must be set together. Set both to enable HTTPS, or neither to run plaintext HTTP (README § HTTPS).'
    );
  }

  let tlsConfig: TlsConfig;

  if (certFileSet && keyFileSet) {
    // Step 2 — TLS material.
    const certFile = env.TLS_CERT_FILE as string;
    const keyFile = env.TLS_KEY_FILE as string;
    const passphrase = env.TLS_KEY_PASSPHRASE || null;

    let cert: Buffer;
    try {
      cert = fs.readFileSync(certFile);
    } catch (err) {
      throw new ConfigError(`Cannot read TLS_CERT_FILE at ${certFile}: ${errnoMessage(err)}`);
    }

    let key: Buffer;
    try {
      key = fs.readFileSync(keyFile);
    } catch (err) {
      throw new ConfigError(`Cannot read TLS_KEY_FILE at ${keyFile}: ${errnoMessage(err)}`);
    }

    try {
      tls.createSecureContext({ cert, key, passphrase: passphrase ?? undefined });
    } catch (err) {
      throw new ConfigError(
        `TLS certificate or key is not valid PEM (${errorMessage(err)}). Refusing to start — the server never falls back to plaintext HTTP.`
      );
    }

    tlsConfig = { enabled: true, certFile, keyFile, passphrase };
  } else {
    // Step 3 — plaintext.
    const isLoopback = LOOPBACK_HOSTS.includes(bindHost);
    const plaintextOptOut = parseBooleanEnv(env.ALLOW_PLAINTEXT_HTTP);

    if (isLoopback) {
      console.warn('No TLS configured — serving plaintext HTTP on loopback only.');
    } else if (plaintextOptOut) {
      console.warn(
        `WARNING: serving plaintext HTTP on ${bindHost}:${port} because ALLOW_PLAINTEXT_HTTP is set. The session cookie and the ingest token cross the network unencrypted. Configure TLS_CERT_FILE and TLS_KEY_FILE (README § HTTPS).`
      );
    } else {
      throw new ConfigError(
        `Refusing to start: no TLS configured and BIND_HOST is ${bindHost}, which is not loopback. Set TLS_CERT_FILE and TLS_KEY_FILE (README § HTTPS), or set ALLOW_PLAINTEXT_HTTP=1 to accept an unencrypted LAN deployment.`
      );
    }

    tlsConfig = { enabled: false, plaintextOptOut };
  }

  // Step 4 — ingest token required.
  const rawToken = env.INGEST_TOKEN || '';
  const allowUnauthenticated = parseBooleanEnv(env.ALLOW_UNAUTHENTICATED_INGEST);

  if (!rawToken && !allowUnauthenticated) {
    throw new ConfigError(
      '[Config] Refusing to start: INGEST_TOKEN is not set.\n' +
        '[Config] The agent ingest endpoints (/api/ingest/frame, /event, /traffic) would accept flight data from anyone who can reach this server.\n' +
        '[Config] Set INGEST_TOKEN to a shared secret and set the same value on the agent (agent/README.md), or set ALLOW_UNAUTHENTICATED_INGEST=1 to run ingest unauthenticated (insecure - LAN only).'
    );
  }

  // Step 5 — ingest token strength (warning, not fatal).
  if (rawToken && rawToken.length < INGEST_TOKEN_MIN_LEN) {
    console.warn('INGEST_TOKEN is shorter than 16 characters — consider a longer random value.');
  }

  // Step 6 — both ingest settings set (warning, token wins).
  if (rawToken && allowUnauthenticated) {
    console.warn(
      'ALLOW_UNAUTHENTICATED_INGEST is set but INGEST_TOKEN is also set — the token is enforced and the opt-out ignored.'
    );
  }

  const ingest: IngestConfig = rawToken
    ? { token: rawToken, allowUnauthenticated: false }
    : { token: null, allowUnauthenticated: true };

  // §12.2 — opt-out set, no token: the server starts unauthenticated and
  // warns on every start. Not one of the ordered fatal steps 1-7, but
  // documented in §12.2 with the [Config] prefix baked into the message
  // itself (unlike the plain §7.3 warnings above, which src/index.ts does
  // not wrap).
  if (!rawToken && allowUnauthenticated) {
    console.warn(
      '[Config] WARNING: ALLOW_UNAUTHENTICATED_INGEST is set - /api/ingest/* accepts data from anyone who can reach this server.'
    );
  }

  // Step 7 — session secret.
  const rawSessionSecret = env.SESSION_SECRET || '';
  if (rawSessionSecret && rawSessionSecret.length < SESSION_SECRET_MIN_LEN) {
    throw new ConfigError(
      'SESSION_SECRET is set but shorter than 16 characters. Unset it to have the server generate and store a strong one, or set a longer value.'
    );
  }

  const config: AppConfig = {
    port,
    bindHost,
    tls: tlsConfig,
    sessionSecretFromEnv: rawSessionSecret || null,
    sessionMaxAgeMs: SESSION_MAX_AGE_MS,
    ingest,
    jsonBodyLimit: JSON_BODY_LIMIT,
  };

  cached = config;
  return config;
}

/**
 * loadConfig() caches its result in a module-level singleton. getConfig()
 * returns it and throws if loadConfig() has not run — src/pdfExport.ts uses
 * this to learn the export scheme without threading config through
 * createServer() (§13.2).
 */
export function getConfig(): AppConfig {
  if (!cached) {
    throw new ConfigError('getConfig() called before loadConfig() — configuration has not been loaded.');
  }
  return cached;
}

function errnoMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
