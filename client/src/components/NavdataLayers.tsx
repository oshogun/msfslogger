import { useMemo, type ReactNode } from 'react';
import { CircleMarker, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { unwrapLonChain } from '../utils/geo';
import type { FeaturesResponse } from '../types';

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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
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
          return (
            <Polyline
              renderer={renderer}
              key={`${r.airport}-${r.designation}-${i}`}
              positions={runwayEnds(centre, r.headingDeg, r.lengthM)}
              pathOptions={{ color: RUNWAY_COLOR, weight: 3, opacity: 0.9}}
            >
              <Tooltip sticky>{`${r.airport} ${r.designation}`}</Tooltip>
            </Polyline>
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
            icon={labelIcon(escapeHtml(a.ident), a.hasDetail ? '#34d399' : '#fbbf24')}
            pane={NAVDATA_MARKER_PANE}
            interactive={false}
          />
        ))}
    </>
  );
}
