/**
 * Run 2026-09-10-security-hardening — frozen configuration contract
 * (design.md §7, §11, §12).
 *
 * REFERENCE ARTIFACT. Not compiled by the build (it lives outside src/). The
 * Dispatcher for the config task creates `src/config.ts` with these exports,
 * verbatim signatures.
 *
 * src/config.ts is the ONLY module in the server that reads process.env for
 * security-relevant settings. src/ingest.ts, src/pdfExport.ts and src/index.ts
 * receive values from it instead of reading env themselves (§7.4). PORT,
 * EXPORT_BASE_URL, TRAFFIC_ENABLED and SIMCONNECT_* keep their existing
 * readers unless a task explicitly says otherwise (§19).
 */

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

/**
 * Truthy iff the trimmed, lower-cased value is exactly one of
 * '1' | 'true' | 'yes' | 'on'. Unset, empty and everything else are false.
 * Deliberately NOT the inverted-list style of parseTrafficEnabled() in
 * src/ingest.ts: these flags default to OFF, so an unrecognised value must
 * fail closed (§7.2).
 */
export declare function parseBooleanEnv(value: string | undefined): boolean;

/**
 * Reads and validates process.env. Throws ConfigError on the first problem, in
 * the order given in §7.3. Never logs a secret value. Pure with respect to the
 * filesystem except for the TLS readability/parse check (§11.2).
 */
export declare function loadConfig(env?: NodeJS.ProcessEnv): AppConfig;

/**
 * loadConfig() caches its result in a module-level singleton. getConfig()
 * returns it and throws if loadConfig() has not run — src/pdfExport.ts uses
 * this to learn the export scheme without threading config through
 * createServer() (§13.2).
 */
export declare function getConfig(): AppConfig;

/**
 * A fatal misconfiguration. src/index.ts catches it, prints
 * `[Config] ${err.message}` to stderr and exits with code 1 — before initDb(),
 * before any listener is opened (§7.3).
 */
export declare class ConfigError extends Error {}
