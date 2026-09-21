import { useEffect, useRef, Fragment } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { MapReadySignal } from './MapReadySignal';
import { NavdataOverlay } from './NavdataControls';
import {
  FetchDetailPrompt,
  RouteGeometryLayer,
  detailTargets,
  geometryHasChains,
  procedureNote,
} from './RouteGeometryLayer';
import type { FlightPoint, PlannedLegWithChildren, RouteGeometryResponse } from '../types';
import { formatDistance } from '../utils/format';
import { unwrapLonChain } from '../utils/geo';
import { useFitBoundsOnChange } from '../hooks/useFitBoundsOnChange';

const mkIcon = (color: string) =>
  L.divIcon({
    className: '',
    iconAnchor: [6, 6],
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 4px #000"></div>`,
  });

// Frozen outside the flown-track colour so it is identical on the trip map
// (TripMap.tsx), this flight map and the printed map — a planned route can
// never be mistaken for a flown track at a glance. Dashed, thinner, and
// drawn beneath the flown track (rendered first in JSX — Leaflet stacks
// same-pane layers in the order they are added).
const PLANNED_ROUTE_COLOR = '#94a3b8';

const mkWaypointIcon = () =>
  L.divIcon({
    className: '',
    iconAnchor: [4, 4],
    html: `<div style="width:8px;height:8px;border-radius:50%;background:${PLANNED_ROUTE_COLOR};border:1px solid #fff;box-shadow:0 0 3px #000;opacity:0.9"></div>`,
  });

function BoundsController({
  latlngs,
  plannedLatlngs,
}: {
  latlngs: [number, number][];
  plannedLatlngs: [number, number][];
}) {
  const map = useMap();
  useFitBoundsOnChange(map, [...latlngs, ...plannedLatlngs], [30, 30]);
  return null;
}

interface Props {
  points: FlightPoint[];
  /**
   * Optional: when omitted, FlightMap renders exactly as it did before this
   * prop existed. PrintFlight.tsx and PrintTrip.tsx do not pass it and are
   * unaffected, so the flight PDF export keeps rendering untouched.
   *
   * When provided, the planned route is drawn beneath the flown track exactly
   * as stored in planned_waypoints — never snapped, warped or interpolated
   * toward the flown track. Where the leg has procedures, the two lines are
   * expected to visibly diverge at both ends: this is the file drawn
   * faithfully, not a rendering defect.
   */
  plannedLeg?: PlannedLegWithChildren;
  /** Called once tiles have finished loading. Used by the PDF export. */
  onReady?: () => void;
  /**
   * Canvas polylines are rasterised at 1x when printed to PDF, which looks
   * soft. The print pages pass false so the track becomes a true vector path.
   */
  preferCanvas?: boolean;
  /** Print pages hide the zoom buttons — they are meaningless on paper. */
  zoomControl?: boolean;
  /** Adds the navdata toggles and layers. Off by default; the print pages leave it off. */
  navdata?: boolean;
  /**
   * The server's expansion of `plannedLeg` into SID / airway / STAR / approach
   * chains. Omitted, null or empty: the planned route is drawn exactly as it
   * always was. Never passed by the print pages.
   */
  routeGeometry?: RouteGeometryResponse | null;
  /** True while `routeGeometry` is still being fetched; holds back `onReady`. */
  routeGeometryLoading?: boolean;
}

