import { Fragment, useMemo, type ReactNode } from 'react';
import { CircleMarker, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { unwrapLonChain } from '../utils/geo';
import type { FeatureAirport, FeaturesResponse } from '../types';

export const NAVDATA_PANE = 'navdata';
export const NAVDATA_MARKER_PANE = 'navdata-markers';

const AIRWAY_COLOR = '#64748b';
const NAVAID_COLOR = '#38bdf8';
const WAYPOINT_COLOR = '#a3a3a3';
const RUNWAY_COLOR = '#e2e8f0';
const LABEL_LIMIT = 150;

// A canvas-rendered Polyline ignores its `pane` option and draws into its
// renderer's pane, so with the maps' preferCanvas navdata paths would land in
// the same pane as the flown track and paint over it. Giving them a canvas
// renderer of their own, bound to the navdata pane, is what keeps them below.
// The renderer has to be a direct prop: react-leaflet only applies pathOptions
// through setStyle after the layer has already chosen its renderer.
const renderers = new WeakMap<L.Map, L.Canvas>();

function navdataRenderer(map: L.Map): L.Canvas {
  let r = renderers.get(map);
  if (!r) {
    r = L.canvas({ pane: NAVDATA_PANE });
    renderers.set(map, r);
  }
  return r;
}

/**
 * Creates the two navdata panes (below the overlay pane, so below flown tracks
 * and planned routes) before any child that draws into them mounts.
 */
export function NavdataPanes({ children }: { children?: ReactNode }) {
  const map = useMap();
  useMemo(() => {
    if (!map.getPane(NAVDATA_PANE)) map.createPane(NAVDATA_PANE).style.zIndex = '350';
    if (!map.getPane(NAVDATA_MARKER_PANE)) map.createPane(NAVDATA_MARKER_PANE).style.zIndex = '360';
  }, [map]);
  return <>{children}</>;
}

export interface NavdataVisibility {
  airports: boolean;
  navaids: boolean;
  waypoints: boolean;
  airways: boolean;
  runways: boolean;
}

/** One point placed in the frame of `anchor`, so it lands beside the view rather than a world-copy away. */
export function unwrapPoint(anchor: [number, number], lat: number, lon: number): [number, number] {
  return unwrapLonChain([anchor, [lat, lon]])[1];
}

/** A dateline-crossing leg comes back with its far end past ±180 instead of a straight line across the map. */
export function unwrapAirwayLeg(
  anchor: [number, number],
  from: [number, number],
  to: [number, number]
): [[number, number], [number, number]] {
  const chain = unwrapLonChain([anchor, from, to]);
  return [chain[1], chain[2]];
}

const M_PER_DEG_LAT = 111_320;

function runwayEnds(
  centre: [number, number],
  headingDeg: number,
  lengthM: number
): [[number, number], [number, number]] {
  const half = lengthM / 2;
  const h = (headingDeg * Math.PI) / 180;
  const dLat = (Math.cos(h) * half) / M_PER_DEG_LAT;
  const dLon = (Math.sin(h) * half) / (M_PER_DEG_LAT * Math.max(0.05, Math.cos((centre[0] * Math.PI) / 180)));
  return [
    [centre[0] - dLat, centre[1] - dLon],
    [centre[0] + dLat, centre[1] + dLon],
  ];
}

function labelIcon(text: string, color: string) {
  return L.divIcon({
    className: '',
    iconAnchor: [4, 4],
    html:
      `<div style="display:flex;align-items:center;gap:3px;white-space:nowrap;pointer-events:none">` +
      `<span style="width:8px;height:8px;border-radius:50%;background:${color};border:1px solid #fff;box-shadow:0 0 3px #000"></span>` +
      `<span style="font:600 10px system-ui;color:#e2e8f0;text-shadow:0 0 3px #000,0 0 3px #000">${text}</span></div>`,
  });
}

const mod360 = (deg: number) => ((deg % 360) + 360) % 360;

/**
 * A runway-end number, drawn bold and upright to the pilot who'd be landing on
 * that end — rotated to the end's own approach heading, black on white so it
 * reads against the pavement rather than beside a dot marker like the other
 * navdata labels.
 *
 * The anchor is the icon's own (0,0), never a guessed pixel offset: a fixed
 * `iconAnchor` assumes a fixed rendered box size, but the label's box varies
 * with its text ("14" vs "32R") and CSS `rotate` alone pivots around the
 * box's own center — whichever of those two centers doesn't match the
 * anchor drags the label off the runway centerline once rotated, in a
 * direction that flips between the two ends (they rotate ~180° apart),
 * which is exactly the mirrored left/right drift this fixes. `translate(-50%,-50%)`
 * (evaluated, per CSS, against the label's own shrink-to-fit box before the
 * later `rotate` in the same list is applied) recenters the box on the
 * anchor first, so `rotate` then pivots around that same point regardless of
 * text length or angle.
 */
function runwayLabelIcon(text: string, rotateDeg: number) {
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    html:
      `<div style="display:inline-block;transform:translate(-50%,-50%) rotate(${mod360(rotateDeg)}deg);` +
      `white-space:nowrap;pointer-events:none;font:700 13px system-ui;color:#000;` +
      `text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 2px #fff,0 0 2px #fff">${text}</div>`,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}

/** What the airport symbol claims, one property per knowledge axis.
 *  Exported so a test can assert the claim without parsing inline CSS. */
export interface AirportGlyph {
  /** 'disc' = the longest-runway length is known and sized it.
   *  'diamond' = length unknown; the symbol makes no size claim. */
  shape: 'disc' | 'diamond';
  /** Outer box of the symbol in px (the ring, when present, sits outside it). */
  sizePx: 8 | 9 | 13 | 18;
  /** Fill of the symbol. 'transparent' only on a diamond. */
  fill: string;
  /** Tower claim. 'none' means "known untowered", never "don't know". */
  ring: 'towered' | 'unknown' | 'none';
  /** Left offset of the ident label from the airport position, px. */
  labelLeftPx: 11 | 12 | 14 | 16;
}

const AIRPORT_TIER_LARGE_M = 2500;
const AIRPORT_TIER_MEDIUM_M = 1200;

const AIRPORT_SURFACE_FILL = {
  paved: '#334155', // slate-700, "pavement"
  soft: '#65a30d',  // lime-600, "grass/dirt"
  water: '#0369a1', // sky-700, deep water; not the navaid sky-400 #38bdf8
} as const;
const AIRPORT_FILL_SURFACE_UNKNOWN = '#f8fafc'; // blank disc: size known, surface not
const AIRPORT_UNKNOWN_STROKE = '#475569';       // slate-600, the diamond's outline
const AIRPORT_RING_TOWERED = '#0f172a';         // solid outer ring
const AIRPORT_RING_UNKNOWN = '#64748b';         // dashed outer ring
const AIRPORT_RIM = '#0f172a';
const AIRPORT_HALO = 'rgba(255,255,255,.85)';

const AIRPORT_TIER = {
  18: { ring: 26, label: 16 },
  13: { ring: 21, label: 14 },
  9: { ring: 17, label: 12 },
  8: { ring: 16, label: 11 },
} as const;

/** The whole decision, in one pure function. No other rule sets these. */
export function airportGlyph(a: FeatureAirport): AirportGlyph {
  const sizePx =
    a.longestRunwayM === null ? 8
      : a.longestRunwayM >= AIRPORT_TIER_LARGE_M ? 18
        : a.longestRunwayM >= AIRPORT_TIER_MEDIUM_M ? 13
          : 9;
  const shape = a.longestRunwayM === null ? 'diamond' : 'disc';
  // The index-airport case (nothing known at all) gets the plain diamond and
  // no ring: it is the majority of every viewport, so it stays the quietest
  // mark on the map, and a ring there would claim a tower fact we do not have.
  const nothingKnown = a.longestRunwayM === null && a.surface === null && a.towered === null;
  const ring: AirportGlyph['ring'] =
    nothingKnown ? 'none' : a.towered === true ? 'towered' : a.towered === null ? 'unknown' : 'none';
  const fill =
    shape === 'diamond' ? 'transparent'
      : a.surface === null ? AIRPORT_FILL_SURFACE_UNKNOWN
        : AIRPORT_SURFACE_FILL[a.surface];
  return { shape, sizePx, fill, ring, labelLeftPx: AIRPORT_TIER[sizePx].label };
}

/** Frozen markup for one airport glyph, `ident` already escaped by the caller. */
function airportIconHtml(g: AirportGlyph, ident: string): string {
  const half = g.sizePx / 2;
  const r = AIRPORT_TIER[g.sizePx].ring;
  const rot = g.shape === 'diamond' ? 'transform:rotate(45deg);' : 'border-radius:50%;';
  const ring = g.ring === 'none' ? ''
    : `<span style="position:absolute;left:${-r / 2}px;top:${-r / 2}px;width:${r}px;height:${r}px;` +
      `box-sizing:border-box;${rot}border:2px ${g.ring === 'towered' ? 'solid' : 'dashed'} ` +
      `${g.ring === 'towered' ? AIRPORT_RING_TOWERED : AIRPORT_RING_UNKNOWN}"></span>`;
  const body = g.shape === 'disc'
    ? `border-radius:50%;background:${g.fill};border:1px solid ${AIRPORT_RIM};box-shadow:0 0 0 1.5px ${AIRPORT_HALO}`
    : `transform:rotate(45deg);background:transparent;border:1.5px solid ${AIRPORT_UNKNOWN_STROKE};filter:drop-shadow(0 0 1.5px #fff)`;
  return (
    `<div data-glyph="${g.shape}" data-size="${g.sizePx}" data-ring="${g.ring}" data-fill="${g.fill}" ` +
    `style="position:relative;width:0;height:0;pointer-events:none">${ring}` +
    `<span style="position:absolute;left:${-half}px;top:${-half}px;width:${g.sizePx}px;height:${g.sizePx}px;` +
    `box-sizing:border-box;${body}"></span>` +
    `<span style="position:absolute;left:${g.labelLeftPx}px;top:-7px;line-height:14px;font:600 10px system-ui;` +
    `color:#e2e8f0;text-shadow:0 0 3px #000,0 0 3px #000">${ident}</span></div>`
  );
}

/**
 * The airport marker icon: a size/shape claim (longestRunwayM), a fill claim
 * (surface) and a ring claim (towered), each with its own distinct "unknown"
 * rendering so a missing fact can never be read as a known one. Self-positioning
 * like runwayLabelIcon(): iconSize/iconAnchor both [0,0], every child placed
 * from the airport's own point, so no box-model change can drift it off the
 * airport.
 */
export function airportIcon(a: FeatureAirport): L.DivIcon {
  const g = airportGlyph(a);
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    html: airportIconHtml(g, escapeHtml(a.ident)),
  });
}

