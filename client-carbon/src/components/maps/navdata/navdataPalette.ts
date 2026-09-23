/**
 * Colours for navdata symbols. Leaflet takes JS colour values, so the Gray 100
 * Carbon values are mirrored here as plain strings. Shapes and the
 * towered / surface / size encoding are unchanged; only the hues move onto the
 * Carbon data-visualisation ramp (the 40 tints read against the inverted tiles).
 */
export const navdataPalette = {
  /** Airways. Carbon gray-50. */
  airway: '#8d8d8d',
  /** Navaids. Carbon cyan-40. */
  navaid: '#33b1ff',
  /** Enroute waypoints and untowered airports — one "magenta" convention. Carbon purple-40. */
  waypoint: '#be95ff',
  /** Runway strip and label halo. Carbon gray-10. */
  runway: '#f4f4f4',
  /** Runway-end numbers, drawn on the light strip. Carbon gray-100. */
  runwayLabel: '#161616',
  /** Symbol label text. Carbon gray-10. */
  label: '#f4f4f4',
  /** Halo behind label text and dot symbols. Carbon gray-100. */
  halo: '#161616',
  /** Towered airport. Carbon blue-40. */
  airportTowered: '#78a9ff',
  /** Untowered airport. Carbon purple-40. */
  airportUntowered: '#be95ff',
  /** Detail known, no tower fact either way. Carbon gray-40. */
  airportTowerUnknown: '#a8a8a8',
  /** Centre of an open (paved) circle. Carbon gray-10. */
  airportHollowCentre: '#f4f4f4',
  /** Outline of the unknown-size diamond. Carbon gray-40. */
  airportUnknownStroke: '#a8a8a8',
  /** Ring around airport discs, rgba of gray-100. */
  airportHalo: 'rgba(22,22,22,.85)',
  /** Planned-route waypoint and join colour. Carbon gray-40. */
  planned: '#a8a8a8',
  /** Ring around waypoint dots. Carbon gray-10. */
  ring: '#f4f4f4',
  shadow: '#000000',
} as const;
