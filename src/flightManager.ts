import type { SimFrame, FlightState, AppState, PlannedLegWithChildren, PlannedLegLiveStatus } from './types';
import {
  insertFlight, insertPoint, closeFlight, getFlightPlannedLegId,
  getActiveTripId, getPlannedLegCandidatesForActiveTrip, getPlannedLegById,
  linkFlightToPlannedLeg, recordPlannedLegArrival, getTripName,
} from './db';
import { findNearestAirport } from './airports';
import { matchPlannedLeg, DEPARTURE_RADIUS_NM, ARRIVAL_RADIUS_NM } from './legMatcher';
import type { LegMatchResult } from './legMatcher';

const RECORD_INTERVAL_MS = 5000;
// A gap between points larger than this means recording had stopped, so the
// time is treated as an interruption rather than flight time. Generously above
// RECORD_INTERVAL_MS so ordinary jitter is never mistaken for an interruption.
export const MAX_COUNTED_GAP_MS = 60_000;
const AIRBORNE_DEBOUNCE_FRAMES = 3;
const LANDED_DEBOUNCE_FRAMES = 10;

function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065; // nautical miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Approximate cross-track distance (nm) from (lat, lon) to the segment
 * a->b, clamped to the segment itself rather than the infinite line through
 * it. Flat-plane (equirectangular) projection, not great-circle — adequate
 * here because it is used only to rank which leg of the route the aircraft is
 * nearest to, never reported as a distance itself (that's haversineNm, on the
 * chosen waypoint).
 *
 * Why not simply pick whichever waypoint minimises dist(pos, waypoint) +
 * dist(waypoint, destination)? Triangle inequality means that sum is
 * smallest for the LAST waypoint unless the aircraft is off to the side of
 * the direct line — and a real planned route is nearly straight (design.md
 * §6: the KSFO->KLAX skeleton is 293.48 nm against a 293.23 nm direct great
 * circle). That approach would report the destination as "next waypoint"
 * from the moment of takeoff on almost every real leg, which is exactly
 * backwards.
 */
function crossTrackNm(lat: number, lon: number, aLat: number, aLon: number, bLat: number, bLon: number): number {
  const cosLat = Math.cos(((aLat + bLat) / 2 * Math.PI) / 180);
  const bx = (bLon - aLon) * cosLat, by = bLat - aLat;
  const px = (lon - aLon) * cosLat, py = lat - aLat;
  const abLenSq = bx * bx + by * by;
  const t = abLenSq === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / abLenSq));
  const dx = px - t * bx, dy = py - t * by;
  return Math.sqrt(dx * dx + dy * dy) * 60; // ~60 nm per degree
}

/** `result.distanceNm` is unrounded and null before the radius is applied. */
function formatNm(distanceNm: number | null): string {
  return distanceNm === null ? 'unknown distance' : `${distanceNm.toFixed(1)} nm`;
}

/**
 * The parenthetical that follows a refusal's reason code in the log.
 *
 * `nearbyLegIds` does not mean one thing (design.md §13.4): for AMBIGUOUS it is
 * the *eligible* ids — the choices, which is what the line should name — and for
 * every other outcome reached after the radius test it is every id within the
 * radius. Before the radius is usefully applied it is empty, and then the only
 * thing worth reporting is how far the nearest planned departure was, if the
 * matcher got far enough to measure one.
 */
function describeRefusal(result: LegMatchResult): string {
  const legs = result.nearbyLegIds;
  const named = `${legs.length === 1 ? 'leg' : 'legs'} ${legs.join(', ')} within ${DEPARTURE_RADIUS_NM} nm`;
  if (result.reason === 'AMBIGUOUS') {
    return ` (${named})`;
  }
  if (legs.length > 0) {
    return ` (${named}, nearest ${formatNm(result.distanceNm)})`;
  }
  if (result.distanceNm !== null) {
    return ` (nearest planned departure ${formatNm(result.distanceNm)} away)`;
  }
  return '';
}

