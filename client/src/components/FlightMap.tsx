import { useEffect, Fragment } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { MapReadySignal } from './MapReadySignal';
import type { FlightPoint, PlannedLegWithChildren } from '../types';
import { formatDistance } from '../utils/format';
import { unwrapLonChain } from '../utils/geo';

const mkIcon = (color: string) =>
  L.divIcon({
    className: '',
    iconAnchor: [6, 6],
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 4px #000"></div>`,
  });

// Frozen outside the flown-track colour by design.md §18 — identical on the
// trip map (TripMap.tsx, T-008), this flight map (T-017) and the printed map
// (T-021), so a planned route can never be mistaken for a flown track at a
// glance. Dashed, thinner, and drawn beneath the flown track (rendered first
// in JSX — Leaflet stacks same-pane layers in the order they are added).
const PLANNED_ROUTE_COLOR = '#94a3b8';

const mkWaypointIcon = () =>
  L.divIcon({
    className: '',
    iconAnchor: [4, 4],
    html: `<div style="width:8px;height:8px;border-radius:50%;background:${PLANNED_ROUTE_COLOR};border:1px solid #fff;box-shadow:0 0 3px #000;opacity:0.9"></div>`,
  });

function procedureNote(leg: PlannedLegWithChildren): string | null {
  const parts: string[] = [];
  if (leg.sid_name) parts.push(`SID ${leg.sid_name}`);
  if (leg.star_name) parts.push(`STAR ${leg.star_name}`);
  if (leg.approach_name) parts.push(`APP ${leg.approach_name}`);
  if (parts.length === 0) return null;
  // design.md §6.2: makes the gap at the ends read as missing procedure data,
  // not a drawing bug — the planned route is expected to diverge from the
  // flown track here, and that divergence is never "fixed" by this component.
  return `${parts.join(' · ')} (planned route excludes SID/STAR/approach legs)`;
}

function BoundsController({
  latlngs,
  plannedLatlngs,
}: {
  latlngs: [number, number][];
  plannedLatlngs: [number, number][];
}) {
  const map = useMap();
  useEffect(() => {
    const all = [...latlngs, ...plannedLatlngs];
    if (all.length === 0) return;
    map.fitBounds(L.latLngBounds(all), { padding: [30, 30] });
  }, [map, latlngs, plannedLatlngs]);
  return null;
}

interface Props {
  points: FlightPoint[];
  /**
   * Optional: when omitted, FlightMap renders exactly as it did before this
   * prop existed (design.md T-017 DoD 3 & 4). PrintFlight.tsx and PrintTrip.tsx
   * do not pass it and are unaffected, so the flight PDF export keeps
   * rendering untouched.
   *
   * When provided, the planned route is drawn beneath the flown track exactly
   * as stored in planned_waypoints — never snapped, warped or interpolated
   * toward the flown track. Where the leg has procedures, the two lines are
   * expected to visibly diverge at both ends (design.md §6.2, §20 item 29):
   * this is the file drawn faithfully, not a rendering defect.
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
}

export function FlightMap({ points, plannedLeg, onReady, preferCanvas = true, zoomControl = true }: Props) {
  const sortedWaypoints = plannedLeg ? plannedLeg.waypoints.slice().sort((a, b) => a.seq - b.seq) : [];
  if (points.length === 0 && sortedWaypoints.length === 0) {
    return <p style={{ padding: '2rem', color: '#4b5563' }}>No GPS points recorded.</p>;
  }

  const latlngs = unwrapLonChain(points.map(p => [p.lat, p.lon] as [number, number]));
  const rawPlannedChain: [number, number][] = sortedWaypoints.map(w => [w.lat, w.lon]);
  const plannedChain = unwrapLonChain(rawPlannedChain);
  const center = latlngs[0] ?? plannedChain[0] ?? ([0, 0] as [number, number]);

  const note = plannedLeg ? procedureNote(plannedLeg) : null;
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
        the same pane (design.md §18). Drawn from planned_waypoints exactly as
        stored — never snapped, warped or interpolated toward the flown track
        (design.md §6.2, §20 item 29): a visible gap at the ends of an IFR leg
        with procedures is the file drawn faithfully, not a bug.
      */}
      {plannedLeg && plannedChain.length > 0 && (
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
            // Qualified by the leg (design.md §18): real files number their
            // user waypoints WP1/WP2/WP3 in every leg, so a bare ident would
            // collide. Keyed by legId-seq, never by ident, for the same reason.
            <Marker key={`${plannedLeg.id}-${w.seq}`} position={plannedChain[i]} icon={mkWaypointIcon()}>
              <Tooltip>{`Leg ${plannedLeg.seq} · ${w.ident}`}</Tooltip>
            </Marker>
          ))}
        </Fragment>
      )}
      {latlngs.length > 0 && (
        <>
          <Polyline positions={latlngs} pathOptions={{ color: '#60a5fa', weight: 2.5, opacity: 0.9 }} />
          <Marker position={latlngs[0]} icon={mkIcon('#34d399')}>
            <Tooltip>Departure</Tooltip>
          </Marker>
          <Marker position={latlngs[latlngs.length - 1]} icon={mkIcon('#f87171')}>
            <Tooltip>Arrival</Tooltip>
          </Marker>
        </>
      )}
      <BoundsController latlngs={latlngs} plannedLatlngs={plannedChain} />
      <MapReadySignal onReady={onReady} />
    </MapContainer>
  );
}