interface LayersProps {
  data: FeaturesResponse;
  anchor: [number, number];
  visible: NavdataVisibility;
}

/** Draws one features response. Every position is unwrapped into the frame of `anchor` first. */
export function NavdataLayers({ data, anchor, visible }: LayersProps) {
  const map = useMap();
  const renderer = navdataRenderer(map);
  const labelled = data.waypoints.length + data.navaids.length <= LABEL_LIMIT;

  return (
    <>
      {visible.airways &&
        data.airways.map((leg, i) => {
          const positions = unwrapAirwayLeg(anchor, leg.from, leg.to);
          return (
            <Polyline
              renderer={renderer}
              key={`${leg.airway}-${leg.fromIdent}-${leg.toIdent}-${i}`}
              positions={positions}
              pathOptions={{ color: AIRWAY_COLOR, weight: 1.2, opacity: 0.8}}
            >
              <Tooltip sticky>{`${leg.airway}: ${leg.fromIdent} → ${leg.toIdent}`}</Tooltip>
            </Polyline>
          );
        })}
      {visible.runways &&
        data.runways.map((r, i) => {
          if (r.headingDeg === null || r.lengthM === null) return null;
          const centre = unwrapPoint(anchor, r.lat, r.lon);
          const ends = runwayEnds(centre, r.headingDeg, r.lengthM);
          const key = `${r.airport}-${r.designation}-${i}`;
          return (
            <Fragment key={key}>
              <Polyline
                renderer={renderer}
                positions={ends}
                pathOptions={{ color: RUNWAY_COLOR, weight: 3, opacity: 0.9}}
              >
                <Tooltip sticky>{`${r.airport} ${r.designation}`}</Tooltip>
              </Polyline>
              {r.designation !== '' && (
                <Marker
                  position={ends[0]}
                  icon={runwayLabelIcon(escapeHtml(r.designation), r.headingDeg)}
                  pane={NAVDATA_MARKER_PANE}
                  interactive={false}
                />
              )}
              {r.secondaryDesignation !== '' && (
                <Marker
                  position={ends[1]}
                  icon={runwayLabelIcon(escapeHtml(r.secondaryDesignation), r.headingDeg + 180)}
                  pane={NAVDATA_MARKER_PANE}
                  interactive={false}
                />
              )}
            </Fragment>
          );
        })}
      {visible.waypoints &&
        data.waypoints.map(w => {
          const pos = unwrapPoint(anchor, w.lat, w.lon);
          return labelled ? (
            <Marker key={w.key} position={pos} icon={labelIcon(escapeHtml(w.ident), WAYPOINT_COLOR)} pane={NAVDATA_MARKER_PANE} interactive={false} />
          ) : (
            <CircleMarker
              renderer={renderer}
              key={w.key}
              center={pos}
              radius={2.5}
              pathOptions={{ color: WAYPOINT_COLOR, weight: 1, fillOpacity: 0.8}}
            />
          );
        })}
      {visible.navaids &&
        data.navaids.map(n => {
          const pos = unwrapPoint(anchor, n.lat, n.lon);
          const key = `${n.kind}-${n.ident}-${n.region}-${n.lat}-${n.lon}`;
          return labelled ? (
            <Marker key={key} position={pos} icon={labelIcon(escapeHtml(n.ident), NAVAID_COLOR)} pane={NAVDATA_MARKER_PANE} interactive={false} />
          ) : (
            <CircleMarker
              renderer={renderer}
              key={key}
              center={pos}
              radius={3.5}
              pathOptions={{ color: NAVAID_COLOR, weight: 1.5, fillOpacity: 0.7}}
            />
          );
        })}
      {visible.airports &&
        data.airports.map(a => (
          <Marker
            key={a.ident}
            position={unwrapPoint(anchor, a.lat, a.lon)}
            icon={airportIcon(a)}
            pane={NAVDATA_MARKER_PANE}
            interactive={false}
          />
        ))}
    </>
  );
}
