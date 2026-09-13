import { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { JourneyLeg, JourneyAirport } from '../types';
import { unwrapLonChains } from '../utils/geo';

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

// Legs are drawn as one Polyline each but represent a single ordered journey:
// unwrapping every leg's track independently — anchored to its own first
// point — lets leg N+1 land 360° from where leg N ended whenever there's an
// odd number of antimeridian crossings between them. Threading continuity
// across the whole seq-ordered sequence (unwrapLonChains) fixes that; see
// utils/geo.ts and the same fix in TripMap.tsx.
function sortedLegs(legs: JourneyLeg[]): JourneyLeg[] {
  return legs.slice().sort((a, b) => a.seq - b.seq);
}

function legTrackChains(legs: JourneyLeg[]): [number, number][][] {
  return unwrapLonChains(sortedLegs(legs).map(l => l.track as [number, number][]));
}

// Airport markers need the same unwrapped reference frame as the leg
// polylines above them, or an airport near the antimeridian renders at its
// raw longitude — detached from the unwrapped track approaching it. `ordered`
// and `trackChains` are already aligned by index (both derived from the same
// seq-sorted legs), so each leg's chain endpoints give an unwrapped position
// for its departure/arrival ICAO. An airport visited more than once keeps the
// position from its first occurrence, matching the server's own tie-break for
// a repeatedly-visited airport.
export function airportPositions(
  ordered: JourneyLeg[],
  trackChains: [number, number][][]
): Map<string, [number, number]> {
  const positions = new Map<string, [number, number]>();
  ordered.forEach((leg, i) => {
    const chain = trackChains[i];
    if (chain.length === 0) return;
    if (leg.departureIcao !== null && !positions.has(leg.departureIcao)) {
      positions.set(leg.departureIcao, chain[0]);
    }
    if (leg.arrivalIcao !== null && !positions.has(leg.arrivalIcao)) {
      positions.set(leg.arrivalIcao, chain[chain.length - 1]);
    }
  });
  return positions;
}

function FitAll({ legs }: { legs: JourneyLeg[] }) {
  const map = useMap();
  useEffect(() => {
    const all = legTrackChains(legs).flat();
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

  const ordered = sortedLegs(legs);
  const trackChains = legTrackChains(legs);
  const unwrappedAirportPositions = airportPositions(ordered, trackChains);

  return (
    <MapContainer style={{ height: '100%' }} zoom={4} center={ordered[0].track[0] ?? [0, 0]} preferCanvas>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={18}
      />

      {ordered.map((leg, legIdx) => {
        const dimmed = highlightId !== null && highlightId !== leg.id;
        const track = trackChains[legIdx];
        return (
          <Polyline
            key={leg.id}
            positions={track}
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
          center={unwrappedAirportPositions.get(a.icao) ?? [a.lat, a.lon]}
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
