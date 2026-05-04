import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LivePanel } from '../components/LivePanel';
import { apiFetch } from '../utils/api';
import { formatDate, formatDuration, formatDistance, formatAlt, formatSpeed } from '../utils/format';
import type { Flight, Trip, Status } from '../types';

interface Props {
  status: Status | null;
}

export function Home({ status }: Props) {
  const navigate = useNavigate();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [collapsedTrips, setCollapsedTrips] = useState<Set<number>>(new Set());
  const [showTripPicker, setShowTripPicker] = useState(false);
  const [pickerTripId, setPickerTripId] = useState<number | ''>('');
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

    const newFlights = flightsResult.value;
    const newTrips = tripsResult.status === 'fulfilled' ? tripsResult.value : [];
    setFlights(newFlights);
    setTrips(newTrips);
    setError(null);

    // Prune stale selections
    const ids = new Set(newFlights.map(f => f.id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const id of next) if (!ids.has(id)) next.delete(id);
      return next;
    });
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

  function toggleCheck(id: number, combinable: boolean, checked: boolean) {
    if (!combinable) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    if (checked) {
      const combinable = flights.filter(f => f.point_count === null || f.point_count > 0).map(f => f.id);
      setSelectedIds(new Set(combinable));
    } else {
      setSelectedIds(new Set());
    }
  }

  function toggleTrip(tripId: number) {
    setCollapsedTrips(prev => {
      const next = new Set(prev);
      next.has(tripId) ? next.delete(tripId) : next.add(tripId);
      return next;
    });
  }

  async function handleCombine() {
    const [id1, id2] = [...selectedIds];
    if (!confirm(`Combine flights #${id1} and #${id2} into one? Both originals will be deleted.`)) return;
    try {
      const result = await apiFetch<{ id: number }>('/api/flights/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id1, id2 }),
      });
      setSelectedIds(new Set());
      navigate(`/flight/${result.id}`);
    } catch (err) {
      alert('Combine failed: ' + (err as Error).message);
    }
  }

  async function handleNewTrip() {
    const name = prompt('Trip name:');
    if (!name?.trim()) return;
    try {
      const { id: tripId } = await apiFetch<{ id: number }>('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      for (const flightId of selectedIds) {
        await apiFetch(`/api/trips/${tripId}/flights`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flightId }),
        });
      }
      setSelectedIds(new Set());
      await loadFlights();
    } catch (err) {
      alert('Failed to create trip: ' + (err as Error).message);
    }
  }

  async function handleAddToTrip() {
    const tripId = Number(pickerTripId);
    if (!tripId) return;
    try {
      for (const flightId of selectedIds) {
        await apiFetch(`/api/trips/${tripId}/flights`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flightId }),
        });
      }
      setSelectedIds(new Set());
      setShowTripPicker(false);
      await loadFlights();
    } catch (err) {
      alert('Failed to add to trip: ' + (err as Error).message);
    }
  }

  const n = selectedIds.size;
  const [selA, selB] = [...selectedIds];

  // Build grouped flight map
  const tripFlightIds = new Set(trips.flatMap(t => t.flights.map(f => f.id)));
  const flightById = new Map(flights.map(f => [f.id, f]));
  const ungrouped = flights.filter(f => !tripFlightIds.has(f.id));

  function flightRow(f: Flight, legIndex?: number) {
    const combinable = f.point_count === null || f.point_count > 0;
    const checked = selectedIds.has(f.id) && combinable;
    const color = legIndex !== undefined ? ['#60a5fa', '#34d399', '#f59e0b', '#a78bfa', '#f87171'][legIndex % 5] : undefined;

    return (
      <tr key={f.id} data-id={f.id}>
        <td className="td-check">
          <input
            type="checkbox"
            className="row-check"
            checked={checked}
            disabled={!combinable}
            title={combinable ? undefined : 'No recorded points'}
            onChange={e => toggleCheck(f.id, combinable, e.target.checked)}
          />
        </td>
        <td className="td-aircraft" data-label="Aircraft">
          {color && <span className="leg-color-swatch" style={{ background: color }}></span>}
          {f.aircraft || 'Unknown'}
          {(f.departure_icao || f.arrival_icao) && (
            <div className="td-route" title={`${f.departure_name || ''} → ${f.arrival_name || ''}`}>
              {f.departure_icao || '???'} → {f.arrival_icao || '???'}
            </div>
          )}
        </td>
        <td className="td-date" data-label="Date">{formatDate(f.start_time)}</td>
        <td className="td-stat" data-label="Duration">{formatDuration(f.duration_sec)}</td>
        <td className="td-stat" data-label="Distance">{formatDistance(f.distance_nm)} nm</td>
        <td className="td-stat" data-label="Max Alt">{formatAlt(f.max_altitude_ft)} ft</td>
        <td className="td-stat" data-label="Max Speed">{formatSpeed(f.max_airspeed_kts)} kts</td>
        <td className="td-actions" data-label="">
          <Link to={`/flight/${f.id}`} className="btn btn-primary">View</Link>
        </td>
      </tr>
    );
  }

  return (
    <>
      {status?.flightState === 'FLYING' && status.frame && <LivePanel status={status} />}

      <main className="container">
        <div className="flights-header"><h2>Flight Log</h2></div>

        {n > 0 && (
          <div className="combine-toolbar">
            <span id="combine-info">
              {n === 1 ? '1 flight selected' : n === 2 ? `Flights #${selA} and #${selB} selected` : `${n} flights selected`}
            </span>
            <button className="btn btn-ghost" onClick={handleNewTrip}>New Trip</button>
            {trips.length > 0 && (
              <button className="btn btn-ghost" onClick={() => {
                setShowTripPicker(p => !p);
                if (!pickerTripId && trips[0]) setPickerTripId(trips[0].id);
              }}>Add to Trip</button>
            )}
            {showTripPicker && (
              <>
                <select
                  value={pickerTripId}
                  onChange={e => setPickerTripId(Number(e.target.value))}
                  style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', borderRadius: '6px', padding: '0.3rem 0.5rem', fontSize: '0.82rem' }}
                >
                  {trips.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <button className="btn btn-primary" style={{ fontSize: '0.8rem' }} onClick={handleAddToTrip}>Add</button>
              </>
            )}
            <button className="btn btn-primary" disabled={n !== 2} onClick={handleCombine}>Combine Selected</button>
          </div>
        )}

        {error && <p style={{ color: '#f87171', padding: '1rem' }}>{error}</p>}

        {flights.length === 0 && !error ? (
          <div className="empty-state">
            <p style={{ fontSize: '2rem' }}>✈</p>
            <p>No flights recorded yet.</p>
            <p>Start MSFS 2024 and take off to begin logging.</p>
          </div>
        ) : (
          <table id="flights-table">
            <thead>
              <tr>
                <th className="th-check">
                  <input
                    type="checkbox"
                    title="Select all completed flights"
                    checked={n > 0 && n === flights.filter(f => f.point_count === null || f.point_count > 0).length}
                    onChange={e => toggleSelectAll(e.target.checked)}
                  />
                </th>
                <th>Aircraft</th>
                <th>Date</th>
                <th>Duration</th>
                <th>Distance</th>
                <th>Max Alt</th>
                <th>Max Speed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {trips.map(trip => {
                const legs = trip.flights.map(f => flightById.get(f.id)).filter((f): f is Flight => !!f);
                const collapsed = collapsedTrips.has(trip.id);
                return (
                  <>
                    <tr key={`trip-${trip.id}`} className="tr-trip-header" onClick={() => toggleTrip(trip.id)}>
                      <td colSpan={8}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <div className="trip-row-name">🚗 {trip.name}</div>
                            <div className="trip-row-stats">
                              {trip.flight_count} leg{trip.flight_count !== 1 ? 's' : ''} · {formatDuration(trip.total_duration_sec)} · {formatDistance(trip.total_distance_nm)} nm
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <Link to={`/trip/${trip.id}`} className="btn btn-ghost" style={{ fontSize: '0.8rem' }} onClick={e => e.stopPropagation()}>View Trip</Link>
                          </div>
                        </div>
                      </td>
                    </tr>
                    {!collapsed && legs.map((f, i) => flightRow(f, i))}
                  </>
                );
              })}

              {ungrouped.length > 0 && trips.length > 0 && (
                <tr className="tr-ungrouped-header">
                  <td colSpan={8}>Ungrouped Flights</td>
                </tr>
              )}
              {ungrouped.map(f => flightRow(f))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
