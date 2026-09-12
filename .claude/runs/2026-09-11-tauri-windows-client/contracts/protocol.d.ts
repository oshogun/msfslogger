// Reference stub for design §3 — NOT wired into any build.
// The implementable copy lives in windows-client/sidecar/src/protocol.ts
// (owned by T-002). The Rust side mirrors these as serde enums in
// windows-client/src-tauri/src/protocol.rs (T-005), and the webview sees the
// SidecarMessage shapes verbatim as Tauri event payloads (T-006).

import type { RedactedConfig } from './config';

/** Bumped only on a breaking change. Both sides reject a mismatch loudly. */
export declare const PROTOCOL_VERSION: 1;

/** A line longer than this is dropped with a decode error. §3.2 */
export declare const MAX_LINE_BYTES: 65536;

// ── sidecar -> Tauri (one JSON object per line on stdout) ────────────────────

/** First line the sidecar ever writes. §3.3 */
export interface HelloMessage {
  v: 1;
  type: 'hello';
  at: number;
  pid: number;
  sidecarVersion: string;
  nodeVersion: string;
  configPath: string;
}

/** The whole observable state of the sidecar. Emitted on any change, plus a
 *  heartbeat every 5000 ms. Always complete — never a partial patch. §3.3 */
export interface StatusMessage {
  v: 1;
  type: 'status';
  at: number;
  /** Control axis. §4.2 */
  app: {
    state: AppStateId;
    /** Present only for app.error-config / app.no-config. */
    problems?: { field: string; message: string }[];
  };
  /** SimConnect axis. §4.3 */
  sim: {
    state: SimStateId;
    /** Consecutive failed connect attempts since the last recvOpen. */
    attempt: number;
    /** Epoch ms of the next connect attempt; null unless state is sim.retry. */
    nextRetryAt: number | null;
    /** The delay that produced nextRetryAt, in ms. null unless sim.retry. */
    retryDelayMs: number | null;
    /** node-simconnect Protocol member name in use, e.g. "KittyHawk". */
    protocol: string;
    /** recvOpen.applicationName, once connected. */
    appName: string | null;
    /** recvOpen version as "major.minor", once connected. */
    appVersion: string | null;
    /** Last SimConnect error text, e.g. "connect ECONNREFUSED 127.0.0.1:2048". */
    lastError: string | null;
  };
  /** Backend axis. §4.4 */
  backend: {
    state: BackendStateId;
    /** HTTP status of the last ingest response; null if none or transport error. */
    httpStatus: number | null;
    lastOkAt: number | null;
    lastErrorAt: number | null;
    /** One line, already redacted. */
    message: string | null;
  };
  /** Pause axis. §4.5 */
  pause: {
    state: PauseStateId;
    /** Raw Pause_EX1 bitmask, or 0/1 synthesised from the legacy events. */
    flags: number;
    /** agent/agent.js describePause() output, e.g. "full+active". */
    label: string;
    /** true once a Pause_EX1 event has been seen; legacy events ignored after. */
    usingPauseEx1: boolean;
  };
  /** Traffic sweep counters. Never drives the backend axis. §4.4 */
  traffic: {
    enabled: boolean;
    radiusM: number;
    lastSweepAt: number | null;
    lastBatchSize: number | null;
    lastError: string | null;
  };
  /** Redacted config, so the UI can render current settings with no extra call. */
  config: RedactedConfig | null;
}

/** Human-readable log, mirrored from what the CLI agent printed. §3.3 */
export interface LogMessage {
  v: 1;
  type: 'log';
  at: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

/** Reply to ControlPing. */
export interface PongMessage {
  v: 1;
  type: 'pong';
  at: number;
  id: string;
}

/**
 * RESERVED for the additive live-data CDU page. Named and shaped now so the
 * message set does not have to change later; the sidecar in this run never
 * emits either, and every consumer ignores unknown types anyway (§3.2).
 */
export interface FrameMessage {
  v: 1;
  type: 'frame';
  at: number;
  frame: {
    lat: number; lon: number; altitudeFt: number; airspeedKnots: number;
    groundSpeedKnots: number; headingDeg: number; verticalSpeedFpm: number;
    onGround: boolean; simRunning: number; aircraft: string;
  };
}
export interface TrafficMessage {
  v: 1;
  type: 'traffic';
  at: number;
  count: number;
  objects: { id: number; lat: number; lon: number; altitudeFt: number; headingDeg: number; onGround: boolean }[];
}

export type SidecarMessage =
  | HelloMessage | StatusMessage | LogMessage | PongMessage
  | FrameMessage | TrafficMessage;

// ── Tauri -> sidecar (one JSON object per line on stdin) ─────────────────────

/** Begin the uplink: connect SimConnect, start posting. Idempotent. */
export interface ControlStart { v: 1; type: 'start' }
/** End the uplink, stay alive and keep reporting status. Idempotent. */
export interface ControlStop { v: 1; type: 'stop' }
/** Re-read the config file and apply it in place. §3.5 */
export interface ControlConfig { v: 1; type: 'config'; path?: string }
/** Clean exit, code 0, within CONTROL_SHUTDOWN_GRACE_MS. §3.6 */
export interface ControlShutdown { v: 1; type: 'shutdown' }
/** Liveness check; answered with PongMessage carrying the same id. */
export interface ControlPing { v: 1; type: 'ping'; id: string }

export type ControlMessage =
  | ControlStart | ControlStop | ControlConfig | ControlShutdown | ControlPing;

// ── codec ────────────────────────────────────────────────────────────────────

export type DecodeError =
  | { ok: false; error: 'oversize'; bytes: number }
  | { ok: false; error: 'not-json'; detail: string }
  | { ok: false; error: 'not-object' }
  | { ok: false; error: 'bad-version'; v: unknown }
  | { ok: false; error: 'unknown-type'; messageType: string }
  | { ok: false; error: 'bad-shape'; messageType: string; detail: string };

export type DecodeResult<T> = { ok: true; message: T } | DecodeError;

/** Never throws. `unknown-type` is a soft error: callers log and continue. §3.2 */
export declare function decodeSidecarMessage(line: string): DecodeResult<SidecarMessage>;
export declare function decodeControlMessage(line: string): DecodeResult<ControlMessage>;

/** Returns exactly one line, newline-terminated, with no embedded newline. */
export declare function encodeSidecarMessage(message: SidecarMessage): string;
export declare function encodeControlMessage(message: ControlMessage): string;

// ── state ids, re-exported from status.ts so both files agree ────────────────

export type AppStateId =
  | 'app.starting' | 'app.no-config' | 'app.error-config'
  | 'app.stopped' | 'app.running' | 'app.crashed' | 'app.restarting';
export type SimStateId =
  | 'sim.idle' | 'sim.connecting' | 'sim.connected' | 'sim.retry';
export type BackendStateId =
  | 'net.idle' | 'net.pending' | 'net.ok' | 'net.standby'
  | 'net.unauthorized' | 'net.http-error' | 'net.tls-error' | 'net.unreachable';
export type PauseStateId =
  | 'pause.off' | 'pause.full' | 'pause.active' | 'pause.menu' | 'pause.unknown';