export function FlightMap({ points, plannedLeg, onReady, preferCanvas = true, zoomControl = true, navdata = false, routeGeometry = null, routeGeometryLoading = false }: Props) {
  const geometry = plannedLeg && routeGeometry && routeGeometry.legId === plannedLeg.id ? routeGeometry : null;
  const drawnGeometry = geometry && geometryHasChains(geometry) ? geometry : null;
  const trackRef = useRef<L.Polyline>(null);
  // Geometry arrives after the track was drawn; keep the flown track on top.
  useEffect(() => {
    if (drawnGeometry) trackRef.current?.bringToFront();
  }, [drawnGeometry]);

  const sortedWaypoints = plannedLeg ? plannedLeg.waypoints.slice().sort((a, b) => a.seq - b.seq) : [];
  if (points.length === 0 && sortedWaypoints.length === 0) {
    return <p style={{ padding: '2rem', color: '#4b5563' }}>No GPS points recorded.</p>;
  }

  const latlngs = unwrapLonChain(points.map(p => [p.lat, p.lon] as [number, number]));
  const rawPlannedChain: [number, number][] = sortedWaypoints.map(w => [w.lat, w.lon]);
  const plannedChain = unwrapLonChain(rawPlannedChain);
  const center = latlngs[0] ?? plannedChain[0] ?? ([0, 0] as [number, number]);

  const geometryAnchor = plannedChain[0] ?? null;
  // The expanded enroute chain carries the plan's own waypoints; without it the plain planned polyline stays.
  const replacesPlanned = drawnGeometry !== null && drawnGeometry.enroute.points.length > 0;
  const note = plannedLeg ? procedureNote(plannedLeg, geometry) : null;
  const plannedLabel = plannedLeg
    ? `Planned route: ${plannedLeg.departure_ident} → ${plannedLeg.destination_ident}` +
      ` · approx. ${formatDistance(plannedLeg.approx_distance_nm)} nm`
    : '';

  return (
    <MapContainer
      style={{ height: '100%' }}
      zoom={10}
      center={center}
      preferCanvas={preferCanvas}
      zoomControl={zoomControl}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={18}
      />
      {/*
        The planned route renders first so it sits beneath the flown track in
        the same pane. Drawn from planned_waypoints exactly as stored — never
        snapped, warped or interpolated toward the flown track: a visible gap
        at the ends of an IFR leg with procedures is the file drawn
        faithfully, not a bug.
      */}
      {plannedLeg && plannedChain.length > 0 && !replacesPlanned && (
        <Fragment>
          <Polyline
            positions={plannedChain}
            pathOptions={{ color: PLANNED_ROUTE_COLOR, weight: 2, opacity: 0.9, dashArray: '6 6' }}
          >
            <Tooltip sticky>
              {plannedLabel}
              {note && <><br />{note}</>}
            </Tooltip>
          </Polyline>
          {sortedWaypoints.map((w, i) => (
            // Qualified by the leg: real files number their user waypoints
            // WP1/WP2/WP3 in every leg, so a bare ident would collide. Keyed
            // by legId-seq, never by ident, for the same reason.
            <Marker key={`${plannedLeg.id}-${w.seq}`} position={plannedChain[i]} icon={mkWaypointIcon()}>
              <Tooltip>{`Leg ${plannedLeg.seq} · ${w.ident}`}</Tooltip>
            </Marker>
          ))}
        </Fragment>
      )}
      {plannedLeg && drawnGeometry && (
        <RouteGeometryLayer
          legId={plannedLeg.id}
          legSeq={plannedLeg.seq}
          geometry={drawnGeometry}
          label={plannedLabel}
          note={note}
          anchor={geometryAnchor}
        />
      )}
      {latlngs.length > 0 && (
        <>
          <Polyline ref={trackRef} positions={latlngs} pathOptions={{ color: '#60a5fa', weight: 2.5, opacity: 0.9 }} />
          <Marker position={latlngs[0]} icon={mkIcon('#34d399')}>
            <Tooltip>Departure</Tooltip>
          </Marker>
          <Marker position={latlngs[latlngs.length - 1]} icon={mkIcon('#f87171')}>
            <Tooltip>Arrival</Tooltip>
          </Marker>
        </>
      )}
      <BoundsController latlngs={latlngs} plannedLatlngs={plannedChain} />
      {navdata && <NavdataOverlay />}
      <FetchDetailPrompt targets={detailTargets(geometry)} />
      <MapReadySignal onReady={onReady} pending={routeGeometryLoading} />
    </MapContainer>
  );
}
