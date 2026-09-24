import { Fragment, type ReactNode } from 'react';
import { Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { FlightPoint, PlannedLegWithChildren } from '../../types';
import { formatDistance } from '../../utils/format';
import { unwrapLonChain } from '../../utils/geo';
import { useFitBoundsOnChange } from '../../hooks/useFitBoundsOnChange';
import { CarbonMap } from './CarbonMap';
import { palette } from './palette';

const dotIcon = (color: string) =>
  L.divIcon({
    className: '',
    iconAnchor: [6, 6],
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid ${palette.markerBorder};box-shadow:0 0 4px ${palette.markerShadow}"></div>`,
  });

const waypointIcon = () =>
  L.divIcon({
    className: '',
    iconAnchor: [4, 4],
    html: `<div style="width:8px;height:8px;border-radius:50%;background:${palette.planned};border:1px solid ${palette.markerBorder};box-shadow:0 0 3px ${palette.markerShadow};opacity:0.9"></div>`,
  });

function BoundsController({ latlngs }: { latlngs: [number, number][] }) {
  const map = useMap();
  useFitBoundsOnChange(map, latlngs, [30, 30]);
  return null;
}

export interface FlightMapProps {
  /** Recorded track points, in time order. */
  points: FlightPoint[];
  /**
   * When given, the planned route is drawn beneath the flown track exactly as
   * stored (dashed, never snapped to the track) with a dot per waypoint.
   */
  plannedLeg?: PlannedLegWithChildren;
  /** CSS height of the map. Default `'24rem'`. */
  height?: string;
  /** Show the zoom buttons. Default true. */
  zoomControl?: boolean;
  /**
   * Extra overlay layers (route geometry, navdata, ...), rendered inside the
   * map after the track. Anything react-leaflet renders may go here.
   */
  children?: ReactNode;
}

/**
 * A finished (or in-progress) flight: flown track, departure and arrival
 * markers, optional planned route; fits to everything until the user moves the map.
 */
export function FlightMap({ points, plannedLeg, height, zoomControl = true, children }: FlightMapProps) {
  const sortedWaypoints = plannedLeg ? plannedLeg.waypoints.slice().sort((a, b) => a.seq - b.seq) : [];
  if (points.length === 0 && sortedWaypoints.length === 0) {
    return <p style={{ padding: '2rem', color: 'var(--cds-text-helper)' }}>No GPS points recorded.</p>;
  }

  const latlngs = unwrapLonChain(points.map(p => [p.lat, p.lon] as [number, number]));
  const plannedChain = unwrapLonChain(sortedWaypoints.map(w => [w.lat, w.lon] as [number, number]));
  const center = latlngs[0] ?? plannedChain[0] ?? ([0, 0] as [number, number]);
  const plannedLabel = plannedLeg
    ? `Planned route: ${plannedLeg.departure_ident} → ${plannedLeg.destination_ident}` +
      ` · approx. ${formatDistance(plannedLeg.approx_distance_nm)} nm`
    : '';

  return (
    <CarbonMap center={center} height={height} zoomControl={zoomControl} data-testid="flight-map">
      {/* Planned route first so it sits beneath the flown track in the same pane. */}
      {plannedLeg && plannedChain.length > 0 && (
        <Fragment>
          <Polyline
            positions={plannedChain}
            pathOptions={{ color: palette.planned, weight: 2, opacity: 0.9, dashArray: '6 6' }}
          >
            <Tooltip sticky>{plannedLabel}</Tooltip>
          </Polyline>
          {sortedWaypoints.map((w, i) => (
            <Marker key={`${plannedLeg.id}-${w.seq}`} position={plannedChain[i]} icon={waypointIcon()}>
              <Tooltip>{`Leg ${plannedLeg.seq} · ${w.ident}`}</Tooltip>
            </Marker>
          ))}
        </Fragment>
      )}
      {latlngs.length > 0 && (
        <>
          <Polyline positions={latlngs} pathOptions={{ color: palette.track, weight: 2.5, opacity: 0.9 }} />
          <Marker position={latlngs[0]} icon={dotIcon(palette.departure)}>
            <Tooltip>Departure</Tooltip>
          </Marker>
          <Marker position={latlngs[latlngs.length - 1]} icon={dotIcon(palette.arrival)}>
            <Tooltip>Arrival</Tooltip>
          </Marker>
        </>
      )}
      <BoundsController latlngs={[...latlngs, ...plannedChain]} />
      {children}
    </CarbonMap>
  );
}