/**
 * Live-status cache for the flight currently FLYING, built once — at
 * auto-link time, or refreshed on a manual link/unlink — never re-read from
 * the database per status poll (design.md §19). `waypoints` mirrors the
 * leg's own planned_waypoints order (departure first, destination last, per
 * design.md §5.4c / lnmpln.ts); `remainingFromNm[i]` is the great-circle
 * distance from `waypoints[i]` to the destination, following that same chain.
 */
interface PlannedLegCache {
  flightId: number;
  plannedLegId: number;
  tripId: number;
  tripName: string;
  destinationIdent: string;
  waypoints: { ident: string; lat: number; lon: number }[];
  remainingFromNm: number[];
}

function buildPlannedLegCache(flightId: number, leg: PlannedLegWithChildren): PlannedLegCache {
  const waypoints = leg.waypoints.map(w => ({ ident: w.ident, lat: w.lat, lon: w.lon }));
  const remainingFromNm = new Array<number>(waypoints.length).fill(0);
  for (let i = waypoints.length - 2; i >= 0; i--) {
    remainingFromNm[i] =
      remainingFromNm[i + 1] + haversineNm(waypoints[i].lat, waypoints[i].lon, waypoints[i + 1].lat, waypoints[i + 1].lon);
  }
  return {
    flightId,
    plannedLegId: leg.id,
    tripId: leg.trip_id,
    tripName: getTripName(leg.trip_id) ?? '',
    destinationIdent: leg.destination_ident,
    waypoints,
    remainingFromNm,
  };
}

export class FlightManager {
  private state: FlightState = 'IDLE';
  private currentFlightId: number | null = null;
  private plannedLegCache: PlannedLegCache | null = null;
  private airborneStreak = 0;
  private landedStreak = 0;
  private isPaused = false;
  private lastPointTime = 0;
  // Set whenever recording is skipped, so the following gap is known to be an
  // interruption regardless of how short it was.
  private interrupted = false;

  // Accumulated stats for the current flight
  private distanceNm = 0;
  private maxAltitudeFt = 0;
  private maxAirspeedKts = 0;
  private pointCount = 0;
  private lastPointLat = 0;
  private lastPointLon = 0;
  private flightStartMs = 0;
  // Flight time accumulated from the gaps between recorded points, so that any
  // interruption which stops recording is excluded automatically.
  private activeMs = 0;

  readonly appState: AppState = {
    flightState: 'IDLE',
    currentFlightId: null,
    connected: false,
    lastFrame: null,
    paused: false,
    pauseFlags: 0,
  };

  /**
   * `flags` is the MSFS `Pause_EX1` bitmask (see PAUSE_FLAG_* in agent/agent.js).
   * Pausing suppresses point recording, which is what keeps paused time out of
   * the duration; the flags are kept so the UI can name the kind of pause.
   */
  setPaused(paused: boolean, flags = paused ? 1 : 0): void {
    // Mark here as well as in onFrame: a paused sim may stop sending frames
    // altogether, in which case onFrame never runs to flag the interruption.
    if (paused) this.interrupted = true;
    this.isPaused = paused;
    this.appState.paused = paused;
    this.appState.pauseFlags = paused ? flags : 0;
  }

  onFrame(frame: SimFrame): void {
    this.appState.lastFrame = frame;

    if (frame.simRunning === 0) {
      if (this.state === 'FLYING') this.endFlight(frame);
      return;
    }

    const inSlew = frame.simRunning === 3;

    switch (this.state) {
      case 'IDLE':
        if (!inSlew && !frame.onGround && frame.airspeedKnots > 30) {
          this.airborneStreak++;
          if (this.airborneStreak >= AIRBORNE_DEBOUNCE_FRAMES) {
            this.startFlight(frame);
          }
        } else {
          this.airborneStreak = 0;
        }
        break;

      case 'FLYING':
        if (inSlew || this.isPaused) {
          this.interrupted = true;
          break;
        }

        this.recordPoint(frame);

        if (frame.onGround && frame.groundSpeedKnots < 5) {
          this.landedStreak++;
          if (this.landedStreak >= LANDED_DEBOUNCE_FRAMES) {
            this.endFlight(frame);
          }
        } else {
          this.landedStreak = 0;
        }
        break;
    }
  }

  onCrash(): void {
    if (this.state === 'FLYING' && this.appState.lastFrame) {
      this.endFlight(this.appState.lastFrame);
    }
  }

