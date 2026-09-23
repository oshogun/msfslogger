/**
 * The prototype's whole "backend". Every accessor is async, resolves after
 * MOCK_LATENCY_MS and never calls fetch(). Writes mutate an in-memory store
 * seeded from ./data; a page reload restores the seed.
 */
import type {
  AcarsMessage, CannedAcarsMessage, CurrentGroundSessionResponse, FeaturesResponse, Flight, FlightPoint,
  Journey, JourneyLeg, NavdataStatusResponse, PlannedLegListItem, PlannedLegWithChildren,
  RouteGeometryResponse, SayIntentionsLinkStatus, SayIntentionsSettings, SimbriefSettings, Status, Trip,
} from './types';
import { SEED_FLIGHTS } from './data/flights';
import { SEED_PLANNED_LEGS } from './data/plannedLegs';
import { SEED_TRIPS, type TripBase } from './data/trips';
import { SEED_ACARS, SEED_CANNED, SEED_METARS } from './data/acars';
import { SEED_GROUND_SESSION, STATUS_LOOP_SEC, statusAt } from './data/live';
import {
  maskKey, SEED_SAYINTENTIONS_KEY, SEED_SI_LINKS, SEED_SIMBRIEF,
} from './data/settings';
import { featuresFor, geometryFor, SEED_NAVDATA_STATUS } from './data/navdata';
import { AIRPORTS } from './data/airports';

/** Artificial latency for every accessor below, in ms. One constant, one place. */
export const MOCK_LATENCY_MS = 250;

// ── Store ──────────────────────────────────────────────────────────────────

const store = {
  flights: structuredClone(SEED_FLIGHTS),
  legs: structuredClone(SEED_PLANNED_LEGS),
  trips: structuredClone(SEED_TRIPS),
  acars: structuredClone(SEED_ACARS),
  simbrief: structuredClone(SEED_SIMBRIEF),
  siKey: SEED_SAYINTENTIONS_KEY as string | null,
  siLinks: structuredClone(SEED_SI_LINKS),
  ground: structuredClone(SEED_GROUND_SESSION),
  nextFlightId: 100,
  nextTripId: 100,
  nextAcarsId: 1000,
};

// ── Failure injection and latency ──────────────────────────────────────────

/**
 * Failure injection for the error states every screen renders. `?fail=flights,trips`
 * makes the named accessors reject with `new Error('Mock failure: <name>')`. A name
 * is either a group (flights, trips, legs, acars, settings, navdata, ground,
 * journey, live) or an exact accessor name such as `getFlight`.
 */
export function failing(name: string): boolean {
  if (typeof window === 'undefined') return false;
  const raw = new URLSearchParams(window.location.search).get('fail');
  if (!raw) return false;
  return raw.split(',').map(s => s.trim()).includes(name);
}

function respond<T>(group: string, accessor: string, fn: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    setTimeout(() => {
      const failed = [group, accessor].find(failing);
      if (failed) return reject(new Error(`Mock failure: ${failed}`));
      try {
        resolve(structuredClone(fn()));
      } catch (e) {
        reject(e);
      }
    }, MOCK_LATENCY_MS);
  });
}

// ── Derivations ────────────────────────────────────────────────────────────

const stripPoints = (f: Flight): Flight => {
  const { points: _points, ...rest } = f;
  void _points;
  return rest;
};

function findFlight(id: number): Flight {
  const f = store.flights.find(x => x.id === id);
  if (!f) throw new Error(`Flight ${id} not found`);
  return f;
}

function findLegRaw(id: number): PlannedLegWithChildren {
  const l = store.legs.find(x => x.id === id);
  if (!l) throw new Error(`Planned leg ${id} not found`);
  return l;
}

function hydrateLeg(l: PlannedLegWithChildren): PlannedLegWithChildren {
  const linked = store.flights.find(f => f.planned_leg_id === l.id);
  return { ...l, linked_flight_id: linked ? linked.id : null };
}

