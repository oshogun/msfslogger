import { useEffect, Fragment } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { Flight } from '../types';

const LEG_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#a78bfa', '#f87171'];

const mkIcon = (color: string) =>
  L.divIcon({
    className: '',
    iconAnchor: [6, 6],
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 4px #000"></div>`,
  });

function BoundsController({ flights }: { flights: Flight[] }) {
  const map = useMap();
  useEffect(() => {
    const allPoints = flights.flatMap(f => (f.points || []).map(p => [p.lat, p.lon] as [number, number]));
    if (allPoints.length === 0) return;
    map.fitBounds(L.latLngBounds(allPoints), { padding: [30, 30] });
  }, [map, flights]);
  return null;
}

interface Props {
  flights: Flight[];
}

export function TripMap({ flights }: Props) {
  const hasPoints = flights.some(f => f.points && f.points.length > 0);
  if (!hasPoints) {
    return <p style={{ padding: '2rem', color: '#4b5563' }}>No GPS points recorded for this trip.</p>;
  }

  const firstPoint = flights.find(f => f.points?.length)?.points?.[0];

  return (
    <MapContainer
      style={{ height: '420px' }}
      zoom={10}
      center={firstPoint ? [firstPoint.lat, firstPoint.lon] : [0, 0]}
      preferCanvas
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={18}
      />
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
      <BoundsController flights={flights} />
    </MapContainer>
  );
}
