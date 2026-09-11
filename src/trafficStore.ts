import type { TrafficObject } from './types';

/**
 * In-memory AI-traffic store and the pure functions the traffic ingest path
 * shares.
 *
 * No express, no db, no timer of its own — everything here is callable from a
 * plain script (see src/inspect-traffic.ts).
 */

// ── Rounding — part of the wire contract ─────────────────────────────────────
// Stored once at ingest, before the store ever sees a record. The formulas
// must be implemented exactly as written so an inspector can predict the
// output; do not "simplify" them.

export const roundCoord = (x: number): number => Math.round(x * 1e6) / 1e6; // 6 dp, ~0.11 m
export const roundAlt = (x: number): number => Math.round(x); // whole feet

// Rounds to one decimal FIRST, wraps in the integer domain SECOND — both
// orderings matter: rounding first closes the output range to
// [0, 360) with no "360.0" exception, and wrapping over integer tenths avoids
// the float residue that `-12.2 + 360` would produce.
export const normHeading = (h: number): number => (((Math.round(h * 10) % 3600) + 3600) % 3600) / 10;

// ── Great-circle distance ────────────────────────────────────────────────────
// Haversine, R = 6371000 m, written out so two implementations agree bit for
// bit. Only the *ordering* of distances is ever used, never the value.

const EARTH_RADIUS_M = 6371000;
const rad = (d: number): number => (d * Math.PI) / 180;

export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── Frozen constants ──────────────────────────────────────────────────────────

/** Hard cap on objects the server keeps and exposes. */
export const MAX_RETAINED_OBJECTS = 100;

/** Age past which the whole retained set is discarded. Deliberately equal to
 *  src/ingest.ts's existing STALE_TIMEOUT_MS. */
export const TRAFFIC_STALE_MS = 10_000;

/**
 * The retention cap. Applied by the ingest route after de-duplication and
 * before TrafficStore.replace(). A pure function so src/inspect-traffic.ts
 * can drive it directly, independent of HTTP.
 *
 * If `objects` already fits within the cap, it is returned as-is and
 * `lastFrame` is never read — no distance is computed for a batch that
 * doesn't need pruning.
 */
export function applyRetentionCap(
  objects: TrafficObject[],
  lastFrame: { lat: number; lon: number } | null,
): TrafficObject[] {
  if (objects.length <= MAX_RETAINED_OBJECTS) return objects;
  if (!lastFrame) return objects.slice(0, MAX_RETAINED_OBJECTS);

  // Sort a copy by ascending distance from lastFrame, ties broken by
  // ascending id (Array.prototype.sort is stable in ES2019+, but the
  // explicit tiebreak means the result doesn't depend on that).
  return objects
    .map((o) => ({ o, d: distanceM(lastFrame.lat, lastFrame.lon, o.lat, o.lon) }))
    .sort((a, b) => a.d - b.d || a.o.id - b.o.id)
    .slice(0, MAX_RETAINED_OBJECTS)
    .map((x) => x.o);
}

/**
 * One instance, created inside createServer() in src/server.ts, passed to
 * createIngestRouter(flightManager, trafficStore) and closed over by the
 * /api/status handler. Not a module-level singleton, so a scratch server (or
 * this inspector) starts empty.
 *
 * The central rule: every accepted batch replaces the entire retained set.
 * The store keeps no history and no per-object timestamps — there is no code
 * path in which it holds an object that was not in the most recently
 * accepted batch.
 */
export class TrafficStore {
  private objects: TrafficObject[] = [];
  private receivedAt = 0;

  /** Replaces the entire retained set and stamps receivedAt = Date.now(). */
  replace(objects: TrafficObject[]): void {
    this.objects = objects;
    this.receivedAt = Date.now();
  }

  /**
   * The retained SET is stale, as a unit, when
   * `now - receivedAt > TRAFFIC_STALE_MS` — strictly greater, so exactly
   * TRAFFIC_STALE_MS is still fresh. Evaluated lazily, here, on every read;
   * no setInterval anywhere prunes the store. A stale read empties the
   * internal array, releasing the memory, and returns [].
   *
   * `now` defaults to Date.now() but is injectable so a caller (this class's
   * own inspector) can check an exact millisecond boundary without waiting
   * real wall-clock time.
   */
  read(now: number = Date.now()): TrafficObject[] {
    if (this.objects.length > 0 && now - this.receivedAt > TRAFFIC_STALE_MS) {
      this.objects = [];
    }
    return this.objects;
  }
}
