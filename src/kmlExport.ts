// ── KML export generator ──────────────────────────────────────────────────────
//
// Rows in, a KML 2.2 string out. This module imports nothing from ./db,
// ./server, ./index or ./types and performs no I/O — no fs, no http, no
// better-sqlite3 — so it is a pure module in the style of src/geo.ts and
// src/lnmpln.ts: liftable into a test with no other source file, and safely
// importable by src/inspect-kml.ts without a database.
//
// The input types below are declared structurally rather than imported from
// ./types: FlightWithPoints is structurally assignable to KmlFlight (every
// field here exists on Flight with the same type, and FlightPoint is a
// superset of KmlPoint), so src/server.ts can pass getFlightById(id)! and
// trip.flights straight in with no cast and no mapping.
//
// Nothing here throws. There is no input this module rejects: null metadata,
// zero points and an empty flight array all have defined output. No mutable
// module-level state, no clock, no randomness — the same input always
// produces a byte-identical string.

// ── Input types (structural; FlightWithPoints from ./types satisfies KmlFlight) ──

/** The subset of FlightPoint the generator reads. */
export interface KmlPoint {
  lat: number;
  lon: number;
  /** Feet MSL, as stored. Converted to metres on output. */
  altitude_ft: number;
}

/** The subset of FlightWithPoints the generator reads. */
export interface KmlFlight {
  id: number;
  aircraft: string | null;
  departure_icao: string | null;
  arrival_icao: string | null;
  start_time: string;
  end_time: string | null;
  duration_sec: number | null;
  distance_nm: number | null;
  max_altitude_ft: number | null;
  points: KmlPoint[];
}

