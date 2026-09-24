/**
 * Data-visualisation colours for maps (and charts). Leaflet takes colours as
 * JS values rather than CSS, so a Carbon token cannot be handed to it; the
 * Gray 100 values are mirrored here as plain strings. Screens import from this
 * module instead of hard-coding a colour.
 */
export const palette = {
  /** Flown track. Carbon blue-40. */
  track: '#78a9ff',
  /** Departure marker, positive vertical speed. Carbon green-40. */
  departure: '#42be65',
  /** Arrival marker, negative vertical speed. Carbon red-50. */
  arrival: '#fa4d56',
  /** Planned route polyline and waypoint dots. Carbon gray-40. */
  planned: '#a8a8a8',
  /** Warnings. Carbon yellow-30. */
  warning: '#f1c21b',
  /** AI traffic in the air; on the ground it uses `trafficGround`. */
  trafficAir: '#f1c21b',
  trafficGround: '#8d8d8d',
  /** Own aircraft glyph. */
  aircraft: '#f4f4f4',
  /** Ring around dot markers. */
  markerBorder: '#f4f4f4',
  markerShadow: '#000000',
} as const;

/** Trip-leg cycle: blue-40, green-40, orange-40, purple-40, magenta-40. */
export const LEG_COLORS: readonly string[] = ['#78a9ff', '#42be65', '#ff832b', '#be95ff', '#ff7eb6'];

/** Colour for the n-th leg, wrapping around the cycle. */
export function legColor(index: number): string {
  return LEG_COLORS[((index % LEG_COLORS.length) + LEG_COLORS.length) % LEG_COLORS.length];
}
