// Pure playback engine for the flight replay. No React, no Leaflet, no clock:
// the same points and the same virtual time always give the same sample.

import type { FlightPoint } from '../types';
import { unwrapLonChain } from './geo';

/** Mirrors the server's 5000 ms recording cadence, in seconds. */
export const RECORD_INTERVAL_SEC = 5;
/** Any interval longer than this is a recording interruption, not jitter. */
export const GAP_THRESHOLD_SEC = 30;
/** The virtual span a collapsed gap occupies. */
export const COLLAPSED_GAP_SEC = 2;
export const SPEED_STEPS = [1, 2, 4, 8, 16, 32, 64] as const;
export const DEFAULT_SPEED = 16;

export interface BuildTimelineOptions {
  gapThresholdSec?: number;
  collapsedGapSec?: number;
}

export interface ReplaySegment {
  fromIndex: number;
  toIndex: number;
  startVirtualSec: number;
  durationSec: number;
  isGap: boolean;
  realDurationSec: number;
}

export interface Timeline {
  points: FlightPoint[];
  timesMs: number[];
  latlngs: [number, number][];
  segments: ReplaySegment[];
  virtualDurationSec: number;
  realDurationSec: number;
  gapCount: number;
  startMs: number;
  options: Required<BuildTimelineOptions>;
}

export interface ReplaySample {
  lat: number;
  /** Unwrapped: may fall outside [-180, 180] on a dateline-crossing flight. */
  lon: number;
  altitudeFt: number;
  airspeedKnots: number;
  groundSpeedKnots: number;
  headingDeg: number;
  verticalSpeedFpm: number;
  onGround: boolean;
  pointIndex: number;
  segmentIndex: number;
  inGap: boolean;
  gapRealSec: number;
  realTimeMs: number;
  virtualSec: number;
}

/** A marker for an event on the timeline (tooltip text plus a CSS category). */
export interface ReplayEventMarker {
  id: number;
  realMs: number;
  label: string;
  category: string;
}

