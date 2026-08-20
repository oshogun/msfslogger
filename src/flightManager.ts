import type { SimFrame, FlightState, AppState } from './types';
import { insertFlight, insertPoint, closeFlight } from './db';
import { findNearestAirport } from './airports';

const RECORD_INTERVAL_MS = 5000;
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

export class FlightManager {
  private state: FlightState = 'IDLE';
  private currentFlightId: number | null = null;
  private airborneStreak = 0;
  private landedStreak = 0;
  private isPaused = false;
  private lastPointTime = 0;

  // Accumulated stats for the current flight
  private distanceNm = 0;
  private maxAltitudeFt = 0;
  private maxAirspeedKts = 0;
  private pointCount = 0;
  private lastPointLat = 0;
  private lastPointLon = 0;
  private flightStartMs = 0;
  // Paused wall-clock time, excluded from the logged duration
  private pausedAccumMs = 0;
  private pauseStartedMs = 0;

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
   * It is kept only so the UI can say *which* kind of pause is active; any
   * non-zero value stops the flight clock, including Active Pause.
   */
  setPaused(paused: boolean, flags = paused ? 1 : 0): void {
    this.appState.paused = paused;
    this.appState.pauseFlags = paused ? flags : 0;

    // Only act on transitions — Pause_EX1 can repeat the same state
    if (paused === this.isPaused) return;
    this.isPaused = paused;

    if (paused) {
      this.pauseStartedMs = Date.now();
    } else if (this.pauseStartedMs > 0) {
      this.pausedAccumMs += Date.now() - this.pauseStartedMs;
      this.pauseStartedMs = 0;
    }
  }

  /** Total paused time this flight, including a pause still in progress. */
  private pausedMs(): number {
    return this.isPaused && this.pauseStartedMs > 0
      ? this.pausedAccumMs + (Date.now() - this.pauseStartedMs)
      : this.pausedAccumMs;
  }

  /** Wall-clock time since takeoff, minus any time spent paused. */
  private flightTimeMs(): number {
    return Math.max(0, Date.now() - this.flightStartMs - this.pausedMs());
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
        if (inSlew || this.isPaused) break;

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
    this.pausedAccumMs = 0;
    // A pause already in progress starts counting from takeoff, not from when
    // it began — the time before takeoff was never part of this flight.
    this.pauseStartedMs = this.isPaused ? Date.now() : 0;

    this.appState.flightState = 'FLYING';
    this.appState.currentFlightId = id;

    console.log(`[FlightManager] Flight #${id} started — ${frame.aircraft}`);

    // Record the first point immediately
    this.writePoint(frame);
  }

  private endFlight(frame: SimFrame): void {
    if (this.currentFlightId === null) return;

    const endTime = new Date().toISOString();
    const durationSec = Math.round(this.flightTimeMs() / 1000);
    // Uses pausedMs() so a flight ending while still paused reports correctly
    const pausedSec = Math.round(this.pausedMs() / 1000);

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
      (pausedSec > 0 ? ` (${pausedSec}s paused, excluded)` : '')
    );

    this.currentFlightId = null;
    this.state = 'IDLE';
    this.appState.flightState = 'IDLE';
    this.appState.currentFlightId = null;
    this.airborneStreak = 0;
    this.landedStreak = 0;
  }

  private recordPoint(frame: SimFrame): void {
    if (Date.now() - this.lastPointTime < RECORD_INTERVAL_MS) return;
    this.writePoint(frame);
  }

  private writePoint(frame: SimFrame): void {
    if (this.currentFlightId === null) return;

    const ts = new Date().toISOString();

    if (this.pointCount > 0) {
      this.distanceNm += haversineNm(this.lastPointLat, this.lastPointLon, frame.lat, frame.lon);
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
    this.lastPointTime = Date.now();
    this.pointCount++;
  }
}
