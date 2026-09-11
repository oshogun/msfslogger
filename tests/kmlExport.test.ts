// tests/kmlExport.test.ts — src/kmlExport.ts.
//
// src/kmlExport.ts imports nothing from ./db, ./server or ./index and performs
// no I/O — this file matches that: no fs, no network calls, no better-sqlite3,
// no live flights.db. Fixtures are plain KmlFlight / KmlPoint object literals
// built in-memory, never read from disk.
//
// Assertions are structural, via fast-xml-parser's XMLParser, not whole-string
// equality — the one exception is the coordinate-encoding test, which pins an
// exact known numeric value as a literal. Every test additionally asserts
// well-formedness with XMLValidator, since every generated document must be
// well-formed.

import { describe, expect, it } from 'vitest';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { buildFlightKml, buildFlightSetKml, buildTripKml, type KmlFlight, type KmlPoint } from '../src/kmlExport';

// ── XML parsing helpers ───────────────────────────────────────────────────────
// cdataPropName pulls the description's CDATA block out under its own key
// instead of merging it into surrounding text, matching src/lnmpln.ts's own
// use of fast-xml-parser elsewhere in this repo. parseTagValue: false keeps
// every value a string — the generator's own escaping/formatting is what's
// under test, not fast-xml-parser's numeric coercion.

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '#cdata',
  parseTagValue: false,
  trimValues: true,
});

function parseKml(xml: string): any {
  return parser.parse(xml);
}

function expectWellFormed(xml: string): void {
  expect(XMLValidator.validate(xml)).toBe(true);
}

/** Normalises a fast-xml-parser node that may be a single object or an array. */
function asArray<T>(x: T | T[] | undefined): T[] {
  if (x === undefined) return [];
  return Array.isArray(x) ? x : [x];
}

