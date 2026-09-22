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
  /** Outer box of the symbol in px. */
  sizePx: 8 | 9 | 13 | 18;
  /** Tower-status color (blue = towered, purple = untowered, gray = unknown).
   *  null only on the diamond, which makes no tower claim at all. */
  color: string | null;
  /** Surface claim, read as fill treatment: 'hollow' = paved (open circle),
   *  'filled' = soft or water, 'faded' = surface unknown but size known
   *  (reduced-opacity fill), 'none' = diamond, no surface claim. */
  fill: 'hollow' | 'filled' | 'faded' | 'none';
  /** Longest runway's heading, already folded mod 180 (a line has no
   *  direction). null = not known, or the diamond — no line is drawn. */
  headingDeg: number | null;
  /** Left offset of the ident label from the airport position, px. */
  labelLeftPx: 11 | 12 | 14 | 16;
}

const AIRPORT_TIER_LARGE_M = 2500;
const AIRPORT_TIER_MEDIUM_M = 1200;

const AIRPORT_COLOR_TOWERED = '#1d4ed8';        // blue, deeper than the navaid sky-400 #38bdf8
const AIRPORT_COLOR_UNTOWERED = '#c026d3';      // purple/magenta
const AIRPORT_COLOR_TOWER_UNKNOWN = '#94a3b8';  // gray: detail known, no tower fact either way
const AIRPORT_HOLLOW_CENTRE = '#f8fafc';        // near-white centre of an open (paved) circle
const AIRPORT_UNKNOWN_STROKE = '#475569';       // slate-600, the diamond's outline
const AIRPORT_HALO = 'rgba(255,255,255,.85)';

const AIRPORT_TIER = {
  18: { label: 16 },
  13: { label: 14 },
  9: { label: 12 },
  8: { label: 11 },
} as const;

const mod180 = (deg: number) => ((deg % 180) + 180) % 180;

/** The whole decision, in one pure function. No other rule sets these. */
export function airportGlyph(a: FeatureAirport): AirportGlyph {
  const sizePx =
    a.longestRunwayM === null ? 8
      : a.longestRunwayM >= AIRPORT_TIER_LARGE_M ? 18
        : a.longestRunwayM >= AIRPORT_TIER_MEDIUM_M ? 13
          : 9;
  const shape = a.longestRunwayM === null ? 'diamond' : 'disc';
  const color: AirportGlyph['color'] =
    shape === 'diamond' ? null
      : a.towered === true ? AIRPORT_COLOR_TOWERED
        : a.towered === false ? AIRPORT_COLOR_UNTOWERED
          : AIRPORT_COLOR_TOWER_UNKNOWN;
  const fill: AirportGlyph['fill'] =
    shape === 'diamond' ? 'none'
      : a.surface === 'paved' ? 'hollow'
        : a.surface === 'soft' || a.surface === 'water' ? 'filled'
          : 'faded';
  const headingDeg = shape === 'diamond' || a.longestRunwayHeadingDeg === null
    ? null
    : mod180(a.longestRunwayHeadingDeg);
  return { shape, sizePx, color, fill, headingDeg, labelLeftPx: AIRPORT_TIER[sizePx].label };
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** The disc's own border+background, given its tower color and surface fill. */
function airportDiscStyle(color: string, fill: AirportGlyph['fill']): string {
  switch (fill) {
    case 'hollow': return `background:${AIRPORT_HOLLOW_CENTRE};border:2px solid ${color}`;
    case 'filled': return `background:${color};border:1px solid ${color}`;
    default: return `background:${withAlpha(color, 0.4)};border:1px solid ${color}`; // 'faded'
  }
}

/** The short runway-direction tick, through the icon's own (0,0). A line's
 *  width is fixed up front, so centering it on the anchor is just `left:
 *  -half; width: 2*half` — the span is already centered before `rotate`
 *  applies, unlike `runwayLabelIcon()`'s variable-width text, which needs a
 *  `translate(-50%,-50%)` because its box size isn't known until it renders.
 *
 *  The span itself is a horizontal bar at rest — its long axis lies along
 *  screen +x, bearing 090, not bearing 0. `runwayLabelIcon()`'s `rotate(headingDeg)`
 *  is correct as-is because text's "up" axis (not its long/reading axis)
 *  carries the bearing, and that axis already points at bearing 0 by
 *  default — a different piece of geometry from a bar's long axis, so it
 *  needs a different offset: `headingDeg - 90` turns the bar's own
 *  bearing-090 rest axis to point at `headingDeg`. */
function airportDirectionLineHtml(g: AirportGlyph): string {
  if (g.headingDeg === null || g.color === null) return '';
  const len = g.sizePx * 1.75; // 1.5-2x the disc's diameter
  const half = len / 2;
  const thickness = 2;
  return (
    `<span data-direction-line="" data-rotate-deg="${g.headingDeg}" style="position:absolute;` +
    `left:${-half}px;top:${-thickness / 2}px;width:${len}px;height:${thickness}px;` +
    `background:${g.color};transform:rotate(${g.headingDeg - 90}deg);pointer-events:none"></span>`
  );
}

/** Frozen markup for one airport glyph, `ident` already escaped by the caller. */
function airportIconHtml(g: AirportGlyph, ident: string): string {
  const half = g.sizePx / 2;
  const body = g.shape === 'disc' && g.color !== null
    ? `border-radius:50%;${airportDiscStyle(g.color, g.fill)};box-shadow:0 0 0 1.5px ${AIRPORT_HALO}`
    : `transform:rotate(45deg);background:transparent;border:1.5px solid ${AIRPORT_UNKNOWN_STROKE};filter:drop-shadow(0 0 1.5px #fff)`;
  const line = airportDirectionLineHtml(g);
  return (
    `<div data-glyph="${g.shape}" data-size="${g.sizePx}" data-color="${g.color ?? 'none'}" data-fill="${g.fill}" ` +
    `style="position:relative;width:0;height:0;pointer-events:none">${line}` +
    `<span style="position:absolute;left:${-half}px;top:${-half}px;width:${g.sizePx}px;height:${g.sizePx}px;` +
    `box-sizing:border-box;${body}"></span>` +
    `<span style="position:absolute;left:${g.labelLeftPx}px;top:-7px;line-height:14px;font:600 10px system-ui;` +
    `color:#e2e8f0;text-shadow:0 0 3px #000,0 0 3px #000">${ident}</span></div>`
  );
}

/**
 * The airport marker icon: a size/shape claim (longestRunwayM), a color claim
 * (towered), a fill claim (surface) and a direction-line claim
 * (longestRunwayHeadingDeg), each with its own distinct "unknown" rendering
 * so a missing fact can never be read as a known one. Self-positioning like
 * runwayLabelIcon(): iconSize/iconAnchor both [0,0], every child placed from
 * the airport's own point, so no box-model change can drift it off the
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