function hydrateTrip(base: TripBase, withLegs: boolean): Trip {
  const flights = store.flights.filter(f => f.trip_id === base.id)
    .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''));
  const legs = store.legs.filter(l => l.trip_id === base.id).sort((a, b) => a.seq - b.seq || a.id - b.id);
  const durs = flights.map(f => f.duration_sec).filter((x): x is number => x != null);
  const dists = flights.map(f => f.distance_nm).filter((x): x is number => x != null);
  const alts = flights.map(f => f.max_altitude_ft).filter((x): x is number => x != null);
  return {
    id: base.id, name: base.name, notes: base.notes, is_active: base.is_active,
    flight_count: flights.length,
    total_duration_sec: durs.length ? durs.reduce((a, b) => a + b, 0) : null,
    total_distance_nm: dists.length ? Math.round(dists.reduce((a, b) => a + b, 0) * 10) / 10 : null,
    max_altitude_ft: alts.length ? Math.max(...alts) : null,
    flights: flights.map(stripPoints),
    planned_leg_count: legs.length,
    planned_legs: withLegs ? legs.map(hydrateLeg) : [],
  };
}

function findTripBase(id: number): TripBase {
  const t = store.trips.find(x => x.id === id);
  if (!t) throw new Error(`Trip ${id} not found`);
  return t;
}

function tripName(id: number | null): string | null {
  return id == null ? null : store.trips.find(t => t.id === id)?.name ?? null;
}

function downsample(points: FlightPoint[], max: number): [number, number][] {
  if (points.length === 0) return [];
  const step = Math.max(1, Math.floor(points.length / max));
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i += step) out.push([points[i].lat, points[i].lon]);
  const last = points[points.length - 1];
  out.push([last.lat, last.lon]);
  return out;
}

function buildJourney(tripId: number): Journey {
  const base = findTripBase(tripId);
  const flights = store.flights.filter(f => f.trip_id === base.id && f.end_time)
    .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''));
  const legs: JourneyLeg[] = flights.map((f, i) => ({
    id: f.id, seq: i + 1, aircraft: f.aircraft, departureIcao: f.departure_icao, arrivalIcao: f.arrival_icao,
    distanceNm: f.distance_nm, durationSec: f.duration_sec, startTime: f.start_time ?? '',
    track: downsample(f.points ?? [], 24),
  }));
  const visits = new Map<string, number>();
  for (const f of flights) {
    for (const icao of [f.departure_icao, f.arrival_icao]) if (icao) visits.set(icao, (visits.get(icao) ?? 0) + 1);
  }
  const airports = [...visits].map(([icao, n]) => ({
    icao, name: AIRPORTS[icao]?.name ?? null, lat: AIRPORTS[icao]?.lat ?? 0, lon: AIRPORTS[icao]?.lon ?? 0, visits: n,
  }));
  const countries = new Map<string, { name: string; flag: string; airports: number }>();
  for (const a of airports) {
    const info = AIRPORTS[a.icao];
    if (!info) continue;
    const c = countries.get(info.country) ?? { name: info.country, flag: info.flag, airports: 0 };
    c.airports += 1;
    countries.set(info.country, c);
  }
  const byAircraft = new Map<string, { name: string; legs: number; distanceNm: number }>();
  for (const f of flights) {
    const k = f.aircraft ?? 'Unknown';
    const e = byAircraft.get(k) ?? { name: k, legs: 0, distanceNm: 0 };
    e.legs += 1;
    e.distanceNm = Math.round((e.distanceNm + (f.distance_nm ?? 0)) * 10) / 10;
    byAircraft.set(k, e);
  }
  const longest = flights.reduce<Flight | null>((m, f) => ((f.distance_nm ?? 0) > (m?.distance_nm ?? -1) ? f : m), null);
  let chainLen = flights.length ? 1 : 0;
  let bestLen = chainLen;
  let bestStart = 0;
  let curStart = 0;
  let breaks = 0;
  for (let i = 1; i < flights.length; i++) {
    if (flights[i].departure_icao === flights[i - 1].arrival_icao) {
      chainLen += 1;
    } else {
      breaks += 1;
      chainLen = 1;
      curStart = i;
    }
    if (chainLen > bestLen) {
      bestLen = chainLen;
      bestStart = curStart;
    }
  }
  const planned = store.legs.filter(l => l.trip_id === tripId);
  const done = planned.filter(l => l.status === 'flown' || l.status === 'diverted').length;
  const journey: Journey = {
    legCount: flights.length,
    totalDistanceNm: Math.round(flights.reduce((s, f) => s + (f.distance_nm ?? 0), 0) * 10) / 10,
    totalDurationSec: flights.reduce((s, f) => s + (f.duration_sec ?? 0), 0),
    aircraftCount: byAircraft.size,
    aircraft: [...byAircraft.values()],
    maxAltitudeFt: Math.max(0, ...flights.map(f => f.max_altitude_ft ?? 0)),
    maxAirspeedKts: Math.max(0, ...flights.map(f => f.max_airspeed_kts ?? 0)),
    longestLeg: longest
      ? { id: longest.id, route: `${longest.departure_icao} → ${longest.arrival_icao}`, distanceNm: longest.distance_nm ?? 0 }
      : null,
    countries: [...countries.values()],
    airports,
    longestChain: flights.length
      ? { length: bestLen, from: flights[bestStart].departure_icao ?? '?', to: flights[bestStart + bestLen - 1].arrival_icao ?? '?' }
      : null,
    chainBreaks: breaks,
    legs,
    firstFlight: flights[0]?.start_time ?? null,
    lastFlight: flights[flights.length - 1]?.start_time ?? null,
  };
  if (planned.length > 0) journey.plannedRouteProgressPct = Math.round((done / planned.length) * 100);
  return journey;
}

