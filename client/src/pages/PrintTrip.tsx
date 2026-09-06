import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { TripMap } from '../components/TripMap';
import { FlightMap } from '../components/FlightMap';
import { AltitudeChart } from '../components/AltitudeChart';
import { StatsGrid } from '../components/StatsGrid';
import { apiFetch } from '../utils/api';
import { useExportReady } from '../utils/exportReady';
import { strideSample, lttb, MAP_MAX_POINTS, CHART_MAX_POINTS } from '../utils/downsample';
import { formatDateIn, formatDuration, formatDistance, formatAlt, formatSpeed, coordStr } from '../utils/format';
import { interleaveTripRows, plannedLegBadge } from '../components/PlannedLegRows';
import type { Trip } from '../types';
import '../print.css';

const LEG_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#a78bfa', '#f87171'];

/**
 * Print-only view of a trip: an overview page, then one detail page per leg.
 * Like PrintFlight, this renders no Header so the page can actually go idle.
 */
export function PrintTrip() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const locale = searchParams.get('locale') ?? undefined;
  const tz = searchParams.get('tz') ?? undefined;
  const fmtDate = (iso: string | null | undefined) => formatDateIn(iso, locale, tz);

  const [trip, setTrip] = useState<Trip | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Trip>(`/api/trips/${id}`)
      .then(setTrip)
      .catch(err => {
        setLoadError((err as Error).message);
        // Let the export fail fast with a real message instead of timing out
        window.__EXPORT_ERROR__ = `Failed to load trip ${id}: ${(err as Error).message}`;
      });
  }, [id]);

  const flights = trip?.flights ?? [];
  const plannedLegs = trip?.planned_legs ?? [];
  const legsWithPoints = flights.filter(f => (f.points?.length ?? 0) > 0);
  const hasPlannedWaypoints = plannedLegs.some(l => l.waypoints.length > 0);
  // The overview map renders whenever TripMap itself would draw something —
  // flown points or a planned route — mirroring TripMap's own hasPoints ||
  // hasPlannedWaypoints check, so this count never disagrees with whether the
  // map (and its MapReadySignal) actually mounts. A trip with only planned
  // legs and no flights would otherwise be counted as one map short, and the
  // export would hang waiting for a signal that never fires (design.md §19).
  const showOverviewMap = legsWithPoints.length > 0 || hasPlannedWaypoints;
  const expectedMaps = (showOverviewMap ? 1 : 0) + legsWithPoints.length;
  const signalMapReady = useExportReady(trip !== null, expectedMaps);
  const mergedRows = interleaveTripRows(flights, plannedLegs);

  if (loadError) return <main className="print-root">Failed to load trip: {loadError}</main>;
  if (!trip) return <main className="print-root">Loading...</main>;

  const stats = [
    { label: 'Total Duration', value: formatDuration(trip.total_duration_sec) },
    { label: 'Total Distance', value: formatDistance(trip.total_distance_nm), unit: 'nm' },
    { label: 'Peak Altitude',  value: formatAlt(trip.max_altitude_ft),        unit: 'ft' },
    { label: 'Legs',           value: trip.flight_count },
  ];

  return (
    <main className="print-root">
      {/* ── Overview page ── */}
      <div className="print-page">
        <div className="print-header">
          <div className="print-title">{trip.name}</div>
          <div className="print-subtitle">
            {trip.flight_count} leg{trip.flight_count !== 1 ? 's' : ''}
            {trip.total_distance_nm != null ? ` · ${formatDistance(trip.total_distance_nm)} nm total` : ''}
          </div>
        </div>

        <StatsGrid stats={stats} />

        {trip.notes && (
          <div className="notes-section">
            <div className="section-title">Notes</div>
            <p className="notes-text">{trip.notes}</p>
          </div>
        )}

        {showOverviewMap && (
          <div className="map-section">
            <div className="section-title">Combined Route</div>
            <div className="print-map print-map-overview">
              <TripMap
                flights={flights}
                plannedLegs={plannedLegs}
                onReady={signalMapReady}
                preferCanvas={false}
                zoomControl={false}
              />
            </div>
          </div>
        )}

        <div className="legs-section">
          <div className="section-title">Legs</div>
          <table>
            <thead>
              <tr>
                <th>Leg</th>
                <th>Aircraft</th>
                <th>Date</th>
                <th>Duration</th>
                <th>Distance</th>
                <th>Route</th>
              </tr>
            </thead>
            <tbody>
              {mergedRows.map((row) => {
                if (row.kind === 'flight') {
                  const f = row.flight;
                  const i = row.flightIndex;
                  return (
                    <tr key={f.id}>
                      <td className="td-stat">
                        <span className="leg-color-swatch" style={{ background: LEG_COLORS[i % LEG_COLORS.length] }}></span>
                        Leg {i + 1}
                      </td>
                      <td className="td-aircraft">{f.aircraft || 'Unknown'}</td>
                      <td className="td-date">{fmtDate(f.start_time)}</td>
                      <td className="td-stat">{formatDuration(f.duration_sec)}</td>
                      <td className="td-stat">{formatDistance(f.distance_nm)} nm</td>
                      <td className="td-stat">
                        {(f.departure_icao || f.arrival_icao) ? (
                          <span className="td-route">
                            {f.departure_icao || '???'} → {f.arrival_icao || '???'}
                          </span>
                        ) : (
                          // Combined flights lose their ICAO codes, so fall back to coordinates
                          <span>{coordStr(f.departure_lat, f.departure_lon)}</span>
                        )}
                      </td>
                    </tr>
                  );
                }

                // An imported, unflown planned leg — a different thing from a
                // PDF flight plan attached to a flight (design.md §1). Plain
                // text rather than the dashboard's dark badge chips, which
                // are illegible on this page's white background; no move/link/
                // skip/delete controls, since the export is read-only.
                const leg = row.leg;
                const badge = plannedLegBadge(leg.status);
                return (
                  <tr key={`planned-${leg.id}`}>
                    <td className="td-stat td-planned-print">
                      {badge.label}{leg.is_snippet === 1 ? ' · Snippet' : ''}
                    </td>
                    <td className="td-aircraft">{leg.aircraft_type || 'Unknown'}</td>
                    <td className="td-date">—</td>
                    <td className="td-stat">—</td>
                    <td className="td-stat">approx. {formatDistance(leg.approx_distance_nm)} nm</td>
                    <td className="td-stat">
                      <span className="td-route">{leg.departure_ident} → {leg.destination_ident}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="print-footer">
          Generated by msfslogger · {fmtDate(new Date().toISOString())}
        </div>
      </div>

      {/* ── One detail page per leg ── */}
      {flights.map((f, i) => {
        const pts = f.points ?? [];
        if (pts.length === 0) return null;

        const legStats = [
          { label: 'Duration',     value: formatDuration(f.duration_sec) },
          { label: 'Distance',     value: formatDistance(f.distance_nm),   unit: 'nm' },
          { label: 'Max Altitude', value: formatAlt(f.max_altitude_ft),    unit: 'ft' },
          { label: 'Max Airspeed', value: formatSpeed(f.max_airspeed_kts), unit: 'kts' },
          {
            label: 'Departure',
            value: f.departure_icao || coordStr(f.departure_lat, f.departure_lon),
            sub: f.departure_icao ? (f.departure_name || '') : '',
          },
          {
            label: 'Arrival',
            value: f.arrival_icao || coordStr(f.arrival_lat, f.arrival_lon),
            sub: f.arrival_icao ? (f.arrival_name || '') : '',
          },
        ];

        return (
          <div className="print-page" key={f.id}>
            <div className="print-header">
              <div className="print-title">
                Leg {i + 1} — {f.aircraft || 'Unknown Aircraft'}
              </div>
              <div className="print-subtitle">
                {fmtDate(f.start_time)}
                {f.end_time ? ` → ${fmtDate(f.end_time)}` : ''}
              </div>
            </div>

            <StatsGrid stats={legStats} />

            <div className="map-section">
              <div className="section-title">GPS Track</div>
              <div className="print-map">
                <FlightMap
                  points={strideSample(pts, MAP_MAX_POINTS)}
                  onReady={signalMapReady}
                  preferCanvas={false}
                  zoomControl={false}
                />
              </div>
            </div>

            {pts.length >= 2 && (
              <div className="chart-section">
                <div className="section-title">Altitude Profile</div>
                <AltitudeChart points={lttb(pts, CHART_MAX_POINTS)} />
              </div>
            )}
          </div>
        );
      })}
    </main>
  );
}
