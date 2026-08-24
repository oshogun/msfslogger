import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { JourneyMap, legColor } from '../components/JourneyMap';
import { StatsGrid } from '../components/StatsGrid';
import { apiFetch } from '../utils/api';
import { formatDuration, formatDistance, formatAlt, formatSpeed, formatDate } from '../utils/format';
import type { Journey } from '../types';

export function Atlas() {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);

  useEffect(() => {
    document.title = 'Atlas — msfslogger';
    apiFetch<Journey>('/api/journey')
      .then(setJourney)
      .catch(err => setError((err as Error).message));
  }, []);

  if (error) {
    return <main className="container"><p style={{ color: '#f87171' }}>Failed to load atlas: {error}</p></main>;
  }
  if (!journey) {
    return <main className="container"><p style={{ color: '#4b5563' }}>Loading...</p></main>;
  }
  if (journey.legCount === 0) {
    return (
      <main className="container">
        <div className="empty-state">
          <h2>No flights yet</h2>
          <p>Fly somewhere and your atlas will start filling in.</p>
        </div>
      </main>
    );
  }

  const stats = [
    { label: 'Distance',   value: formatDistance(journey.totalDistanceNm), unit: 'nm' },
    { label: 'Air Time',   value: formatDuration(journey.totalDurationSec) },
    { label: 'Legs',       value: journey.legCount },
    { label: 'Airports',   value: journey.airports.length },
    { label: 'Aircraft',   value: journey.aircraftCount },
    { label: 'Ceiling',    value: formatAlt(journey.maxAltitudeFt),   unit: 'ft' },
    { label: 'Top Speed',  value: formatSpeed(journey.maxAirspeedKts), unit: 'kts' },
    {
      label: 'Longest Leg',
      value: journey.longestLeg ? formatDistance(journey.longestLeg.distanceNm) : '—',
      unit: 'nm',
      sub: journey.longestLeg?.route ?? '',
    },
  ];

  const pct = journey.aroundTheWorldPct;

  return (
    <main className="container" id="atlas">
      <h2 className="flight-title">Atlas</h2>
      <p className="flight-subtitle">
        {journey.firstFlight ? formatDate(journey.firstFlight) : ''}
        {journey.lastFlight ? ` → ${formatDate(journey.lastFlight)}` : ''}
      </p>

      <StatsGrid stats={stats} />

      {/* Distance flown, measured against a lap of the equator */}
      <div className="atlas-globe">
        <div className="atlas-globe-head">
          <span className="section-title" style={{ margin: 0 }}>Around the World</span>
          <span className="atlas-globe-pct">{pct}%</span>
        </div>
        <div className="atlas-bar">
          <div className="atlas-bar-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <div className="atlas-globe-foot">
          {formatDistance(journey.totalDistanceNm)} nm of the 21,639 nm equator
          {pct < 100 && ` · ${formatDistance(21639 - journey.totalDistanceNm)} nm to go`}
        </div>
      </div>

      {journey.countries.length > 0 && (
        <div className="atlas-section">
          <div className="section-title">Countries — {journey.countries.length}</div>
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
        <div className="section-title">Every Flight</div>
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
    </main>
  );
}
