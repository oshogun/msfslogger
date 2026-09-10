import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { LivePanel } from '../components/LivePanel';
import { StatsGrid } from '../components/StatsGrid';
import { apiFetch } from '../utils/api';
import { formatDate, formatDuration, formatDistance } from '../utils/format';
import type { Flight, Trip, Status } from '../types';

interface Props {
  status: Status | null;
}

const RECENT_FLIGHTS_LIMIT = 5;

export function Home({ status }: Props) {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadFlights = useCallback(async () => {
    const [flightsResult, tripsResult] = await Promise.allSettled([
      apiFetch<Flight[]>('/api/flights'),
      apiFetch<Trip[]>('/api/trips'),
    ]);

    if (flightsResult.status === 'rejected') {
      setError((flightsResult.reason as Error).message);
      return;
    }

    setFlights(flightsResult.value);
    setTrips(tripsResult.status === 'fulfilled' ? tripsResult.value : []);
    setError(null);
  }, []);

  useEffect(() => {
    loadFlights();
    const interval = setInterval(loadFlights, 10000);
    const onVisible = () => { if (!document.hidden) loadFlights(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadFlights]);

  const totalDurationSec = flights.reduce((sum, f) => sum + (f.duration_sec ?? 0), 0);
  const totalDistanceNm = flights.reduce((sum, f) => sum + (f.distance_nm ?? 0), 0);

  const recentFlights = [...flights]
    .filter(f => f.start_time)
    .sort((a, b) => (b.start_time! < a.start_time! ? -1 : b.start_time! > a.start_time! ? 1 : 0))
    .slice(0, RECENT_FLIGHTS_LIMIT);

  return (
    <>
      {status?.flightState === 'FLYING' && status.frame && <LivePanel status={status} />}

      <main className="container">
        <div className="flights-header"><h2>Flight Log</h2></div>

        {error && <p style={{ color: '#f87171', padding: '1rem' }}>{error}</p>}

        {flights.length === 0 && !error ? (
          <div className="empty-state">
            <p style={{ fontSize: '2rem' }}>✈</p>
            <p>No flights recorded yet.</p>
            <p>Start MSFS 2024 and take off to begin logging.</p>
          </div>
        ) : (
          <div className="landing-view">
            <StatsGrid
              stats={[
                { label: 'Total Flights', value: flights.length },
                { label: 'Total Trips', value: trips.length },
                { label: 'Total Duration', value: formatDuration(totalDurationSec) },
                { label: 'Total Distance', value: formatDistance(totalDistanceNm), unit: 'nm' },
              ]}
            />

            <div className="landing-section">
              <div className="landing-section-title">Recent flights</div>
              <ul className="recent-flights-list">
                {recentFlights.map(f => (
                  <li key={f.id} className="recent-flight-row">
                    <Link to={`/flight/${f.id}`}>
                      <span className="recent-flight-route">
                        {f.aircraft || 'Unknown'}
                        {(f.departure_icao || f.arrival_icao) && (
                          <> — {f.departure_icao || '???'} → {f.arrival_icao || '???'}</>
                        )}
                      </span>
                      <span className="recent-flight-date">{formatDate(f.start_time)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <Link to="/flights" className="landing-all-flights-link">All flights →</Link>
          </div>
        )}
      </main>
    </>
  );
}