/** Splits a <coordinates> text block into its individual "lon,lat,alt" tuples. */
function coordLines(coordinatesText: string): string[] {
  return coordinatesText
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** No literal `null`/`undefined` may ever reach the document. */
function expectNoNullOrUndefinedLiterals(xml: string): void {
  expect(xml).not.toMatch(/\bnull\b/i);
  expect(xml).not.toMatch(/\bundefined\b/i);
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

function pt(lat: number, lon: number, altitude_ft: number): KmlPoint {
  return { lat, lon, altitude_ft };
}

function flight(over: Partial<KmlFlight> = {}): KmlFlight {
  return {
    id: 63,
    aircraft: 'Cessna 172',
    departure_icao: 'KSBA',
    arrival_icao: 'KMRY',
    start_time: '2026-09-09T00:44:26.913Z',
    end_time: '2026-09-09T02:35:35.640Z',
    duration_sec: 6664,
    distance_nm: 252.1,
    max_altitude_ft: 10080,
    points: [pt(34.426201, -119.841507, 100), pt(36.586952, -121.843079, 200)],
    ...over,
  };
}

// ── 1. Single flight happy path ────────────────────────────────────────────────

describe('buildFlightKml — single flight happy path', () => {
  it('produces one Document, one Placemark, no Folder, all five styles, well-formed KML 2.2', () => {
    const f = flight();
    const xml = buildFlightKml(f);
    expectWellFormed(xml);
    expectNoNullOrUndefinedLiterals(xml);

    const doc = parseKml(xml);
    expect(doc.kml['@_xmlns']).toBe('http://www.opengis.net/kml/2.2');
    expect(xml).not.toContain('xmlns:gx');
    expect(xml.endsWith('</kml>\n')).toBe(true);

    expect(doc.kml.Document.name).toBe('Flight #63 KSBA → KMRY — 2026-09-09');
    expect(doc.kml.Document.Folder).toBeUndefined();

    const styles = asArray(doc.kml.Document.Style);
    expect(styles).toHaveLength(5);
    expect(styles.map((s: any) => s['@_id'])).toEqual(['track-0', 'track-1', 'track-2', 'track-3', 'track-4']);
    expect(styles[0].LineStyle.color).toBe('fffaa560'); // aabbggrr byte order

    const placemark = doc.kml.Document.Placemark;
    expect(placemark.name).toBe('#63 KSBA → KMRY — 2026-09-09');
    expect(placemark.styleUrl).toBe('#track-0');
    expect(placemark.TimeSpan.begin).toBe(f.start_time);
    expect(placemark.TimeSpan.end).toBe(f.end_time);
    // KML 2.2 XSD Feature sequence.
    expect(Object.keys(placemark)).toEqual(['name', 'description', 'TimeSpan', 'styleUrl', 'LineString']);

    const coords = coordLines(placemark.LineString.coordinates);
    expect(coords).toHaveLength(2);
    expect(placemark.description['#cdata']).toContain('<th>Track points</th><td>2</td>');
  });
});

// ── 2. Multi-flight set: re-sorted by start_time, then id — not request order ──

describe('buildFlightSetKml — containers sorted by start_time then id, not request order', () => {
  it('re-sorts a set requested out of start_time order, recolouring by output position', () => {
    const early = flight({
      id: 59,
      departure_icao: 'PANC',
      arrival_icao: 'PADQ',
      start_time: '2026-09-07T22:55:19.474Z',
      end_time: '2026-09-08T01:11:41.635Z',
    });
    const mid = flight({
      id: 71,
      departure_icao: 'PADQ',
      arrival_icao: 'PAOM',
      start_time: '2026-09-08T10:00:00.000Z',
      end_time: '2026-09-08T12:00:00.000Z',
    });
    const late = flight({
      id: 63,
      departure_icao: 'PADQ',
      arrival_icao: 'PAPE',
      start_time: '2026-09-09T00:44:26.913Z',
      end_time: '2026-09-09T02:35:35.640Z',
    });

    // Deliberately NOT in start_time order — this is the request/array order.
    const xml = buildFlightSetKml([late, early, mid]);
    expectWellFormed(xml);
    expectNoNullOrUndefinedLiterals(xml);

    const doc = parseKml(xml);
    expect(doc.kml.Document.name).toBe('Selected flights (3)');
    expect(doc.kml.Document.Placemark).toBeUndefined(); // case B: always Folder-wrapped

    const folders = asArray(doc.kml.Document.Folder);
    expect(folders).toHaveLength(3);
    expect(folders.map((f: any) => f.name)).toEqual([
      '#59 PANC → PADQ — 2026-09-07',
      '#71 PADQ → PAOM — 2026-09-08',
      '#63 PADQ → PAPE — 2026-09-09',
    ]);
    expect(folders.map((f: any) => f.Placemark.name)).toEqual(folders.map((f: any) => f.name)); // Folder name = Placemark name

    // Style index follows OUTPUT position, not request position.
    expect(folders.map((f: any) => f.Placemark.styleUrl)).toEqual(['#track-0', '#track-1', '#track-2']);
  });
});

// ── 3. Whole trip in start_time order ───────────────────────────────────────────

describe('buildTripKml — whole trip, start_time order', () => {
  it('preserves start_time order and uses the trip name, escaped, as the Document name', () => {
    const leg1 = flight({
      id: 59,
      departure_icao: 'PANC',
      arrival_icao: 'PADQ',
      start_time: '2026-09-07T22:55:19.474Z',
      end_time: '2026-09-08T01:11:41.635Z',
    });
    const leg2 = flight({
      id: 63,
      departure_icao: 'PADQ',
      arrival_icao: 'PAPE',
      start_time: '2026-09-09T00:44:26.913Z',
      end_time: '2026-09-09T02:35:35.640Z',
    });
    const leg3 = flight({
      id: 71,
      departure_icao: 'PAPE',
      arrival_icao: 'PAOM',
      start_time: '2026-09-09T10:00:00.000Z',
      end_time: '2026-09-09T12:00:00.000Z',
    });

    const xml = buildTripKml('Alaska Loop', [leg1, leg2, leg3]);
    expectWellFormed(xml);
    expectNoNullOrUndefinedLiterals(xml);

    const doc = parseKml(xml);
    expect(doc.kml.Document.name).toBe('Alaska Loop');

    const folders = asArray(doc.kml.Document.Folder);
    expect(folders.map((f: any) => f.Placemark.name.match(/^#(\d+)/)[1])).toEqual(['59', '63', '71']);
    expect(folders.map((f: any) => f.Placemark.styleUrl)).toEqual(['#track-0', '#track-1', '#track-2']);
  });
});

// ── 4. Zero-point flight ─────────────────────────────────────────────────────

describe('buildFlightKml — zero-point flight', () => {
  it('emits a Placemark with name/description/TimeSpan but no geometry element at all', () => {
    const f = flight({ points: [] });
    const xml = buildFlightKml(f);
    expectWellFormed(xml);
    expectNoNullOrUndefinedLiterals(xml);

    const doc = parseKml(xml);
    const placemark = doc.kml.Document.Placemark;
    expect(placemark.name).toBeDefined();
    expect(placemark.description['#cdata']).toContain('<th>Track points</th><td>0</td>');
    expect(placemark.LineString).toBeUndefined();
    expect(placemark.Point).toBeUndefined();
    expect(xml).not.toContain('<coordinates>'); // not even an empty one
  });
});

// ── 5. One-point flight ──────────────────────────────────────────────────────

describe('buildFlightKml — one-point flight', () => {
  it('emits a Point, not a LineString', () => {
    const f = flight({ points: [pt(57.749284, -152.488563, 68.24)] });
    const xml = buildFlightKml(f);
    expectWellFormed(xml);
    expectNoNullOrUndefinedLiterals(xml);

    const doc = parseKml(xml);
    const placemark = doc.kml.Document.Placemark;
    expect(placemark.LineString).toBeUndefined();
    expect(placemark.Point).toBeDefined();
    expect(placemark.Point.altitudeMode).toBe('absolute');
    expect(placemark.Point.coordinates).toBe('-152.488563,57.749284,20.8'); // 68.24 ft * 0.3048 = 20.799... -> 20.8
    expect(placemark.description['#cdata']).toContain('<th>Track points</th><td>1</td>');
  });
});

// ── 6. Null departure_icao / arrival_icao / aircraft / end_time ─────────────────

describe('buildFlightKml — null departure_icao/arrival_icao/aircraft/end_time', () => {
  it('renders ???? in the label, "Unknown"/"In progress" in the description, and an open-ended TimeSpan', () => {
    const f = flight({
      id: 71,
      departure_icao: null,
      arrival_icao: null,
      aircraft: null,
      end_time: null,
      duration_sec: null,
      distance_nm: null,
      max_altitude_ft: null,
    });
    const xml = buildFlightKml(f);
    expectWellFormed(xml);
    expectNoNullOrUndefinedLiterals(xml);

    const doc = parseKml(xml);
    const placemark = doc.kml.Document.Placemark;
    expect(placemark.name).toBe('#71 ???? → ???? — 2026-09-09');

    const html = placemark.description['#cdata'];
    expect(html).toContain('<th>Aircraft</th><td>Unknown</td>');
    expect(html).toContain('<th>From</th><td>Unknown</td>');
    expect(html).toContain('<th>To</th><td>Unknown</td>');
    expect(html).toContain('<th>End</th><td>In progress</td>');
    expect(html).toContain('<th>Duration</th><td>Unknown</td>');
    expect(html).toContain('<th>Distance</th><td>Unknown</td>');
    expect(html).toContain('<th>Max altitude</th><td>Unknown</td>');

    // TimeSpan carries begin only — no <end> element at all.
    expect(placemark.TimeSpan.begin).toBe(f.start_time);
    expect(placemark.TimeSpan.end).toBeUndefined();
    expect(xml).not.toContain('<end>');
  });
});

// ── 7. Escaping: & < > " ' ──────────────────────────────────────────────────────

describe('escaping: & < > " \' in a trip name and an aircraft value', () => {
  it('escapes every special character and never breaks the CDATA wrapper, even with a ]]> payload', () => {
    // The exact doctored value, verified by hand.
    const nasty = `A&B <x> "q" 'z' ]]>`;
    const f = flight({ aircraft: nasty });
    const xml = buildTripKml(`Trip: ${nasty}`, [f]);
    expectWellFormed(xml);

    // Escaped form appears literally in the raw document...
    const escaped = 'A&amp;B &lt;x&gt; &quot;q&quot; &apos;z&apos; ]]&gt;';
    expect(xml).toContain(escaped);
    // ...and the CDATA-terminating sequence never appears unescaped.
    expect(xml).not.toContain(']]>]]>'); // sanity: no doubled terminator either
    const cdataBody = xml.slice(xml.indexOf('<![CDATA[') + '<![CDATA['.length, xml.indexOf(']]></description>'));
    expect(cdataBody).not.toContain(']]>');

    const doc = parseKml(xml);
    // Document <name> round-trips back to the original text once fast-xml-parser
    // decodes the entities (it is a normal element, not CDATA).
    expect(doc.kml.Document.name).toBe(`Trip: ${nasty}`);
    expect(doc.kml.Document.Folder.Placemark.description['#cdata']).toContain(escaped);
  });
});

// ── 8. Coordinate encoding: lon,lat,alt order, feet→metres, precision ──────────

describe('coordinate encoding — lon,lat,alt order and feet-to-metres conversion', () => {
  it('matches an exact worked example', () => {
    // lat 55.90914215639822, lon -159.15985271873274, altitude_ft 46.35459507171225
    // -> 46.35459507171225 * 0.3048 = 14.128920... -> "14.1"
    const f = flight({ points: [pt(55.90914215639822, -159.15985271873274, 46.35459507171225)] });
    const xml = buildFlightKml(f);
    expectWellFormed(xml);

    const doc = parseKml(xml);
    // One point -> a <Point>; same encoding rule as a LineString.
    expect(doc.kml.Document.Placemark.Point.coordinates).toBe('-159.159853,55.909142,14.1');
  });

  it('emits lon before lat inside a multi-point LineString too (order, not just value)', () => {
    // Two very different lat/lon magnitudes, so a lon/lat swap is unmistakable.
    const f = flight({
      points: [pt(1.0, -170.0, 0), pt(2.0, 170.0, 0)],
    });
    const xml = buildFlightKml(f);
    expectWellFormed(xml);

    const doc = parseKml(xml);
    const coords = coordLines(doc.kml.Document.Placemark.LineString.coordinates);
    expect(coords).toEqual(['-170.000000,1.000000,0.0', '170.000000,2.000000,0.0']);
  });
});
