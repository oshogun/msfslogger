// Pure geometry for synthetic (custom) procedures: great-circle destination
// point, runway heading to true bearing, and runway threshold. No I/O.

export type HeadingReference = 'unknown' | 'true' | 'magnetic';

// Measured against live runways: the stored heading is a true bearing, and
// it describes the primary end. The constant stays so a test can flip it
// (and the sign in runwayTrueBearing if 'magnetic').
export const RUNWAY_HEADING_REFERENCE: HeadingReference = 'true';

const EARTH_RADIUS_M = 6371008.8;
const toRad = (d: number): number => (d * Math.PI) / 180;
const toDeg = (r: number): number => (r * 180) / Math.PI;

export function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Wraps a longitude into [-180, 180]. */
function normLon(lon: number): number {
  const w = ((((lon + 180) % 360) + 360) % 360) - 180;
  return w === -180 && lon > 0 ? 180 : w;
}

/** Great-circle destination point: start, bearing in degrees true, distance in metres. */
export function dest(lat: number, lon: number, bearingDeg: number, metres: number): { lat: number; lon: number } {
  const d = metres / EARTH_RADIUS_M;
  const brg = toRad(bearingDeg);
  const phi1 = toRad(lat);
  const lam1 = toRad(lon);
  const sinPhi2 = Math.sin(phi1) * Math.cos(d) + Math.cos(phi1) * Math.sin(d) * Math.cos(brg);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const lam2 =
    lam1 +
    Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(phi1), Math.cos(d) - Math.sin(phi1) * sinPhi2);
  return { lat: toDeg(phi2), lon: normLon(toDeg(lam2)) };
}

/**
 * The single place a stored runway heading becomes a true bearing. The
 * reference is a parameter so a test can flip it without touching the
 * production default.
 */
export function runwayTrueBearing(
  headingDeg: number,
  airportMagvar: number | null,
  reference: HeadingReference = RUNWAY_HEADING_REFERENCE,
): number {
  if (reference === 'magnetic') {
    // PROVISIONAL: the sign convention of the stored magnetic variation is
    // unverified; this assumes true = magnetic + magvar.
    return norm360(headingDeg + (airportMagvar ?? 0));
  }
  return norm360(headingDeg);
}

/**
 * Landing threshold of the runway end the plan names. The stored position is
 * the runway centre, so the pavement end is half the length along the axis,
 * and the landing threshold is that point moved inboard by the end's
 * displaced-threshold length (null or 0 means none). `primaryBearing` is the
 * primary end's landing direction; the secondary end uses it plus 180.
 * `bearingEnd` is the direction of landing/take-off on the named end.
 *
 * PROVISIONAL: which stored displacement belongs to which end (primary_* to
 * the primary end) rests on a single non-zero real-world sample.
 */
export function runwayThreshold(
  centreLat: number,
  centreLon: number,
  primaryBearing: number,
  lengthM: number,
  end: 'primary' | 'secondary',
  displacedM: number | null = null,
): { lat: number; lon: number; bearingEnd: number } {
  const inboard = typeof displacedM === 'number' && Number.isFinite(displacedM) && displacedM > 0 ? displacedM : 0;
  const bearingEnd = norm360(end === 'primary' ? primaryBearing : primaryBearing + 180);
  const pavementEnd = dest(centreLat, centreLon, bearingEnd + 180, lengthM / 2);
  const t = inboard === 0 ? pavementEnd : dest(pavementEnd.lat, pavementEnd.lon, bearingEnd, inboard);
  return { ...t, bearingEnd };
}

// PROVISIONAL: the sign convention of a custom approach's lateral offset is
// undefined, and a guessed sign would draw a plausible but wrong line, so a
// non-zero offset is ignored and the approach is drawn straight in.
export function customApproachOffsetDeg(_offsetDeg: number | null): number {
  return 0;
}

// PROVISIONAL: a custom departure's distance is measured from the departure
// threshold; the alternative reading is the far end of the runway.
export function customDepartureDatum(
  threshold: { lat: number; lon: number },
  _farEnd: { lat: number; lon: number },
): { lat: number; lon: number } {
  return threshold;
}
