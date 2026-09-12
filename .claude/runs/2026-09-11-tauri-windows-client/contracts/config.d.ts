// Reference stub for design §2 — NOT wired into any build.
// The implementable copy of these types lives in
// windows-client/sidecar/src/config.ts (owned by T-002). The Rust side
// (windows-client/src-tauri/src/config.rs, T-005) mirrors the same field names
// in a serde struct.

/** Accepted `sim` values, case-insensitive after trim. §2.4 */
export type SimId = '2020' | '2024' | 'fsx';

/**
 * The on-disk file, exactly as JSON.parse returns it. Every field is optional
 * on disk: a missing file is "no config", not a crash (§2.5). Unknown keys are
 * ignored by the sidecar and preserved by the Rust writer (§2.6).
 */
export interface RawConfig {
  /** Schema version. Missing is treated as 1. */
  version?: number;
  /** Replaces SERVER_URL. Required. http: or https: only, no trailing slash. */
  serverUrl?: string;
  /** Replaces INGEST_TOKEN. Required. Stored in plaintext (§2.8). */
  ingestToken?: string;
  /** Replaces NODE_EXTRA_CA_CERTS. Optional; PEM file path. null = system trust. */
  certPath?: string | null;
  /** Replaces TRAFFIC_ENABLED. Optional, default true. */
  trafficEnabled?: boolean | string | number;
  /** Replaces TRAFFIC_RADIUS_M. Optional, default 40000. */
  trafficRadiusM?: number | string;
  /** Replaces --sim/-s. Optional, default "2020". Must be a string; a JSON
   *  number is rejected on type before the value is compared. */
  sim?: string;
  /** New. Start the uplink automatically at app launch. Default false. */
  autoUplink?: boolean;
  /** Advanced, not shown in the FMC pages: absolute path to node.exe. */
  nodePath?: string | null;
}

/** The validated, fully-defaulted config the sidecar runs on. §2.4 */
export interface EffectiveConfig {
  version: 1;
  serverUrl: string;
  ingestToken: string;
  certPath: string | null;
  trafficEnabled: boolean;
  trafficRadiusM: number;
  sim: SimId;
  autoUplink: boolean;
  nodePath: string | null;
}

/**
 * The same object with the credential removed. This — never EffectiveConfig —
 * is what may cross IPC, reach the webview, or be printed. §2.9
 */
export type RedactedConfig = Omit<EffectiveConfig, 'ingestToken'> & {
  /** true when ingestToken is a non-empty string. The value never travels. */
  tokenSet: boolean;
};

export interface ConfigProblem {
  /** Config key at fault, or "*" for a whole-file problem (unreadable JSON). */
  field: keyof RawConfig | '*';
  /** One line, no stack trace, safe to show in the FMC scratchpad. §2.5 */
  message: string;
}

export type ConfigLoadResult =
  | { ok: true; config: EffectiveConfig; warnings: ConfigProblem[] }
  | { ok: false; reason: 'missing'; path: string; problems: ConfigProblem[] }
  | { ok: false; reason: 'invalid'; path: string; problems: ConfigProblem[] };

/** Defaults, frozen in §2.4. */
export declare const DEFAULTS: {
  readonly version: 1;
  readonly certPath: null;
  readonly trafficEnabled: true;
  readonly trafficRadiusM: 40000;
  readonly trafficRadiusMinM: 1000;
  readonly trafficRadiusMaxM: 200000;
  readonly sim: '2020';
  readonly autoUplink: false;
  readonly nodePath: null;
};

/** Values (trimmed, lowercased) that turn traffic off. Ported verbatim. §2.4 */
export declare const TRAFFIC_DISABLE_VALUES: readonly ['0', 'false', 'off', 'no'];

/** sim -> node-simconnect Protocol member name. §2.4 */
export declare const SIM_PROTOCOL_NAME: Readonly<Record<SimId, 'KittyHawk' | 'SunRise' | 'FSX_SP2'>>;

/** Resolution order in §2.2; `override` is the optional --config argument. */
export declare function resolveConfigPath(override?: string): string;

/** Pure apart from the single readFileSync; returns, never throws, never exits. */
export declare function loadConfig(path: string): ConfigLoadResult;

/** Pure. Exported separately so tests drive it without touching the disk. */
export declare function validateConfig(raw: unknown): ConfigLoadResult;

/** Pure. The only supported way to produce something printable. §2.9 */
export declare function redact(config: EffectiveConfig): RedactedConfig;
