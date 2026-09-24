import { useEffect, useRef, type ReactNode } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { getFlight } from '../../api';
import type { Status, TrafficObject } from '../../types';
import { CarbonMap } from './CarbonMap';
import { palette } from './palette';

// The glyph itself points east (90 degrees), not north, so headings are
// corrected by that offset before being applied as a CSS rotation.
function makeAircraftIcon(headingDeg: number) {
  return L.divIcon({
    className: '',
    html: `<div style="transform:rotate(${headingDeg - 90}deg);font-size:24px;line-height:1;color:${palette.aircraft};filter:drop-shadow(0 1px 3px rgba(0,0,0,.8))">✈</div>`,
    iconAnchor: [12, 12],
  });
}

// AI traffic: smaller, coloured by onGround, translucent, and no zIndexOffset,
// so the user's own aircraft always renders on top.
function makeTrafficIcon(headingDeg: number, onGround: boolean) {
  const color = onGround ? palette.trafficGround : palette.trafficAir;
  return L.divIcon({
    className: '',
    html: `<div style="transform:rotate(${headingDeg - 90}deg);font-size:16px;line-height:1;color:${color};opacity:.85;filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))">✈</div>`,
    iconAnchor: [8, 8],
  });
}

function LiveMapController({ status }: { status: Status }) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const trackRef = useRef<L.Polyline | null>(null);
  const lastFetchRef = useRef(0);
  const lastFlightIdRef = useRef<number | null>(null);
  const trafficRef = useRef<Map<number, L.Marker>>(new Map());
  // Positions seen since the last track fetch started; keeps the drawn track
  // reaching the aircraft between fetches (the fetched track lags by up to a poll).
  const tailRef = useRef<L.LatLngTuple[]>([]);

  useEffect(() => {
    const { frame, currentFlightId } = status;
    if (!frame) return;
    const { lat, lon, headingDeg } = frame;
    if (lat === 0 && Math.abs(lon - 90) < 0.01) return;

    const pos: L.LatLngTuple = [lat, lon];

    if (!markerRef.current) {
      markerRef.current = L.marker(pos, { icon: makeAircraftIcon(headingDeg), zIndexOffset: 1000 }).addTo(map);
      map.setView(pos, 10);
    } else {
      markerRef.current.setLatLng(pos);
      markerRef.current.setIcon(makeAircraftIcon(headingDeg));
      map.panTo(pos, { animate: true, duration: 0.8 });
    }

    const trackStale = Date.now() - lastFetchRef.current > 10000;
    const flightChanged = currentFlightId !== lastFlightIdRef.current;
    if (currentFlightId && (trackStale || flightChanged)) {
      lastFetchRef.current = Date.now();
      lastFlightIdRef.current = currentFlightId;
      tailRef.current = [];
      getFlight(currentFlightId)
        .then(flight => {
          if (!flight.points?.length) return;
          const latlngs: L.LatLngTuple[] = [...flight.points.map((p): L.LatLngTuple => [p.lat, p.lon]), ...tailRef.current];
          if (trackRef.current) {
            trackRef.current.setLatLngs(latlngs);
          } else {
            trackRef.current = L.polyline(latlngs, { color: palette.track, weight: 2.5, opacity: 0.8 }).addTo(map);
          }
        })
        .catch(() => {
          // A failed track fetch leaves the previous track in place; the next tick retries.
        });
    }

    tailRef.current.push(pos);
    trackRef.current?.addLatLng(pos);

    map.invalidateSize();
  });

  // AI traffic lives in its own effect, independent of the own-aircraft guards
  // above, so a missing frame never blocks it. Markers are moved while an id
  // persists and removed when it leaves the batch. It never touches the
  // viewport; the effect above owns that.
  useEffect(() => {
    const traffic: TrafficObject[] = status.traffic ?? [];
    const seen = new Set<number>();

    for (const record of traffic) {
      seen.add(record.id);
      const pos: L.LatLngTuple = [record.lat, record.lon];
      const tooltipText = `${record.altitudeFt} ft`;
      const existing = trafficRef.current.get(record.id);
      if (existing) {
        existing.setLatLng(pos);
        existing.setIcon(makeTrafficIcon(record.headingDeg, record.onGround));
        existing.setTooltipContent(tooltipText);
      } else {
        const marker = L.marker(pos, { icon: makeTrafficIcon(record.headingDeg, record.onGround), zIndexOffset: 0 })
          .bindTooltip(tooltipText, { direction: 'top', offset: [0, -8] })
          .addTo(map);
        trafficRef.current.set(record.id, marker);
      }
    }

    for (const [id, marker] of trafficRef.current) {
      if (!seen.has(id)) {
        map.removeLayer(marker);
        trafficRef.current.delete(id);
      }
    }
  }, [status, map]);

  // Leave no traffic layers behind on unmount.
  useEffect(() => {
    const traffic = trafficRef.current;
    return () => {
      for (const marker of traffic.values()) map.removeLayer(marker);
      traffic.clear();
    };
  }, [map]);

  return null;
}

export interface LiveMapProps {
  /** Latest polled status. With no `frame` the map renders nothing. */
  status: Status;
  /** CSS height of the map. Default `'24rem'`. */
  height?: string;
  /** Extra overlay layers (navdata, ...), rendered inside the map. */
  children?: ReactNode;
}

/**
 * The live aircraft: marker follows `status.frame` (the map pans with it),
 * the recorded track of `status.currentFlightId` is drawn behind it, and AI
 * traffic is shown as smaller markers.
 */
export function LiveMap({ status, height, children }: LiveMapProps) {
  const frame = status.frame;
  if (!frame) return null;

  return (
    <CarbonMap center={[frame.lat, frame.lon]} height={height} data-testid="live-map">
      <LiveMapController status={status} />
      {children}
    </CarbonMap>
  );
}
