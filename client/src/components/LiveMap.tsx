import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { Status } from '../types';

function makeAircraftIcon(headingDeg: number) {
  return L.divIcon({
    className: '',
    html: `<div style="transform:rotate(${headingDeg}deg);font-size:24px;line-height:1;filter:drop-shadow(0 1px 3px rgba(0,0,0,.8))">✈</div>`,
    iconAnchor: [12, 12],
  });
}

function LiveMapController({ status }: { status: Status }) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const trackRef = useRef<L.Polyline | null>(null);
  const lastFetchRef = useRef(0);
  const lastFlightIdRef = useRef<number | null>(null);

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
