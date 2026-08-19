import { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { MapReadySignal } from './MapReadySignal';
import type { FlightPoint } from '../types';

const mkIcon = (color: string) =>
  L.divIcon({
    className: '',
    iconAnchor: [6, 6],
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 4px #000"></div>`,
  });

function BoundsController({ latlngs }: { latlngs: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (latlngs.length === 0) return;
    map.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30] });
  }, [map, latlngs]);
  return null;
}

interface Props {
  points: FlightPoint[];
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

export function FlightMap({ points, onReady, preferCanvas = true, zoomControl = true }: Props) {
  if (points.length === 0) {
    return <p style={{ padding: '2rem', color: '#4b5563' }}>No GPS points recorded.</p>;
  }

  const latlngs: [number, number][] = points.map(p => [p.lat, p.lon]);

  return (
    <MapContainer
      style={{ height: '100%' }}
      zoom={10}
      center={latlngs[0]}
      preferCanvas={preferCanvas}
      zoomControl={zoomControl}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={18}
      />
      <Polyline positions={latlngs} pathOptions={{ color: '#60a5fa', weight: 2.5, opacity: 0.9 }} />
      <Marker position={latlngs[0]} icon={mkIcon('#34d399')}>
        <Tooltip>Departure</Tooltip>
      </Marker>
      <Marker position={latlngs[latlngs.length - 1]} icon={mkIcon('#f87171')}>
        <Tooltip>Arrival</Tooltip>
      </Marker>
      <BoundsController latlngs={latlngs} />
      <MapReadySignal onReady={onReady} />
    </MapContainer>
  );
}
