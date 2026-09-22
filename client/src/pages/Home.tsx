import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { LivePanel } from '../components/LivePanel';
import { StatsGrid } from '../components/StatsGrid';
import { apiFetch } from '../utils/api';
import { formatDate, formatDuration, formatDistance } from '../utils/format';
import type {
  CreateGroundSessionRequest,
  CurrentGroundSessionResponse,
  Flight,
  GroundSession,
  PlannedLegListItem,
  PlannedLegWithChildren,
  Status,
  Trip,
} from '../types';

interface Props {
  status: Status | null;
}

const RECENT_FLIGHTS_LIMIT = 5;
const GROUND_SECTION_COLLAPSED_KEY = 'msfslogger.groundSectionCollapsed';

/** What the ground card renders, normalised from either the live status poll or the fallback read below. */
interface GroundCardView {
  source: 'auto' | 'manual';
  airportIcao: string | null;
  airportName: string | null;
  parkingPosition: string | null;
  plannedLegId: number | null;
  departureIdent: string | null;
  destinationIdent: string | null;
  startedAt: string;
}

export function Home({ status }: Props) {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [error, setError] = useState<string | null>(null);

  // The ground session read from GET /api/ground-sessions/current — used
  // only when status.groundSession isn't present (that live half comes from
  // the poll already wired into `status` above).
  const [currentGroundSession, setCurrentGroundSession] = useState<GroundSession | null>(null);
  const [groundError, setGroundError] = useState<string | null>(null);

  // The linked leg's route isn't carried on the plain GroundSession row (only
  // its id is), so it's looked up once here for display — the live status
  // path already carries departureIdent/destinationIdent and skips this.
  const [groundLegDetail, setGroundLegDetail] = useState<PlannedLegWithChildren | null>(null);

  // Every unflown planned leg — loose or trip-linked — for the manual form's
  // optional leg picker.
  const [plannedLegOptions, setPlannedLegOptions] = useState<PlannedLegListItem[] | null>(null);
  const [plannedLegOptionsError, setPlannedLegOptionsError] = useState('');

  const [manualIcao, setManualIcao] = useState('');
  const [manualStand, setManualStand] = useState('');
  const [manualLegId, setManualLegId] = useState<number | ''>('');
  // Whether the operator actually edited the stand / leg fields this time
  // round, as opposed to leaving them at their blank/default value. A field
  // never touched is omitted from the POST body entirely, so a refinement
  // over an open session can't clear an already-resolved value just because
  // its box was left blank.
  const [manualStandTouched, setManualStandTouched] = useState(false);
  const [manualLegTouched, setManualLegTouched] = useState(false);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualError, setManualError] = useState('');

  // Collapsed by default only if the operator collapsed it in a previous
  // visit — persisted so the choice survives reloads.
  const [groundSectionCollapsed, setGroundSectionCollapsed] = useState(
    () => localStorage.getItem(GROUND_SECTION_COLLAPSED_KEY) === 'true',
  );
  useEffect(() => {
    localStorage.setItem(GROUND_SECTION_COLLAPSED_KEY, String(groundSectionCollapsed));
  }, [groundSectionCollapsed]);

  const loadFlights = useCallback(async () => {
    const [flightsResult, tripsResult, groundResult] = await Promise.allSettled([
      apiFetch<Flight[]>('/api/flights'),
      apiFetch<Trip[]>('/api/trips'),
      apiFetch<CurrentGroundSessionResponse>('/api/ground-sessions/current'),
    ]);

    if (flightsResult.status === 'rejected') {
      setError((flightsResult.reason as Error).message);
      return;
    }

    setFlights(flightsResult.value);
    setTrips(tripsResult.status === 'fulfilled' ? tripsResult.value : []);
    // A failed ground fetch never blocks the flight log from rendering — it
    // sets its own message and leaves the rest of the page alone.
    if (groundResult.status === 'fulfilled') {
      setCurrentGroundSession(groundResult.value.session);
      setGroundError(null);
    } else {
      setGroundError((groundResult.reason as Error).message);
    }
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const allLegs = await apiFetch<PlannedLegListItem[]>('/api/planned-legs');
        if (!cancelled) setPlannedLegOptions(allLegs.filter(l => l.linked_flight_id === null));
      } catch (err) {
        if (!cancelled) setPlannedLegOptionsError((err as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Only needed for the "otherwise" precedence branch: while a live
  // status.groundSession is present it already carries the route idents.
  const fallbackLegId = !status?.groundSession ? currentGroundSession?.planned_leg_id ?? null : null;
  useEffect(() => {
    if (fallbackLegId == null) { setGroundLegDetail(null); return; }
    let cancelled = false;
    apiFetch<PlannedLegWithChildren>(`/api/planned-legs/${fallbackLegId}`)
      .then(leg => { if (!cancelled) setGroundLegDetail(leg); })
      .catch(() => { if (!cancelled) setGroundLegDetail(null); });
    return () => { cancelled = true; };
  }, [fallbackLegId]);

  // status.groundSession (the live one) when present, otherwise the row read
  // from GET /api/ground-sessions/current. Both describe the same row when
  // both exist, so there is nothing to reconcile — only which is read.
  const groundCard: GroundCardView | null = status?.groundSession
    ? {
        source: status.groundSession.source,
        airportIcao: status.groundSession.airportIcao,
        airportName: status.groundSession.airportName,
        parkingPosition: status.groundSession.parkingPosition,
        plannedLegId: status.groundSession.plannedLegId,
        departureIdent: status.groundSession.departureIdent,
        destinationIdent: status.groundSession.destinationIdent,
        startedAt: status.groundSession.startedAt,
      }
    : currentGroundSession
      ? {
          source: currentGroundSession.source,
          airportIcao: currentGroundSession.airport_icao,
          airportName: currentGroundSession.airport_name,
          parkingPosition: currentGroundSession.parking_position,
          plannedLegId: currentGroundSession.planned_leg_id,
          departureIdent: groundLegDetail?.departure_ident ?? null,
          destinationIdent: groundLegDetail?.destination_ident ?? null,
          startedAt: currentGroundSession.started_at,
        }
      : null;

  async function handleManualEntry(e: React.FormEvent) {
    e.preventDefault();
    const icao = manualIcao.trim();
    if (!icao) { setManualError('ICAO is required'); return; }
    setManualSubmitting(true);
    setManualError('');
    try {
      const body: CreateGroundSessionRequest = { icao: icao.toUpperCase() };
      // Only a field the operator actually touched this submission is sent —
      // an untouched, still-blank box must not overwrite a value detection
      // already resolved.
      if (manualStandTouched) body.parking_position = manualStand.trim() || null;
      if (manualLegTouched) body.planned_leg_id = manualLegId === '' ? null : manualLegId;
      await apiFetch<GroundSession>('/api/ground-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setManualIcao('');
      setManualStand('');
      setManualLegId('');
      setManualStandTouched(false);
      setManualLegTouched(false);
      // Re-fetch so the card reflects the session just created or corrected.
      await loadFlights();
    } catch (err) {
      setManualError((err as Error).message);
    } finally {
      setManualSubmitting(false);
    }
  }

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
        <div className="landing-section ground-session-section">
          <div className="landing-section-title ground-section-header">
            <span>Ground position</span>
            <button
              type="button"
              className="ground-section-toggle"
              aria-expanded={!groundSectionCollapsed}
              onClick={() => setGroundSectionCollapsed(v => !v)}
            >
              {groundSectionCollapsed ? 'Show' : 'Hide'}
            </button>
          </div>
          {!groundSectionCollapsed && (
            <>
              {groundError && <p className="edit-error">{groundError}</p>}
              {groundCard ? (
                <div className="ground-session-card">
                  <span className={`badge ${groundCard.source === 'auto' ? 'badge-planned' : 'badge-skipped'}`}>
                    {groundCard.source === 'auto' ? 'Detected' : 'Manual entry'}
                  </span>
                  <span className="ground-session-airport">
                    {groundCard.airportIcao
                      ? `${groundCard.airportIcao} — ${groundCard.airportName || 'Unknown airport'}`
                      : 'Airport not resolved'}
                  </span>
                  <span className="ground-session-stand">{groundCard.parkingPosition || 'Stand not set'}</span>
                  {groundCard.plannedLegId != null && (
                    <Link to={`/planned-leg/${groundCard.plannedLegId}/acars`}>
                      {groundCard.departureIdent && groundCard.destinationIdent
                        ? `${groundCard.departureIdent} → ${groundCard.destinationIdent}`
                        : `Planned leg #${groundCard.plannedLegId}`}
                    </Link>
                  )}
                  <span className="ground-session-started">Since {formatDate(groundCard.startedAt)}</span>
                </div>
              ) : (
                <p className="flight-plan-status">Not on the ground.</p>
              )}

              <form className="ground-manual-form edit-form" onSubmit={handleManualEntry}>
                <div className="section-title">Manual entry (fallback)</div>
                <p className="flight-plan-status">
                  Sabiá detects your airport and stand automatically. Use this only when detection could not resolve your position.
                </p>
                <div className="edit-field">
                  <label htmlFor="ground-manual-icao">ICAO</label>
                  <input
                    id="ground-manual-icao"
                    type="text"
                    maxLength={4}
                    placeholder="ICAO"
                    value={manualIcao}
                    disabled={manualSubmitting}
                    onChange={e => setManualIcao(e.target.value)}
                  />
                </div>
                <div className="edit-field">
                  <label htmlFor="ground-manual-stand">Ramp / gate</label>
                  <input
                    id="ground-manual-stand"
                    type="text"
                    maxLength={120}
                    placeholder="Stand, gate or ramp"
                    value={manualStand}
                    disabled={manualSubmitting}
                    onChange={e => { setManualStand(e.target.value); setManualStandTouched(true); }}
                  />
                </div>
                <div className="edit-field">
                  <label htmlFor="ground-manual-leg">Planned leg</label>
                  <select
                    id="ground-manual-leg"
                    value={manualLegId}
                    disabled={manualSubmitting}
                    onChange={e => { setManualLegId(e.target.value === '' ? '' : Number(e.target.value)); setManualLegTouched(true); }}
                  >
                    <option value="">None</option>
                    {plannedLegOptions?.map(leg => (
                      <option key={leg.id} value={leg.id}>
                        {leg.trip_name ?? 'No trip'} · {leg.departure_ident} → {leg.destination_ident}
                      </option>
                    ))}
                  </select>
                  {plannedLegOptionsError && <span className="edit-error">{plannedLegOptionsError}</span>}
                </div>
                <div className="edit-actions">
                  <button type="submit" className="btn btn-primary" disabled={manualSubmitting || !manualIcao.trim()}>
                    {manualSubmitting ? 'Setting…' : 'Set ground position'}
                  </button>
                  {manualError && <span className="edit-error">{manualError}</span>}
                </div>
              </form>
            </>
          )}
        </div>

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
