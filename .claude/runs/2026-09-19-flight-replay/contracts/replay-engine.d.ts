// Reference stub — NOT wired into the build. The frozen signatures for the
// replay engine and the clock hook. Implementations land in
// client/src/utils/replay.ts and client/src/hooks/useReplayClock.ts.
//
// Prose, rules and edge cases: design.md §3, §5, §6.

// ── client/src/types.ts (widened; see design.md §3) ───────────────────────

/** One flight_points row, exactly as GET /api/flights/:id sends it. */
export interface FlightPoint {
  id: number;
  flight_id: number;
  /** ISO 8601 UTC instant. The server column is `ts`, never `timestamp`. */
  ts: string;
  lat: number;
  lon: number;
  altitude_ft: number;
  airspeed_kts: number;
  ground_speed_kts: number;
  heading_deg: number;
  vertical_speed_fpm: number;
  /** 0 | 1. SQLite has no boolean. */
  on_ground: number;
}

// ── client/src/utils/replay.ts ────────────────────────────────────────────

/** Mirrors the server's RECORD_INTERVAL_MS (5000) in seconds. */
export declare const RECORD_INTERVAL_SEC: 5;
/** Any interval longer than this is a recording interruption, not jitter. */
export declare const GAP_THRESHOLD_SEC: 30;
/** The virtual span a collapsed gap occupies. */
export declare const COLLAPSED_GAP_SEC: 2;
export declare const SPEED_STEPS: readonly [1, 2, 4, 8, 16, 32, 64];
export declare const DEFAULT_SPEED: 16;

export interface BuildTimelineOptions {
  /** Default GAP_THRESHOLD_SEC. */
  gapThresholdSec?: number;
  /** Default COLLAPSED_GAP_SEC. */
  collapsedGapSec?: number;
}

export interface ReplaySegment {
  /** Index into Timeline.points of the segment's start point. */
  fromIndex: number;
  /** Always fromIndex + 1. */
  toIndex: number;
  /** Virtual seconds at which this segment starts. */
  startVirtualSec: number;
  /** collapsedGapSec when isGap, else realDurationSec. Always > 0. */
  durationSec: number;
  isGap: boolean;
  /** Wall-clock seconds between the two points. Always > 0. */
  realDurationSec: number;
}

export interface Timeline {
  /** Normalised: parseable ts and finite lat/lon, sorted, deduplicated. */
  points: FlightPoint[];
  /** Date.parse(points[i].ts). Same length and indexing as points. */
  timesMs: number[];
  /** unwrapLonChain over the full chain. Same length and indexing as points. */
  latlngs: [number, number][];
  /** points.length - 1 entries, or [] when points.length < 2. */
  segments: ReplaySegment[];
  virtualDurationSec: number;
  /** (timesMs[last] - timesMs[0]) / 1000, or 0. */
  realDurationSec: number;
  gapCount: number;
  /** timesMs[0], or 0 when points is empty. */
  startMs: number;
  /** The options actually used, defaults resolved. */
  options: Required<BuildTimelineOptions>;
}

export declare function buildTimeline(
  points: FlightPoint[],
  opts?: BuildTimelineOptions
): Timeline;

export interface ReplaySample {
  lat: number;
  /** Unwrapped: may fall outside [-180, 180] on a dateline-crossing flight. */
  lon: number;
  altitudeFt: number;
  airspeedKnots: number;
  groundSpeedKnots: number;
  /** Normalised to [0, 360). */
  headingDeg: number;
  verticalSpeedFpm: number;
  onGround: boolean;
  /** Last recorded point at or before this instant. */
  pointIndex: number;
  /** -1 for a single-point timeline. */
  segmentIndex: number;
  inGap: boolean;
  /** The gap's real length in seconds; 0 when !inGap. */
  gapRealSec: number;
  /** Epoch ms of the sampled instant. */
  realTimeMs: number;
  /** The input, clamped to [0, virtualDurationSec]. */
  virtualSec: number;
}

/** null exactly when timeline.points is empty. */
export declare function sample(timeline: Timeline, virtualSec: number): ReplaySample | null;

/** Epoch ms for a virtual offset. Equals sample().realTimeMs. */
export declare function realMsFromVirtual(timeline: Timeline, virtualSec: number): number;

/**
 * Inverse of realMsFromVirtual. null when the timeline is empty or realMs
 * falls outside [startMs, last point]. An instant inside a collapsed gap maps
 * to that gap segment's startVirtualSec.
 */
export declare function virtualFromRealMs(timeline: Timeline, realMs: number): number | null;

/** Phase 2 (design.md §8). Declared now so the panel prop never changes shape. */
export interface ReplayEventMarker {
  id: number;
  /** Epoch ms; mapped through virtualFromRealMs. */
  realMs: number;
  /** Tick tooltip text. */
  label: string;
  /** Drives the tick's CSS modifier class. */
  category: string;
}

// ── client/src/hooks/useReplayClock.ts ────────────────────────────────────

export interface FrameScheduler {
  /** cb receives a monotonically non-decreasing ms timestamp, as rAF does. */
  request(cb: (timeMs: number) => void): number;
  cancel(handle: number): void;
}

export type TickReason = 'frame' | 'seek' | 'play' | 'pause' | 'end';

export interface UseReplayClockOptions {
  virtualDurationSec: number;
  /** One of SPEED_STEPS. Read from a ref each frame; changing it keeps position. */
  speed: number;
  /** Every frame while playing, plus once per play/pause/seek/end. */
  onTick: (virtualSec: number, reason: TickReason) => void;
  /** Defaults to globalThis.requestAnimationFrame / cancelAnimationFrame. */
  scheduler?: FrameScheduler;
}

export interface ReplayClock {
  /** React state. Changes only on a user action or at the end. */
  playing: boolean;
  /** React state. True once virtual time reaches the end; cleared by any seek < end. */
  finished: boolean;
  /** On a finished clock, seeks to 0 first. */
  play(): void;
  pause(): void;
  toggle(): void;
  /** Clamped to [0, virtualDurationSec]. Does not change `playing`. */
  seekTo(virtualSec: number): void;
  seekBy(deltaSec: number): void;
  /** seekTo(0) then play(). */
  restart(): void;
  /** Reads the ref. Never triggers a render. */
  getVirtualSec(): number;
}

export declare function useReplayClock(opts: UseReplayClockOptions): ReplayClock;
