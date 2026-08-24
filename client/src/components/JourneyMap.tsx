import { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { JourneyLeg, JourneyAirport } from '../types';

/**
 * Legs are tinted along a hue ramp from the first flight to the most recent, so
 * the direction of travel reads at a glance on a map with no time axis.
 */
export function legColor(seq: number, total: number): string {
  if (total <= 1) return 'hsl(210 90% 62%)';
  const t = (seq - 1) / (total - 1);
  const hue = 210 - t * 190;          // blue -> cyan -> green -> amber
  return `hsl(${hue.toFixed(0)} 85% 60%)`;
}

function FitAll({ legs }: { legs: JourneyLeg[] }) {
  const map = useMap();
  useEffect(() => {
    const all = legs.flatMap(l => l.track);
    if (all.length === 0) return;
    map.fitBounds(L.latLngBounds(all as [number, number][]), { padding: [28, 28] });
  }, [map, legs]);
  return null;
}

interface Props {
  legs: JourneyLeg[];
  airports: JourneyAirport[];
  highlightId: number | null;
  onHighlight: (id: number | null) => void;
}

export function JourneyMap({ legs, airports, highlightId, onHighlight }: Props) {
  if (legs.length === 0) {
    return <p style={{ padding: '2rem', color: '#4b5563' }}>No flights recorded yet.</p>;
  }

  return (
    <MapContainer style={{ height: '100%' }} zoom={4} center={legs[0].track[0] ?? [0, 0]} preferCanvas>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={18}
      />

      {legs.map(leg => {
        const dimmed = highlightId !== null && highlightId !== leg.id;
        return (
          <Polyline
            key={leg.id}
            positions={leg.track}
            pathOptions={{
              color: legColor(leg.seq, legs.length),
              weight: highlightId === leg.id ? 4.5 : 2.2,
              opacity: dimmed ? 0.18 : 0.9,
            }}
            eventHandlers={{
              mouseover: () => onHighlight(leg.id),
              mouseout: () => onHighlight(null),
            }}
          >
            <Tooltip sticky>
              {`Leg ${leg.seq}: ${leg.departureIcao ?? '????'} → ${leg.arrivalIcao ?? '????'}`}
              {leg.aircraft ? ` · ${leg.aircraft}` : ''}
            </Tooltip>
          </Polyline>
        );
      })}

      {airports.map(a => (
        <CircleMarker
          key={a.icao}
          center={[a.lat, a.lon]}
          radius={a.visits > 1 ? 5 : 3.5}
          pathOptions={{ color: '#e2e8f0', weight: 1.5, fillColor: '#0f1117', fillOpacity: 1 }}
        >
          <Tooltip>
            <strong>{a.icao}</strong>{a.name ? ` — ${a.name}` : ''}
            {a.visits > 1 ? ` (${a.visits} visits)` : ''}
          </Tooltip>
        </CircleMarker>
      ))}

      <FitAll legs={legs} />
    </MapContainer>
  );
}