/** Body of POST /api/flights/export.kml. Imported by src/server.ts. */
export interface KmlFlightSetRequest {
  ids: number[];
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum ids accepted by the flight-set endpoint. */
export const MAX_FLIGHT_SET_IDS = 100;

/** Per-flight coordinate cap before decimation kicks in. */
export const MAX_TRACK_POINTS = 5000;

/** International foot. */
export const FT_TO_M = 0.3048;

/**
 * The client's leg palette (client/src/pages/Home.tsx:154), converted from
 * CSS #rrggbb to KML's aabbggrr byte order at full opacity. Index i is used
 * by the Placemark at output position i, mod 5.
 */
const STYLE_COLORS_AABBGGRR = ['fffaa560', 'ff99d334', 'ff0b9ef5', 'fffa8ba7', 'ff7171f8'];

// ── Escaping ───────────────────────────────────────────────────────────────

/**
 * The single escaping rule; applied at every interpolation point. `&` is
 * replaced first, or the ampersands introduced by the later replacements get
 * double-escaped.
 *
 * Control characters XML 1.0 forbids even when escaped — every code point
 * below 0x20 other than tab (0x09), LF (0x0A) and CR (0x0D) — are dropped
 * first. Filtered by code point rather than a regex range so no literal
 * control byte has to live in this source file.
 */
export function escapeXml(value: string): string {
  let s = '';
  for (const ch of String(value)) {
    const c = ch.charCodeAt(0);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) continue;
    s += ch;
  }
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Decimation ─────────────────────────────────────────────────────────────

/**
 * Below or at `max`, every point is emitted unchanged. Above it, a stride is
 * taken so the output length stays at or under `max + 1`; the first and last
 * points are always kept, so the track still starts and ends where the flight
 * did. Pure and deterministic: the result depends only on the input array.
 */
export function decimateTrack<T>(points: T[], max: number = MAX_TRACK_POINTS): T[] {
  if (points.length <= max) return points;
  const stride = Math.ceil(points.length / max);
  const out: T[] = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  const last = points[points.length - 1];
  if (out.length === 0 || out[out.length - 1] !== last) out.push(last);
  return out;
}

// ── Label and description ──────────────────────────────────────────────────

/** `new Date(start_time).toISOString().slice(0,10)`, or 'unknown date'. */
function dateStamp(startTime: string): string {
  if (!startTime) return 'unknown date';
  const d = new Date(startTime);
  if (Number.isNaN(d.getTime())) return 'unknown date';
  return d.toISOString().slice(0, 10);
}

/**
 * `#63 PADQ → PAPE — 2026-09-09`. Used as both `<Folder><name>` and
 * `<Placemark><name>`, and as part of the case-A document name. Not
 * pre-escaped — callers pass it through escapeXml() like any other string.
 */
export function flightLabel(flight: KmlFlight): string {
  const dep = flight.departure_icao ?? '????';
  const arr = flight.arrival_icao ?? '????';
  return `#${flight.id} ${dep} → ${arr} — ${dateStamp(flight.start_time)}`;
}

function formatDuration(sec: number | null): string {
  if (sec === null) return 'Unknown';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

/**
 * The nine-row CDATA table, exactly in this order, every time — no row is
 * ever omitted so the balloon has a fixed shape. `emittedPoints` is the
 * post-decimation count, not the stored count.
 */
function buildDescriptionHtml(flight: KmlFlight, emittedPoints: number): string {
  const rows: [string, string][] = [
    ['Aircraft', flight.aircraft ?? 'Unknown'],
    ['From', flight.departure_icao ?? 'Unknown'],
    ['To', flight.arrival_icao ?? 'Unknown'],
    ['Start', flight.start_time ? flight.start_time : 'Unknown'],
    ['End', flight.end_time ?? 'In progress'],
    ['Duration', formatDuration(flight.duration_sec)],
    ['Distance', flight.distance_nm !== null ? `${flight.distance_nm.toFixed(1)} nm` : 'Unknown'],
    ['Max altitude', flight.max_altitude_ft !== null ? `${Math.round(flight.max_altitude_ft)} ft` : 'Unknown'],
    ['Track points', String(emittedPoints)],
  ];
  return `<table>${rows
    .map(([label, value]) => `<tr><th>${escapeXml(label)}</th><td>${escapeXml(value)}</td></tr>`)
    .join('')}</table>`;
}

/**
 * Emitted only when start_time is a non-empty string; `<end>` is omitted for
 * an in-progress flight (null end_time) rather than the whole element.
 */
function buildTimeSpan(flight: KmlFlight): string | null {
  if (!flight.start_time) return null;
  const begin = `<begin>${escapeXml(flight.start_time)}</begin>`;
  const end = flight.end_time ? `<end>${escapeXml(flight.end_time)}</end>` : '';
  return `<TimeSpan>${begin}${end}</TimeSpan>`;
}

// ── Coordinates and geometry ───────────────────────────────────────────────

/** `lon,lat,alt`, no spaces, metres altitude. */
function formatCoordinate(p: KmlPoint): string {
  const lon = p.lon.toFixed(6);
  const lat = p.lat.toFixed(6);
  const alt = (p.altitude_ft * FT_TO_M).toFixed(1);
  return `${lon},${lat},${alt}`;
}

/**
 * Zero points → no geometry element at all. One point → a `<Point>`. Two or
 * more → a `<LineString>`. `indent` is the whitespace the geometry's own
 * opening/closing tags sit at.
 */
function renderGeometry(points: KmlPoint[], indent: string): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return [
      `${indent}<Point>`,
      `${indent}  <altitudeMode>absolute</altitudeMode>`,
      `${indent}  <coordinates>${formatCoordinate(points[0])}</coordinates>`,
      `${indent}</Point>`,
    ].join('\n');
  }
  const coordLines = points.map((p) => `${indent}    ${formatCoordinate(p)}`).join('\n');
  return [
    `${indent}<LineString>`,
    `${indent}  <extrude>0</extrude>`,
    `${indent}  <tessellate>0</tessellate>`,
    `${indent}  <altitudeMode>absolute</altitudeMode>`,
    `${indent}  <coordinates>`,
    coordLines,
    `${indent}  </coordinates>`,
    `${indent}</LineString>`,
  ].join('\n');
}