  onSimDisconnect(): void {
    if (this.state === 'FLYING' && this.appState.lastFrame) {
      this.endFlight(this.appState.lastFrame);
    }
  }

  private startFlight(frame: SimFrame): void {
    const startTime = new Date().toISOString();
    const dep = findNearestAirport(frame.lat, frame.lon);
    const id = insertFlight(frame.aircraft, frame.lat, frame.lon, startTime, dep?.icao ?? null, dep?.name ?? null);
    if (dep) console.log(`[FlightManager] Departure airport: ${dep.icao} (${dep.name})`);

    this.plannedLegCache = null;
    this.autoLinkPlannedLeg(id, frame, startTime);

    this.currentFlightId = id;
    this.state = 'FLYING';
    this.airborneStreak = 0;
    this.landedStreak = 0;
    this.distanceNm = 0;
    this.maxAltitudeFt = frame.altitudeFt;
    this.maxAirspeedKts = frame.airspeedKnots;
    this.pointCount = 0;
    this.lastPointLat = frame.lat;
    this.lastPointLon = frame.lon;
    this.lastPointTime = Date.now();
    this.flightStartMs = Date.now();
    this.activeMs = 0;
    this.interrupted = false;

    this.appState.flightState = 'FLYING';
    this.appState.currentFlightId = id;

    console.log(`[FlightManager] Flight #${id} started — ${frame.aircraft}`);

    // Record the first point immediately
    this.writePoint(frame);
  }

  private endFlight(frame: SimFrame): void {
    if (this.currentFlightId === null) return;

    const endTime = new Date().toISOString();
    // Include the final partial interval between the last point and touchdown
    const tailMs = Date.now() - this.lastPointTime;
    if (!this.interrupted && tailMs <= MAX_COUNTED_GAP_MS) this.activeMs += tailMs;

    const durationSec = Math.round(this.activeMs / 1000);
    const excludedSec = Math.max(0,
      Math.round((Date.now() - this.flightStartMs) / 1000) - durationSec);

    const arr = findNearestAirport(frame.lat, frame.lon);
    if (arr) console.log(`[FlightManager] Arrival airport: ${arr.icao} (${arr.name})`);
    closeFlight(
      this.currentFlightId,
      endTime,
      frame.lat,
      frame.lon,
      durationSec,
      Math.round(this.distanceNm * 10) / 10,
      Math.round(this.maxAltitudeFt),
      Math.round(this.maxAirspeedKts),
      this.pointCount,
      arr?.icao ?? null,
      arr?.name ?? null
    );

    console.log(
      `[FlightManager] Flight #${this.currentFlightId} ended — ` +
      `${this.pointCount} points, ${this.distanceNm.toFixed(1)} nm, ${durationSec}s` +
      (excludedSec > 0 ? ` (${excludedSec}s interrupted, excluded)` : '')
    );

    this.recordArrivalOnPlannedLeg(this.currentFlightId, frame);

    this.currentFlightId = null;
    this.plannedLegCache = null;
    this.state = 'IDLE';
    this.appState.flightState = 'IDLE';
    this.appState.currentFlightId = null;
    this.airborneStreak = 0;
    this.landedStreak = 0;
  }

  /**
   * The live-panel context for /api/status (design.md §19), or null while
   * unlinked. Reads only the cache built at link time plus the two
   * coordinates the caller already has — no query, so a 1 Hz poll costs
   * nothing here. `lat`/`lon` come from the last frame, not stored, since the
   * server already holds it and passing it keeps this method pure.
   *
   * "Next waypoint" is the far end of whichever route segment the current
   * position is nearest to by cross-track distance (see crossTrackNm above),
   * which is what actually tracks progress along a nearly-straight route.
   * `remainingDistanceNm` is then the direct distance to that waypoint plus
   * the rest of the chain from there to the destination — never a fraction
   * of raw distance flown, and always via the file's own waypoint chain.
   */
  getPlannedLegStatus(lat: number, lon: number): PlannedLegLiveStatus | null {
    const cache = this.plannedLegCache;
    if (!cache) return null;

    const { waypoints, remainingFromNm } = cache;
    let bestSegment = 0;
    let bestCrossTrackNm = Infinity;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const d = crossTrackNm(lat, lon, waypoints[i].lat, waypoints[i].lon, waypoints[i + 1].lat, waypoints[i + 1].lon);
      if (d < bestCrossTrackNm) { bestCrossTrackNm = d; bestSegment = i; }
    }
    const nextIdx = bestSegment + 1;
    const remainingDistanceNm = haversineNm(lat, lon, waypoints[nextIdx].lat, waypoints[nextIdx].lon) + remainingFromNm[nextIdx];

