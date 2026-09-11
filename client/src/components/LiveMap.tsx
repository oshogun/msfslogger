import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { Status, TrafficObject } from '../types';

// The ✈ glyph itself points east (90°), not north, so headings must be
// corrected by that offset before being applied as a CSS rotation.
function makeAircraftIcon(headingDeg: number) {
  return L.divIcon({
    className: '',
    html: `<div style="transform:rotate(${headingDeg - 90}deg);font-size:24px;line-height:1;filter:drop-shadow(0 1px 3px rgba(0,0,0,.8))">✈</div>`,
    iconAnchor: [12, 12],
  });
}

// AI traffic icon, distinct from the user's own: smaller, coloured by
// onGround, translucent, no drop-shadow depth cue, and no zIndexOffset — the
// user's own aircraft always renders on top of these.
function makeTrafficIcon(headingDeg: number, onGround: boolean) {
  const color = onGround ? '#9ca3af' : '#fbbf24';
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
      fetch(`/api/flights/${currentFlightId}`)
        .then(r => r.json())
        .then((flight: { points?: Array<{ lat: number; lon: number }> }) => {
          if (!flight.points?.length) return;
          const latlngs: L.LatLngTuple[] = flight.points.map(p => [p.lat, p.lon]);
          if (trackRef.current) {
            trackRef.current.setLatLngs(latlngs);
          } else {
            trackRef.current = L.polyline(latlngs, { color: '#60a5fa', weight: 2.5, opacity: 0.8 }).addTo(map);
          }
        })
        .catch(() => {});
    }

    map.invalidateSize();
  });

  // AI traffic: a separate effect keyed on [status], deliberately independent
  // of the own-aircraft guards above so a null-island or missing-frame case
  // never blocks traffic from rendering. Markers are moved, never recreated,
  // while an id persists; an id absent from the latest batch is removed, not
  // merely hidden. Never calls setView/panTo/flyTo/fitBounds/setZoom/
  // invalidateSize — the viewport is owned exclusively by the effect above.
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

  // Unmount cleanup: leave no traffic layers behind when navigating away.
  useEffect(() => {
    return () => {
      for (const marker of trafficRef.current.values()) {
        map.removeLayer(marker);
      }
      trafficRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

interface Props {
  status: Status;
}

export function LiveMap({ status }: Props) {
  const frame = status.frame;
  if (!frame) return null;

  return (
    <div id="live-map">
      <MapContainer
        style={{ height: '100%', width: '100%' }}
        zoom={10}
        center={[frame.lat, frame.lon]}
        preferCanvas
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={18}
        />
        <LiveMapController status={status} />
      </MapContainer>
    </div>
  );
}