function threadMessages(match: (m: AcarsMessage) => boolean): AcarsMessage[] {
  return store.acars.filter(match).sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.id - b.id);
}

function addMessage(m: Omit<AcarsMessage, 'id' | 'dedup_key' | 'read_at' | 'payload_json'> & { payload_json?: string | null }): AcarsMessage {
  const full: AcarsMessage = { id: store.nextAcarsId++, dedup_key: null, read_at: null, payload_json: null, ...m };
  store.acars.push(full);
  return full;
}

type Scope = { flightId: number } | { legId: number };
const scopeFields = (scope: Scope) =>
  'flightId' in scope
    ? { flight_id: scope.flightId, planned_leg_id: null }
    : { flight_id: null, planned_leg_id: scope.legId };

// ── Reads ──────────────────────────────────────────────────────────────────

export function listFlights(): Promise<Flight[]> {
  return respond('flights', 'listFlights', () =>
    store.flights.map(stripPoints).sort((a, b) => (b.start_time ?? '').localeCompare(a.start_time ?? '')));
}
export function getFlight(id: number): Promise<Flight> {
  return respond('flights', 'getFlight', () => findFlight(id));
}
export function listTrips(): Promise<Trip[]> {
  return respond('trips', 'listTrips', () => store.trips.map(t => hydrateTrip(t, false)));
}
export function getTrip(id: number): Promise<Trip> {
  return respond('trips', 'getTrip', () => hydrateTrip(findTripBase(id), true));
}
export function getJourney(tripId: number): Promise<Journey> {
  return respond('journey', 'getJourney', () => buildJourney(tripId));
}
export function listPlannedLegs(): Promise<PlannedLegListItem[]> {
  return respond('legs', 'listPlannedLegs', () =>
    store.legs.map(l => ({ ...hydrateLeg(l), trip_name: tripName(l.trip_id) })));
}
export function getPlannedLeg(id: number): Promise<PlannedLegWithChildren> {
  return respond('legs', 'getPlannedLeg', () => hydrateLeg(findLegRaw(id)));
}
export function getFlightAcars(flightId: number): Promise<{ flight_id: number; planned_leg_id: number | null; messages: AcarsMessage[] }> {
  return respond('acars', 'getFlightAcars', () => {
    const legId = findFlight(flightId).planned_leg_id;
    return {
      flight_id: flightId,
      planned_leg_id: legId,
      messages: threadMessages(m => m.flight_id === flightId || (legId != null && m.flight_id == null && m.planned_leg_id === legId)),
    };
  });
}
export function getPlannedLegAcars(legId: number): Promise<{ planned_leg_id: number; messages: AcarsMessage[] }> {
  return respond('acars', 'getPlannedLegAcars', () => ({
    planned_leg_id: legId,
    messages: threadMessages(m => m.planned_leg_id === legId),
  }));
}
export function listCannedMessages(): Promise<CannedAcarsMessage[]> {
  return respond('acars', 'listCannedMessages', () => SEED_CANNED);
}
export function getCurrentGroundSession(): Promise<CurrentGroundSessionResponse> {
  return respond('ground', 'getCurrentGroundSession', () => store.ground);
}
export function getSimbriefSettings(): Promise<SimbriefSettings> {
  return respond('settings', 'getSimbriefSettings', () => store.simbrief);
}
export function getSayIntentionsSettings(): Promise<SayIntentionsSettings> {
  return respond('settings', 'getSayIntentionsSettings', () => siSettings());
}
export function getSayIntentionsLink(flightId: number): Promise<SayIntentionsLinkStatus> {
  return respond('settings', 'getSayIntentionsLink', () => {
    findFlight(flightId);
    const link = store.siLinks.find(l => l.flight_id === flightId) ?? null;
    return { flight_id: flightId, linked: link != null, link, api_key_set: store.siKey != null };
  });
}
export function getNavdataStatus(): Promise<NavdataStatusResponse> {
  return respond('navdata', 'getNavdataStatus', () => SEED_NAVDATA_STATUS);
}
export function getNavdataFeatures(bbox: [number, number, number, number], zoom: number): Promise<FeaturesResponse> {
  return respond('navdata', 'getNavdataFeatures', () => featuresFor(bbox, zoom));
}
export function getRouteGeometry(legId: number): Promise<RouteGeometryResponse> {
  return respond('navdata', 'getRouteGeometry', () => geometryFor(findLegRaw(legId)));
}