// ── Placemark, Folder, Styles ──────────────────────────────────────────────

/**
 * Element order inside `<Placemark>` follows the KML 2.2 XSD Feature
 * sequence: name, description, TimeSpan, styleUrl, geometry. `indent` is the
 * whitespace `<Placemark>` itself sits at (case A: 2 spaces under Document;
 * case B/C: 4 spaces under Folder).
 */
function renderPlacemark(flight: KmlFlight, styleIndex: number, indent: string): string {
  const label = escapeXml(flightLabel(flight));
  const emitted = decimateTrack(flight.points);
  const description = buildDescriptionHtml(flight, emitted.length);
  const timeSpan = buildTimeSpan(flight);
  const geometry = renderGeometry(emitted, `${indent}  `);

  const lines = [
    `${indent}<Placemark>`,
    `${indent}  <name>${label}</name>`,
    `${indent}  <description><![CDATA[${description}]]></description>`,
  ];
  if (timeSpan !== null) lines.push(`${indent}  ${timeSpan}`);
  lines.push(`${indent}  <styleUrl>#track-${styleIndex % 5}</styleUrl>`);
  if (geometry !== '') lines.push(geometry);
  lines.push(`${indent}</Placemark>`);
  return lines.join('\n');
}

/** One Folder per flight, cases B and C. Folder name = Placemark name. */
function renderFolder(flight: KmlFlight, styleIndex: number): string {
  const label = escapeXml(flightLabel(flight));
  return [
    '  <Folder>',
    `    <name>${label}</name>`,
    renderPlacemark(flight, styleIndex, '    '),
    '  </Folder>',
  ].join('\n');
}

/** Always all five, in every document, including the single-flight case. */
function renderStyles(): string {
  return STYLE_COLORS_AABBGGRR.map((color, i) =>
    [`  <Style id="track-${i}">`, `    <LineStyle><color>${color}</color><width>3</width></LineStyle>`, '  </Style>'].join(
      '\n',
    ),
  ).join('\n');
}

/** Sort: start_time ascending, ties broken by id ascending. Does not mutate the input. */
function sortFlights(flights: KmlFlight[]): KmlFlight[] {
  return [...flights].sort((a, b) => {
    if (a.start_time < b.start_time) return -1;
    if (a.start_time > b.start_time) return 1;
    return a.id - b.id;
  });
}

/** `<?xml …?><kml …><Document>…</Document></kml>`, ending in a single trailing newline. */
function renderDocument(name: string, body: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '<Document>',
    `  <name>${escapeXml(name)}</name>`,
    renderStyles(),
    ...body,
    '</Document>',
    '</kml>',
    '',
  ].join('\n');
}

// ── Generators ─────────────────────────────────────────────────────────────

/**
 * One flight, no Folder wrapper.
 * A flight with zero points yields a geometry-less Placemark.
 */
export function buildFlightKml(flight: KmlFlight): string {
  const name = `Flight ${flightLabel(flight)}`;
  return renderDocument(name, [renderPlacemark(flight, 0, '  ')]);
}

/**
 * An arbitrary set of flights, one Folder each.
 * Sorts by start_time asc, id asc; does NOT de-duplicate (the caller does).
 */
export function buildFlightSetKml(flights: KmlFlight[]): string {
  const sorted = sortFlights(flights);
  const name = `Selected flights (${sorted.length})`;
  return renderDocument(name, sorted.map((f, i) => renderFolder(f, i)));
}

/**
 * A whole trip, one Folder per flight.
 * `tripName` becomes the Document <name>, escaped.
 */
export function buildTripKml(tripName: string, flights: KmlFlight[]): string {
  const sorted = sortFlights(flights);
  return renderDocument(tripName, sorted.map((f, i) => renderFolder(f, i)));
}
