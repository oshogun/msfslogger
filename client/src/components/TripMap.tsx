import { useEffect, Fragment } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { MapReadySignal } from './MapReadySignal';
import type { Flight, PlannedLegWithChildren } from '../types';
import { formatDistance } from '../utils/format';
import { unwrapLonChain } from '../utils/geo';

const LEG_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#a78bfa', '#f87171'];

// Frozen outside LEG_COLORS by design.md §18 so a planned route can never be
// mistaken for a flown leg at a glance. Dashed, thinner, drawn beneath flown
// tracks (rendered first in JSX — Leaflet stacks same-pane layers in the order
// they are added).
const PLANNED_ROUTE_COLOR = '#94a3b8';

const mkIcon = (color: string) =>
  L.divIcon({
    className: '',
    iconAnchor: [6, 6],
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 4px #000"></div>`,
  });

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
  // not a drawing bug.
  return `${parts.join(' · ')} (planned route excludes SID/STAR/approach legs)`;
}

function BoundsController({ flights, plannedLegs }: { flights: Flight[]; plannedLegs: PlannedLegWithChildren[] }) {
  const map = useMap();
  useEffect(() => {
    const flownPoints = flights.flatMap(f => (f.points || []).map(p => [p.lat, p.lon] as [number, number]));
    const plannedPoints = plannedLegs.flatMap(leg => {
      const chain = leg.waypoints.slice().sort((a, b) => a.seq - b.seq).map(w => [w.lat, w.lon] as [number, number]);
      return unwrapLonChain(chain);
    });
    const allPoints = [...flownPoints, ...plannedPoints];
    if (allPoints.length === 0) return;
    map.fitBounds(L.latLngBounds(allPoints), { padding: [30, 30] });
  }, [map, flights, plannedLegs]);
  return null;
}

interface Props {
  flights: Flight[];
  /**
   * Optional: when omitted, TripMap renders exactly as it did before this
   * prop existed (design.md T-008 DoD 1). Every existing caller — including
   * PrintTrip, which does not pass it — is unaffected.
   */
  plannedLegs?: PlannedLegWithChildren[];
  /** Called once tiles have finished loading. Used by the PDF export. */
  onReady?: () => void;
  /**
   * Canvas polylines are rasterised at 1x when printed to PDF, which looks
   * soft. The print pages pass false so the tracks become true vector paths.
   */
  preferCanvas?: boolean;
  /** Print pages hide the zoom buttons — they are meaningless on paper. */
  zoomControl?: boolean;
}

export function TripMap({ flights, plannedLegs = [], onReady, preferCanvas = true, zoomControl = true }: Props) {
  const hasPoints = flights.some(f => f.points && f.points.length > 0);
  const hasPlannedWaypoints = plannedLegs.some(l => l.waypoints && l.waypoints.length > 0);
  if (!hasPoints && !hasPlannedWaypoints) {
    return <p style={{ padding: '2rem', color: '#4b5563' }}>No GPS points recorded for this trip.</p>;
  }

  const firstPoint = flights.find(f => f.points?.length)?.points?.[0];
  const firstPlannedWaypoint = plannedLegs.flatMap(l => l.waypoints)[0];
  const center = firstPoint
    ? ([firstPoint.lat, firstPoint.lon] as [number, number])
    : firstPlannedWaypoint
      ? ([firstPlannedWaypoint.lat, firstPlannedWaypoint.lon] as [number, number])
      : ([0, 0] as [number, number]);

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
        Planned routes render first so they sit beneath flown tracks in the
        same pane (design.md §18). Drawn from planned_waypoints exactly as
        stored — never snapped, warped or interpolated toward the flown track
        (design.md §6.2, DoD 9): a visible gap at the ends of an IFR leg with
        procedures is the file drawn faithfully, not a bug.
      */}
      {plannedLegs.map((leg) => {
        const sortedWaypoints = leg.waypoints.slice().sort((a, b) => a.seq - b.seq);
        if (sortedWaypoints.length === 0) return null;
        const rawChain: [number, number][] = sortedWaypoints.map(w => [w.lat, w.lon]);
        const chain = unwrapLonChain(rawChain);
        const note = procedureNote(leg);
        const label =
          `Leg ${leg.seq} (planned) — ${leg.departure_ident} → ${leg.destination_ident}` +
          ` · approx. ${formatDistance(leg.approx_distance_nm)} nm`;
        return (
          <Fragment key={`planned-${leg.id}`}>
            <Polyline
              positions={chain}
              pathOptions={{ color: PLANNED_ROUTE_COLOR, weight: 2, opacity: 0.9, dashArray: '6 6' }}
            >
              <Tooltip sticky>
                {label}
                {note && <><br />{note}</>}
              </Tooltip>
            </Polyline>
            {sortedWaypoints.map((w, i) => (
              <Marker key={`${leg.id}-${w.seq}`} position={chain[i]} icon={mkWaypointIcon()}>
                <Tooltip>{`Leg ${leg.seq} · ${w.ident}`}</Tooltip>
              </Marker>
            ))}
          </Fragment>
        );
      })}
      {flights.map((f, i) => {
        const pts = f.points || [];
        if (pts.length === 0) return null;
        const color = LEG_COLORS[i % LEG_COLORS.length];
        const latlngs: [number, number][] = pts.map(p => [p.lat, p.lon]);
        return (
          <Fragment key={f.id}>
            <Polyline positions={latlngs} pathOptions={{ color, weight: 2.5, opacity: 0.9 }}>
              <Tooltip sticky>{`Leg ${i + 1}${f.aircraft ? ' — ' + f.aircraft : ''}`}</Tooltip>
            </Polyline>
            <Marker position={latlngs[0]} icon={mkIcon('#34d399')}>
              <Tooltip>{`Leg ${i + 1} departure`}</Tooltip>
            </Marker>
            <Marker position={latlngs[latlngs.length - 1]} icon={mkIcon('#f87171')}>
              <Tooltip>{`Leg ${i + 1} arrival`}</Tooltip>
            </Marker>
          </Fragment>
        );
      })}
      <BoundsController flights={flights} plannedLegs={plannedLegs} />
      <MapReadySignal onReady={onReady} />
    </MapContainer>
  );
}