// ── Writes (in-memory; a reload restores the seed) ─────────────────────────

export function patchFlight(id: number, patch: Partial<Pick<Flight, 'aircraft' | 'notes'>>): Promise<Flight> {
  return respond('flights', 'patchFlight', () => {
    const f = findFlight(id);
    if ('aircraft' in patch) f.aircraft = patch.aircraft ?? null;
    if ('notes' in patch) f.notes = patch.notes ?? null;
    return f;
  });
}
export function deleteFlight(id: number): Promise<void> {
  return respond('flights', 'deleteFlight', () => {
    findFlight(id);
    store.flights = store.flights.filter(f => f.id !== id);
    store.acars = store.acars.filter(m => m.flight_id !== id);
    store.siLinks = store.siLinks.filter(l => l.flight_id !== id);
  });
}
export function combineFlights(id1: number, id2: number): Promise<{ id: number }> {
  return respond('flights', 'combineFlights', () => {
    const a = findFlight(id1);
    const b = findFlight(id2);
    const [first, second] = (a.start_time ?? '') <= (b.start_time ?? '') ? [a, b] : [b, a];
    const points = [...(first.points ?? []), ...(second.points ?? [])];
    first.points = points;
    first.point_count = points.length;
    first.end_time = second.end_time;
    first.duration_sec = (first.duration_sec ?? 0) + (second.duration_sec ?? 0);
    first.distance_nm = Math.round(((first.distance_nm ?? 0) + (second.distance_nm ?? 0)) * 10) / 10;
    first.max_altitude_ft = Math.max(first.max_altitude_ft ?? 0, second.max_altitude_ft ?? 0) || null;
    first.max_airspeed_kts = Math.max(first.max_airspeed_kts ?? 0, second.max_airspeed_kts ?? 0) || null;
    first.arrival_icao = second.arrival_icao;
    first.arrival_name = second.arrival_name;
    first.arrival_lat = second.arrival_lat;
    first.arrival_lon = second.arrival_lon;
    store.acars.forEach(m => { if (m.flight_id === second.id) m.flight_id = first.id; });
    store.flights = store.flights.filter(f => f.id !== second.id);
    return { id: first.id };
  });
}
export function createTrip(name: string): Promise<{ id: number }> {
  return respond('trips', 'createTrip', () => {
    const id = store.nextTripId++;
    store.trips.push({ id, name, notes: null, is_active: 0 });
    return { id };
  });
}
export function patchTrip(id: number, patch: Partial<Pick<Trip, 'name' | 'notes'>>): Promise<Trip> {
  return respond('trips', 'patchTrip', () => {
    const t = findTripBase(id);
    if (patch.name !== undefined) t.name = patch.name;
    if (patch.notes !== undefined) t.notes = patch.notes;
    return hydrateTrip(t, true);
  });
}
export function deleteTrip(id: number): Promise<void> {
  return respond('trips', 'deleteTrip', () => {
    findTripBase(id);
    const legIds = new Set(store.legs.filter(l => l.trip_id === id).map(l => l.id));
    store.flights.forEach(f => {
      if (f.trip_id === id) f.trip_id = null;
      if (f.planned_leg_id != null && legIds.has(f.planned_leg_id)) {
        f.planned_leg_id = null;
        f.planned_leg_link_source = null;
        f.planned_leg_prev_trip_id = null;
      }
    });
    store.legs = store.legs.filter(l => l.trip_id !== id);
    store.trips = store.trips.filter(t => t.id !== id);
  });
}
export function addFlightToTrip(tripId: number, flightId: number): Promise<void> {
  return respond('trips', 'addFlightToTrip', () => {
    findTripBase(tripId);
    findFlight(flightId).trip_id = tripId;
  });
}
export function removeFlightFromTrip(tripId: number, flightId: number): Promise<void> {
  return respond('trips', 'removeFlightFromTrip', () => {
    const f = findFlight(flightId);
    if (f.trip_id === tripId) f.trip_id = null;
  });
}
export function setActiveTrip(tripId: number | null): Promise<void> {
  return respond('trips', 'setActiveTrip', () => {
    if (tripId != null) findTripBase(tripId);
    store.trips.forEach(t => { t.is_active = t.id === tripId ? 1 : 0; });
  });
}
export function linkFlightToLeg(flightId: number, legId: number | null): Promise<Flight> {
  return respond('legs', 'linkFlightToLeg', () => {
    const f = findFlight(flightId);
    if (legId == null) {
      f.trip_id = f.planned_leg_prev_trip_id;
      f.planned_leg_id = null;
      f.planned_leg_link_source = null;
      f.planned_leg_prev_trip_id = null;
      return f;
    }
    const leg = findLegRaw(legId);
    store.flights.forEach(o => {
      if (o.id !== flightId && o.planned_leg_id === legId) {
        o.planned_leg_id = null;
        o.planned_leg_link_source = null;
      }
    });
    f.planned_leg_prev_trip_id = f.trip_id;
    f.planned_leg_id = legId;
    f.planned_leg_link_source = 'manual';
    f.trip_id = leg.trip_id;
    return f;
  });
}
export function setPlannedLegStatus(legId: number, status: 'planned' | 'skipped' | 'flown'): Promise<PlannedLegWithChildren> {
  return respond('legs', 'setPlannedLegStatus', () => {
    const l = findLegRaw(legId);
    l.status = status;
    return hydrateLeg(l);
  });
}
export function reorderPlannedLegs(tripId: number, legIds: number[]): Promise<PlannedLegWithChildren[]> {
  return respond('legs', 'reorderPlannedLegs', () => {
    findTripBase(tripId);
    legIds.forEach((id, i) => {
      const l = findLegRaw(id);
      if (l.trip_id !== tripId) throw new Error(`Leg ${id} is not in trip ${tripId}`);
      l.seq = i + 1;
    });
    return legIds.map(id => hydrateLeg(findLegRaw(id)));
  });
}
export function deletePlannedLeg(legId: number): Promise<void> {
  return respond('legs', 'deletePlannedLeg', () => {
    findLegRaw(legId);
    store.flights.forEach(f => {
      if (f.planned_leg_id === legId) {
        f.planned_leg_id = null;
        f.planned_leg_link_source = null;
        f.planned_leg_prev_trip_id = null;
      }
    });
    store.legs = store.legs.filter(l => l.id !== legId);
  });
}
export function sendCannedAcars(scope: Scope, cannedId: string): Promise<AcarsMessage> {
  return respond('acars', 'sendCannedAcars', () => {
    const c = SEED_CANNED.find(x => x.id === cannedId);
    if (!c) throw new Error(`Unknown canned message ${cannedId}`);
    return addMessage({
      ...scopeFields(scope), direction: c.direction, category: c.category, label: c.label.toUpperCase(),
      body: c.body, correlation_id: null, sent_at: new Date().toISOString(),
    });
  });
}
export function requestWx(scope: Scope, icao: string): Promise<{ request: AcarsMessage; reply: AcarsMessage }> {
  return respond('acars', 'requestWx', () => {
    const code = icao.trim().toUpperCase();
    const now = Date.now();
    const request = addMessage({
      ...scopeFields(scope), direction: 'downlink', category: 'wx', label: `REQUEST WX ${code}`,
      body: `REQUEST WX ${code}`, correlation_id: null, sent_at: new Date(now).toISOString(),
    });
    const metar = SEED_METARS[code] ?? `${code} 231300Z 18008KT 9999 FEW030 22/14 Q1015`;
    const reply = addMessage({
      ...scopeFields(scope), direction: 'uplink', category: 'wx', label: `WX ${code}`, body: metar,
      payload_json: JSON.stringify({ icao: code, metar, taf: null, fetched_at: new Date(now).toISOString() }),
      correlation_id: request.id, sent_at: new Date(now + 4000).toISOString(),
    });
    return { request, reply };
  });
}