export function buildTimeline(points: FlightPoint[], opts: BuildTimelineOptions = {}): Timeline {
  const options: Required<BuildTimelineOptions> = {
    gapThresholdSec: opts.gapThresholdSec ?? GAP_THRESHOLD_SEC,
    collapsedGapSec: opts.collapsedGapSec ?? COLLAPSED_GAP_SEC,
  };

  const candidates: { p: FlightPoint; t: number; i: number }[] = [];
  points.forEach((p, i) => {
    const t = Date.parse(p.ts);
    if (!Number.isFinite(t) || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return;
    candidates.push({ p, t, i });
  });
  candidates.sort((a, b) => a.t - b.t || a.i - b.i);

  const kept: { p: FlightPoint; t: number }[] = [];
  for (const c of candidates) {
    if (kept.length > 0 && kept[kept.length - 1].t === c.t) continue;
    kept.push(c);
  }

  const norm = kept.map(k => k.p);
  const timesMs = kept.map(k => k.t);
  const latlngs = unwrapLonChain(norm.map(p => [p.lat, p.lon] as [number, number]));

  const segments: ReplaySegment[] = [];
  let acc = 0;
  let gapCount = 0;
  for (let i = 0; i < norm.length - 1; i++) {
    const realDurationSec = (timesMs[i + 1] - timesMs[i]) / 1000;
    const isGap = realDurationSec > options.gapThresholdSec;
    const durationSec = isGap ? options.collapsedGapSec : realDurationSec;
    if (isGap) gapCount++;
    segments.push({ fromIndex: i, toIndex: i + 1, startVirtualSec: acc, durationSec, isGap, realDurationSec });
    acc += durationSec;
  }

  return {
    points: norm,
    timesMs,
    latlngs,
    segments,
    virtualDurationSec: acc,
    realDurationSec: norm.length >= 2 ? (timesMs[norm.length - 1] - timesMs[0]) / 1000 : 0,
    gapCount,
    startMs: timesMs.length > 0 ? timesMs[0] : 0,
    options,
  };
}

const fin = (x: number): number => (Number.isFinite(x) ? x : 0);
const lerp = (x: number, y: number, t: number): number => {
  const a = fin(x);
  return a + (fin(y) - a) * t;
};

function clampVirtual(timeline: Timeline, v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(Math.max(v, 0), timeline.virtualDurationSec);
}

function findSegment(timeline: Timeline, v: number): number {
  const segs = timeline.segments;
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].startVirtualSec <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function sample(timeline: Timeline, virtualSec: number): ReplaySample | null {
  const { points, timesMs, latlngs, segments } = timeline;
  if (points.length === 0) return null;
  const v = clampVirtual(timeline, virtualSec);

  if (segments.length === 0) {
    const p = points[0];
    return {
      lat: p.lat,
      lon: latlngs[0][1],
      altitudeFt: fin(p.altitude_ft),
      airspeedKnots: fin(p.airspeed_kts),
      groundSpeedKnots: fin(p.ground_speed_kts),
      headingDeg: ((fin(p.heading_deg) % 360) + 360) % 360,
      verticalSpeedFpm: fin(p.vertical_speed_fpm),
      onGround: p.on_ground === 1,
      pointIndex: 0,
      segmentIndex: -1,
      inGap: false,
      gapRealSec: 0,
      realTimeMs: timesMs[0],
      virtualSec: v,
    };
  }

  const segmentIndex = findSegment(timeline, v);
  const seg = segments[segmentIndex];
  const f = Math.min(Math.max((v - seg.startVirtualSec) / seg.durationSec, 0), 1);
  const hf = seg.isGap ? (f >= 1 ? 1 : 0) : f;
  const a = points[seg.fromIndex];
  const b = points[seg.toIndex];

  const ha = fin(a.heading_deg);
  const d = ((fin(b.heading_deg) - ha + 540) % 360) - 180;
  const h = ha + d * hf;
  const inGap = seg.isGap && hf < 1;

  return {
    lat: lerp(a.lat, b.lat, hf),
    lon: lerp(latlngs[seg.fromIndex][1], latlngs[seg.toIndex][1], hf),
    altitudeFt: lerp(a.altitude_ft, b.altitude_ft, hf),
    airspeedKnots: lerp(a.airspeed_kts, b.airspeed_kts, hf),
    groundSpeedKnots: lerp(a.ground_speed_kts, b.ground_speed_kts, hf),
    headingDeg: ((h % 360) + 360) % 360,
    verticalSpeedFpm: lerp(a.vertical_speed_fpm, b.vertical_speed_fpm, hf),
    onGround: (hf >= 1 ? b : a).on_ground === 1,
    pointIndex: hf >= 1 ? seg.toIndex : seg.fromIndex,
    segmentIndex,
    inGap,
    gapRealSec: inGap ? seg.realDurationSec : 0,
    realTimeMs: lerp(timesMs[seg.fromIndex], timesMs[seg.toIndex], hf),
    virtualSec: v,
  };
}

export function realMsFromVirtual(timeline: Timeline, virtualSec: number): number {
  const s = sample(timeline, virtualSec);
  return s ? s.realTimeMs : timeline.startMs;
}

export function virtualFromRealMs(timeline: Timeline, realMs: number): number | null {
  const { timesMs, segments } = timeline;
  if (timesMs.length === 0 || !Number.isFinite(realMs)) return null;
  if (realMs < timesMs[0] || realMs > timesMs[timesMs.length - 1]) return null;
  if (segments.length === 0) return 0;

  // Last segment whose from-point is at or before realMs.
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (timesMs[segments[mid].fromIndex] <= realMs) lo = mid;
    else hi = mid - 1;
  }
  const seg = segments[lo];
  const offset = seg.isGap ? 0 : (realMs - timesMs[seg.fromIndex]) / 1000;
  return seg.startVirtualSec + offset;
}
