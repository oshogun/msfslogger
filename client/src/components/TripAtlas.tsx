import { useState } from 'react';
import { Link } from 'react-router-dom';
import { JourneyMap, legColor } from './JourneyMap';
import { StatsGrid } from './StatsGrid';
import { formatDuration, formatDistance, formatAlt, formatSpeed } from '../utils/format';
import type { Journey } from '../types';

interface Props {
  journey: Journey;
}

export function TripAtlas({ journey }: Props) {
  const [highlightId, setHighlightId] = useState<number | null>(null);

  if (journey.legCount === 0) {
    return <p style={{ color: '#4b5563', padding: '2rem 0' }}>No flights in this trip yet.</p>;
  }

  const stats = [
    { label: 'Distance',  value: formatDistance(journey.totalDistanceNm), unit: 'nm' },
    { label: 'Air Time',  value: formatDuration(journey.totalDurationSec) },
    { label: 'Legs',      value: journey.legCount },
    { label: 'Airports',  value: journey.airports.length },
    { label: 'Aircraft',  value: journey.aircraftCount },
    { label: 'Ceiling',   value: formatAlt(journey.maxAltitudeFt),    unit: 'ft' },
    { label: 'Top Speed', value: formatSpeed(journey.maxAirspeedKts), unit: 'kts' },
    {
      label: 'Longest Leg',
      value: journey.longestLeg ? formatDistance(journey.longestLeg.distanceNm) : '—',
      unit: 'nm',
      sub: journey.longestLeg?.route ?? '',
    },
  ];

  return (
    <>
      <StatsGrid stats={stats} />

      {journey.countries.length > 0 && (
        <div className="atlas-section">
          <div className="section-title">
            {journey.countries.length === 1 ? 'Country' : `Countries — ${journey.countries.length}`}
          </div>
          <div className="atlas-countries">
            {journey.countries.map(c => (
              <div className="atlas-country" key={c.name}>
                <span className="atlas-flag">{c.flag}</span>
                <span>{c.name}</span>
                <span className="atlas-country-count">{c.airports}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Only worth calling out once there is actually a run to describe */}
      {journey.longestChain && journey.longestChain.length > 1 && (
        <div className="atlas-chain">
          <strong>{journey.longestChain.length} legs end to end</strong>
          {' — '}{journey.longestChain.from} → {journey.longestChain.to}
          {journey.chainBreaks === 0
            ? ', every landing the next departure.'
            : ` (${journey.chainBreaks} break${journey.chainBreaks === 1 ? '' : 's'} elsewhere).`}
        </div>
      )}

      <div className="map-section">
        <div className="section-title">Every Leg</div>
        <div id="atlas-map">
          <JourneyMap
            legs={journey.legs}
            airports={journey.airports}
            highlightId={highlightId}
            onHighlight={setHighlightId}
          />
        </div>
      </div>

      <div className="atlas-section">
        <div className="section-title">Route</div>
        <div className="atlas-route">
          {journey.legs.map(leg => (
            <Link
              to={`/flight/${leg.id}`}
              key={leg.id}
              className={`atlas-hop${highlightId === leg.id ? ' is-active' : ''}`}
              onMouseEnter={() => setHighlightId(leg.id)}
              onMouseLeave={() => setHighlightId(null)}
              title={`Leg ${leg.seq} · ${leg.aircraft ?? 'Unknown'} · ${formatDistance(leg.distanceNm)} nm`}
            >
              <span className="atlas-hop-dot" style={{ background: legColor(leg.seq, journey.legs.length) }} />
              {leg.departureIcao ?? '????'} <span className="atlas-hop-arrow">→</span> {leg.arrivalIcao ?? '????'}
            </Link>
          ))}
        </div>
      </div>

      {journey.aircraft.length > 1 && (
        <div className="atlas-section">
          <div className="section-title">Aircraft</div>
          <div className="atlas-fleet">
            {journey.aircraft.map(a => (
              <div className="atlas-plane" key={a.name}>
                <div className="atlas-plane-name">{a.name}</div>
                <div className="atlas-plane-stats">
                  {a.legs} leg{a.legs === 1 ? '' : 's'} · {formatDistance(a.distanceNm)} nm
                </div>
                <div className="atlas-plane-bar">
                  <div
                    className="atlas-plane-bar-fill"
                    style={{ width: `${(a.distanceNm / journey.totalDistanceNm) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