// ── Settings writes (addition to the frozen contract, for the Settings screen) ──

function siSettings(): SayIntentionsSettings {
  return store.siKey
    ? { sayintentions_api_key_set: true, sayintentions_api_key_masked: maskKey(store.siKey) }
    : { sayintentions_api_key_set: false, sayintentions_api_key_masked: null };
}
export function saveSimbriefSettings(userId: string | null): Promise<SimbriefSettings> {
  return respond('settings', 'saveSimbriefSettings', () => {
    const trimmed = userId?.trim() ?? '';
    store.simbrief = { simbrief_user_id: trimmed === '' ? null : trimmed };
    return store.simbrief;
  });
}
export function saveSayIntentionsKey(key: string): Promise<SayIntentionsSettings> {
  return respond('settings', 'saveSayIntentionsKey', () => {
    if (key.trim() === '') throw new Error('API key must not be empty');
    store.siKey = key.trim();
    return siSettings();
  });
}
export function clearSayIntentionsKey(): Promise<SayIntentionsSettings> {
  return respond('settings', 'clearSayIntentionsKey', () => {
    store.siKey = null;
    return siSettings();
  });
}

// ── Live status ────────────────────────────────────────────────────────────

/**
 * The live-status poll. Cycles a scripted sequence (IDLE → GROUND → FLYING →
 * paused → FLYING → IDLE, ~90 s) so the header Tag, the Home live panel and the
 * live map all animate without a backend. `?statusSpeed=N` runs the script N
 * times faster (for screenshots). Returns an unsubscribe function.
 */
export function subscribeStatus(onStatus: (s: Status) => void): () => void {
  let speed = 1;
  if (typeof window !== 'undefined') {
    const n = Number(new URLSearchParams(window.location.search).get('statusSpeed'));
    if (Number.isFinite(n) && n > 0) speed = n;
  }
  const started = Date.now();
  const tick = () => {
    if (failing('live')) return;
    onStatus(structuredClone(statusAt((((Date.now() - started) / 1000) * speed) % STATUS_LOOP_SEC)));
  };
  tick();
  const timer = setInterval(tick, speed > 1 ? 500 : 1000);
  return () => clearInterval(timer);
}
