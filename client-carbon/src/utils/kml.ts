import type { Flight } from '../mock/types';

/** The flights table refuses to export more than this many at once. */
export const MAX_KML_FLIGHTS = 100;

const KML_MIME = 'application/vnd.google-earth.kml+xml';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const endpoints = (f: Flight): string[] =>
  [[f.departure_lon, f.departure_lat], [f.arrival_lon, f.arrival_lat]]
    .filter(([lon, lat]) => lon != null && lat != null).map(c => c.join(','));

interface KmlOptions {
  /** Emitted as the Document's <name> when given. */
  documentName?: string;
  /** Placemark label for each flight (escaped here). */
  label: (f: Flight, index: number) => string;
  /** Draw the recorded track at altitude when there is one, instead of a departure-to-arrival line. */
  useTrack?: boolean;
}

function buildKml(flights: Flight[], { documentName, label, useTrack = false }: KmlOptions): string {
  const marks = flights.map((f, i) => {
    const hasTrack = useTrack && (f.points ?? []).length > 0;
    const coords = hasTrack
      ? f.points!.map(p => `${p.lon},${p.lat},${Math.round(p.altitude_ft * 0.3048)}`)
      : endpoints(f);
    const mode = useTrack ? '<altitudeMode>absolute</altitudeMode>' : '';
    return `<Placemark><name>${esc(label(f, i))}</name><LineString>${mode}`
      + `<coordinates>${coords.join(' ')}</coordinates></LineString></Placemark>`;
  });
  const docName = documentName != null ? `<name>${esc(documentName)}</name>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${docName}${marks.join('')}</Document></kml>`;
}

/** Flights table selection: one departure-to-arrival placemark per flight. */
export const buildFlightsKml = (flights: Flight[]) =>
  buildKml(flights, { label: f => `#${f.id} ${f.aircraft ?? 'Unknown'}` });

/** One flight: the recorded track, else departure to arrival. */
export const buildFlightKml = (flight: Flight) =>
  buildKml([flight], { label: f => `#${f.id} ${f.aircraft ?? 'Unknown'}`, useTrack: true });

/** One placemark per flown leg of a trip. */
export const buildTripKml = (name: string, flights: Flight[]) =>
  buildKml(flights, { documentName: name, label: (f, i) => `Leg ${i + 1} ${f.aircraft ?? 'Unknown'}` });

/** Hands a KML string to the browser as a download. */
export function downloadKml(filename: string, kml: string): void {
  const url = URL.createObjectURL(new Blob([kml], { type: KML_MIME }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