    return {
      plannedLegId: cache.plannedLegId,
      tripId: cache.tripId,
      tripName: cache.tripName,
      destinationIdent: cache.destinationIdent,
      nextWaypointIdent: waypoints[nextIdx].ident,
      remainingDistanceNm: Math.round(remainingDistanceNm * 10) / 10,
      distanceIsApproximate: true,
    };
  }

  /**
   * Called by the manual link/unlink endpoint (design.md §12.3), which talks
   * to the database directly and never goes through FlightManager. Without
   * this, linking or unlinking the in-progress flight by hand would leave the
   * live-status cache pointed at whatever autoLinkPlannedLeg last set (or at
   * nothing), silently disagreeing with the row the rest of the app now
   * reads. A no-op for any flight that isn't the one currently flying.
   */
  refreshPlannedLegForFlight(flightId: number): void {
    if (flightId !== this.currentFlightId) return;
    const legId = getFlightPlannedLegId(flightId);
    if (legId === null) { this.plannedLegCache = null; return; }
    const leg = getPlannedLegById(legId);
    this.plannedLegCache = leg ? buildPlannedLegCache(flightId, leg) : null;
  }

  /**
   * Auto-match at takeoff, design.md §13.5 — exactly once per flight, never
   * from onFrame/recordPoint/writePoint (§20 item 11). The candidates are
   * loaded here and the matcher works on the legs' own stored coordinates, so
   * findNearestAirport() stays at its two calls per flight and the frame path
   * gains nothing at all (§20 item 10).
   *
   * Everything is caught, deliberately and without rethrowing. insertFlight()
   * has already run by the time this is reached, and nothing the trip planner
   * does may stand between a sim session and the row that records it: a link
   * that failed is one click to fix in the UI, a flight that was never written
   * is gone with the session. So a throw from either query, from the matcher or
   * from the link write degrades to an unlinked flight and a log line.
   */
  private autoLinkPlannedLeg(flightId: number, frame: SimFrame, startTime: string): void {
    try {
      const result = matchPlannedLeg({
        lat: frame.lat,
        lon: frame.lon,
        startTime,
        aircraft: frame.aircraft,
        activeTripId: getActiveTripId(),
        candidates: getPlannedLegCandidatesForActiveTrip(),
        // startFlight() inserted the flight row immediately before this call,
        // so a freshly inserted flight cannot already carry a link — this
        // argument is always null here, and step 0 is structurally
        // unreachable from this call site by construction. It stays a real
        // guard for matchPlannedLeg()'s other potential callers and for its
        // own scenario harness (inspect-legmatch.ts), which is a pure
        // function with no database and exercises step 0 directly. Note:
        // linkFlightToPlannedLeg() (the manual PUT path, §12.3) does not
        // call the matcher at all, so it is not what this guard is for.
        flightAlreadyLinkedTo: null,
      });

      if (result.reason === 'MATCHED' && result.plannedLegId !== null) {
        // The one read §13.5 does not budget for, and only on the matched
        // path: the candidates carry departureIdent but no destination, and
        // the frozen log line names the whole route. Read before the write so
        // that a link which succeeded can never be reported as a failure
        // because the label lookup was the thing that threw.
        const leg = getPlannedLegById(result.plannedLegId);
        linkFlightToPlannedLeg(flightId, result.plannedLegId, 'auto');
        if (leg) this.plannedLegCache = buildPlannedLegCache(flightId, leg);
        const route = leg ? `${leg.departure_ident}→${leg.destination_ident}, ` : '';
        console.log(
          `[FlightManager] Flight #${flightId} linked to planned leg #${result.plannedLegId} ` +
          `(${route}${formatNm(result.distanceNm)}, ${result.reason})`
        );
        return;
      }

      // A non-match is never silent: every refusal names its reason code, so an
      // unlinked flight is always explainable after the fact (§13.5).
      console.log(
        `[FlightManager] Flight #${flightId} not linked — ${result.reason}${describeRefusal(result)}`
      );
    } catch (err) {
      console.warn(`[FlightManager] Flight #${flightId} auto-link failed, flight recorded unlinked:`, err);
    }
  }

  /**
   * Landing outcome for a linked flight, design.md §14. Runs after
   * closeFlight() for the same reason the takeoff match runs after
   * insertFlight(): by the time it can fail, the flight is already safely
   * closed, so a throw costs the leg's arrival state and nothing else.
   *
   * The link is read from the flight row rather than remembered from
   * startFlight(). The user can link or unlink a flight from the UI while it is
   * still in the air (§15), and the row is the only thing that knows about it —
   * remembering the takeoff match would mark a leg the user had since unlinked.
   * getFlightPlannedLegId() exists so that read costs one integer rather than
   * the flight's whole track.
   *
   * Reached from onCrash() and onSimDisconnect() as well as from a normal
   * landing, so `frame` may be anywhere at all — mid-ocean, mid-climb. That is
   * simply a large deviation and a 'diverted' leg, which is the honest record;
   * it is not a special case and must not become one.
   */
  private recordArrivalOnPlannedLeg(flightId: number, frame: SimFrame): void {
    try {
      const legId = getFlightPlannedLegId(flightId);
      if (legId === null) return;

      const leg = getPlannedLegById(legId);
      if (!leg) return;

      const deviationNm = haversineNm(frame.lat, frame.lon, leg.destination_lat, leg.destination_lon);
      // The link is kept either way — a diversion never auto-unlinks, because
      // the link records the intent and that stays true when the destination
      // changed. arrival_deviation_nm is written on both paths (§14).
      const status = deviationNm <= ARRIVAL_RADIUS_NM ? 'flown' : 'diverted';
      recordPlannedLegArrival(legId, status, Math.round(deviationNm * 10) / 10);

      console.log(
        `[FlightManager] Flight #${flightId} landed ${deviationNm.toFixed(1)} nm from ` +
        `planned ${leg.destination_ident} — leg #${legId} marked ${status}`
      );
    } catch (err) {
      console.warn(`[FlightManager] Flight #${flightId} arrival not recorded on its planned leg:`, err);
    }
  }

  private recordPoint(frame: SimFrame): void {
    if (Date.now() - this.lastPointTime < RECORD_INTERVAL_MS) return;
    this.writePoint(frame);
  }

  private writePoint(frame: SimFrame): void {
    if (this.currentFlightId === null) return;

    const now = Date.now();
    const ts = new Date(now).toISOString();

    if (this.pointCount > 0) {
      this.distanceNm += haversineNm(this.lastPointLat, this.lastPointLon, frame.lat, frame.lon);

      // Flight time is built from the gaps between points rather than the wall
      // clock. A gap far longer than the recording interval means recording had
      // stopped — a pause, slew, a frozen sim, a crashed agent — and that time
      // was not flown, so it is not counted.
      const gap = now - this.lastPointTime;
      if (!this.interrupted && gap <= MAX_COUNTED_GAP_MS) this.activeMs += gap;
    }

    if (frame.altitudeFt > this.maxAltitudeFt) this.maxAltitudeFt = frame.altitudeFt;
    if (frame.airspeedKnots > this.maxAirspeedKts) this.maxAirspeedKts = frame.airspeedKnots;

    insertPoint(
      this.currentFlightId,
      ts,
      frame.lat,
      frame.lon,
      frame.altitudeFt,
      frame.airspeedKnots,
      frame.groundSpeedKnots,
      frame.headingDeg,
      frame.verticalSpeedFpm,
      frame.onGround
    );

    this.lastPointLat = frame.lat;
    this.lastPointLon = frame.lon;
    this.lastPointTime = now;
    this.pointCount++;
    this.interrupted = false;
  }
}
