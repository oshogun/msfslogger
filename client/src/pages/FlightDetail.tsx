import { useState, useEffect, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { FlightMap } from '../components/FlightMap';
import { AltitudeChart } from '../components/AltitudeChart';
import { StatsGrid } from '../components/StatsGrid';
import { plannedLegBadge, plannedLegLandingNote } from '../components/PlannedLegRows';
import { apiFetch, downloadPdf } from '../utils/api';
import { formatDate, formatDuration, formatDistance, formatAlt, formatSpeed, coordStr } from '../utils/format';
import type { Flight, PlannedLegWithChildren, Trip } from '../types';

/**
 * The three procedure lines design.md §18 specifies verbatim, e.g.
 * "SID WESLA5 · 28L · SUSEY" / "STAR IRNMN2 · 24R · BURGL" / "APP KLAX24R · 24R".
 * Where approach_type is CUSTOM the name is a synthesized label rather than a
 * published procedure (§5.4g), so the line says so rather than presenting it
 * as a real fix.
 */
function procedureLine(label: string, parts: (string | null)[]): string {
  return `${label} ${parts.filter((p): p is string => !!p).join(' · ')}`;
}

function procedureLines(leg: PlannedLegWithChildren): string[] {
  const lines: string[] = [];
  if (leg.sid_name) {
    lines.push(procedureLine('SID', [leg.sid_name, leg.sid_runway, leg.sid_transition]));
  }
  if (leg.star_name) {
    lines.push(procedureLine('STAR', [leg.star_name, leg.star_runway, leg.star_transition]));
  }
  if (leg.approach_name) {
    let line = procedureLine('APP', [leg.approach_name, leg.approach_runway, leg.approach_transition]);
    if (leg.approach_type === 'CUSTOM') line += ' (custom — not a published procedure)';
    lines.push(line);
  }
  return lines;
}

export function FlightDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [flight, setFlight] = useState<Flight | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editAircraft, setEditAircraft] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [includePlan, setIncludePlan] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Planned-leg link (design.md §12, §18) ────────────────────────────────
  const [plannedLeg, setPlannedLeg] = useState<PlannedLegWithChildren | null>(null);
  const [plannedTripName, setPlannedTripName] = useState<string | null>(null);
  const [plannedLegLoading, setPlannedLegLoading] = useState(false);
  const [plannedLegError, setPlannedLegError] = useState('');
  const [unlinkBusy, setUnlinkBusy] = useState(false);
  const [unlinkError, setUnlinkError] = useState('');

  useEffect(() => {
    if (!id) { navigate('/'); return; }
    apiFetch<Flight>(`/api/flights/${id}`)
      .then(f => {
        setFlight(f);
        setEditAircraft(f.aircraft || '');
        setEditNotes(f.notes || '');
        document.title = `Flight #${f.id} — msfslogger`;
      })
      .catch(err => setLoadError((err as Error).message));
  }, [id, navigate]);

  // Fetches the linked leg (and its trip's name) whenever the link changes —
  // including right after Unlink, so the section disappears without a manual
  // reload. GET /api/planned-legs/:legId already returns PlannedLegWithChildren
  // (design.md §12.1); the trip's name is not on that payload, so GET
  // /api/trips supplies it — no server change is needed or permitted here.
  useEffect(() => {
    const legId = flight?.planned_leg_id ?? null;
    if (legId == null) {
      setPlannedLeg(null);
      setPlannedTripName(null);
      setPlannedLegError('');
      return;
    }
    let cancelled = false;
    setPlannedLegLoading(true);
    setPlannedLegError('');
    Promise.all([
      apiFetch<PlannedLegWithChildren>(`/api/planned-legs/${legId}`),
      apiFetch<Trip[]>('/api/trips'),
    ])
      .then(([leg, trips]) => {
        if (cancelled) return;
        setPlannedLeg(leg);
        setPlannedTripName(trips.find(t => t.id === leg.trip_id)?.name ?? null);
      })
      .catch(err => {
        if (cancelled) return;
        setPlannedLegError('Failed to load planned leg: ' + (err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setPlannedLegLoading(false);
      });
    return () => { cancelled = true; };
  }, [flight?.planned_leg_id]);

  async function handleUnlinkPlannedLeg() {
    if (!confirm('Unlink this flight from its planned leg?')) return;
    setUnlinkBusy(true);
    setUnlinkError('');
    try {
      const updated = await apiFetch<Flight>(`/api/flights/${id}/planned-leg`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plannedLegId: null }),
      });
      // Triggers the effect above (plannedLegId is now null), which clears
      // plannedLeg/plannedTripName and hides the section — no reload needed.
      setFlight(updated);
    } catch (err) {
      setUnlinkError('Unlink failed: ' + (err as Error).message);
    } finally {
      setUnlinkBusy(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    try {
      const updated = await apiFetch<Flight>(`/api/flights/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aircraft: editAircraft.trim() || null, notes: editNotes.trim() || null }),
      });
      setFlight(updated);
      setEditOpen(false);
    } catch (err) {
      setSaveError('Save failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this flight log?')) return;
    try {
      await apiFetch(`/api/flights/${id}`, { method: 'DELETE' });
      navigate('/');
    } catch (err) {
      alert('Delete failed: ' + (err as Error).message);
    }
  }

  async function handleUploadFlightPlan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setUploadError('File must be a PDF');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploading(true);
    setUploadError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const updated = await apiFetch<Flight>(`/api/flights/${id}/flight-plan`, {
        method: 'POST',
        body: formData,
      });
      setFlight(updated);
    } catch (err) {
      setUploadError('Upload failed: ' + (err as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleExportPdf() {
    setExporting(true);
    setExportError('');
    try {
      await downloadPdf(`/api/flights/${id}/export.pdf`, `flight-${id}.pdf`, { includePlans: includePlan });
    } catch (err) {
      setExportError('Export failed: ' + (err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  async function handleRemoveFlightPlan() {
    if (!confirm('Remove the attached flight plan?')) return;
    try {
      const updated = await apiFetch<Flight>(`/api/flights/${id}/flight-plan`, { method: 'DELETE' });
      setFlight(updated);
    } catch (err) {
      alert('Remove failed: ' + (err as Error).message);
    }
  }

  if (loadError) {
    return <main className="container"><p style={{ color: '#f87171' }}>Failed to load flight: {loadError}</p></main>;
  }
  if (!flight) {
    return <main className="container"><p style={{ color: '#4b5563' }}>Loading...</p></main>;
  }

  const stats = [
    { label: 'Duration',     value: formatDuration(flight.duration_sec) },
    { label: 'Distance',     value: formatDistance(flight.distance_nm),   unit: 'nm' },
    { label: 'Max Altitude', value: formatAlt(flight.max_altitude_ft),    unit: 'ft' },
    { label: 'Max Airspeed', value: formatSpeed(flight.max_airspeed_kts), unit: 'kts' },
    { label: 'Points',       value: flight.point_count ?? flight.points?.length ?? 0 },
    {
      label: 'Departure',
      value: flight.departure_icao || coordStr(flight.departure_lat, flight.departure_lon),
      sub: flight.departure_icao ? (flight.departure_name || coordStr(flight.departure_lat, flight.departure_lon)) : '',
    },
    {
      label: 'Arrival',
      value: flight.arrival_icao || coordStr(flight.arrival_lat, flight.arrival_lon),
      sub: flight.arrival_icao ? (flight.arrival_name || coordStr(flight.arrival_lat, flight.arrival_lon)) : '',
    },
  ];

  return (
    <main className="container" id="flight-detail">
      <Link to="/" className="back-link">← All Flights</Link>

      <h2 className="flight-title">Flight #{flight.id} — {flight.aircraft || 'Unknown Aircraft'}</h2>
      <p className="flight-subtitle">
        {formatDate(flight.start_time)}{flight.end_time ? ` → ${formatDate(flight.end_time)}` : ' (in progress)'}
      </p>

      <StatsGrid stats={stats} />

      {flight.notes && (
        <div className="notes-section">
          <div className="section-title">Notes</div>
          <p className="notes-text">{flight.notes}</p>
        </div>
      )}

      {flight.planned_leg_id != null && (
        <div className="notes-section">
          <div className="section-title">Planned Leg</div>
          {plannedLegLoading && <p className="flight-plan-status">Loading planned leg…</p>}
          {plannedLegError && <p className="edit-error">{plannedLegError}</p>}
          {plannedLeg && (
            <>
              <p className="notes-text">
                <span className={`badge ${plannedLegBadge(plannedLeg.status).className}`}>
                  {plannedLegBadge(plannedLeg.status).label}
                </span>
                {plannedLeg.is_snippet === 1 && <span className="badge badge-snippet" style={{ marginLeft: '0.4rem' }}>Snippet</span>}
                {' '}
                Leg {plannedLeg.seq} of{' '}
                {plannedTripName ? (
                  <Link to={`/trip/${plannedLeg.trip_id}`} className="flight-plan-link">{plannedTripName}</Link>
                ) : (
                  'its trip'
                )}
                : {plannedLeg.departure_ident} → {plannedLeg.destination_ident}
              </p>
              <p className="flight-plan-status">
                Planned cruise {formatAlt(plannedLeg.cruise_alt_ft)} ft · approx.{' '}
                {formatDistance(plannedLeg.approx_distance_nm)} nm
              </p>
              {/* design.md §14 (T-018 F-3): the flight itself is `flight` —
                  no second fetch to resolve it. Null on every leg not yet
                  flown and every leg imported before this phase (§18). */}
              {plannedLegLandingNote(plannedLeg, flight) && (
                <p className={`flight-plan-status${plannedLeg.status === 'diverted' ? ' td-planned-meta-diverted' : ''}`}>
                  {plannedLegLandingNote(plannedLeg, flight)}
                </p>
              )}
              <p className="flight-plan-status">
                {flight.planned_leg_link_source === 'auto'
                  ? 'Linked automatically, at takeoff.'
                  : flight.planned_leg_link_source === 'manual'
                    ? 'Linked by hand.'
                    : 'Linked.'}
              </p>
              {procedureLines(plannedLeg).map((line, i) => (
                <p key={i} className="flight-plan-status">{line}</p>
              ))}
              <div className="flight-actions" style={{ marginTop: '0.6rem' }}>
                <button className="btn btn-ghost" disabled={unlinkBusy} onClick={handleUnlinkPlannedLeg}>
                  {unlinkBusy ? 'Unlinking…' : 'Unlink'}
                </button>
                {unlinkError && <span className="edit-error">{unlinkError}</span>}
              </div>
            </>
          )}
        </div>
      )}

      <div className="flight-plan-section">
        <div className="section-title">Flight Plan</div>
        {flight.flight_plan_name ? (
          <div className="flight-plan-attached">
            <a
              href={`/api/flights/${flight.id}/flight-plan`}
              target="_blank"
              rel="noopener noreferrer"
              className="flight-plan-link"
            >
              {flight.flight_plan_name}
            </a>
            <button className="btn btn-ghost" onClick={handleRemoveFlightPlan}>Remove</button>
          </div>
        ) : (
          <div className="flight-plan-upload">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={handleUploadFlightPlan}
              disabled={uploading}
            />
            {uploading && <span className="flight-plan-status">Uploading...</span>}
            {uploadError && <span className="edit-error">{uploadError}</span>}
          </div>
        )}
      </div>

      {editOpen && (
        <div className="edit-section">
          <div className="section-title">Edit Flight</div>
          <form className="edit-form" onSubmit={handleSave}>
            <div className="edit-field">
              <label>Aircraft</label>
              <input
                type="text"
                value={editAircraft}
                maxLength={200}
                placeholder="Aircraft name"
                onChange={e => setEditAircraft(e.target.value)}
              />
            </div>
            <div className="edit-field">
              <label>Notes</label>
              <textarea
                rows={4}
                value={editNotes}
                placeholder="Free-form notes about this flight..."
                onChange={e => setEditNotes(e.target.value)}
              />
            </div>
            <div className="edit-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
              <button type="button" className="btn btn-ghost" onClick={() => {
                setEditOpen(false);
                setEditAircraft(flight.aircraft || '');
                setEditNotes(flight.notes || '');
                setSaveError('');
              }}>Cancel</button>
              {saveError && <span className="edit-error">{saveError}</span>}
            </div>
          </form>
        </div>
      )}

      <div className="map-section">
        <div className="section-title">GPS Track</div>
        <div id="map">
          <FlightMap points={flight.points || []} plannedLeg={plannedLeg ?? undefined} />
        </div>
      </div>

      {(flight.points?.length ?? 0) >= 2 && (
        <div className="chart-section">
          <div className="section-title">Altitude Profile</div>
          <AltitudeChart points={flight.points!} />
        </div>
      )}

      <div className="flight-actions">
        <Link to="/" className="btn btn-ghost">← Back</Link>
        <button className="btn btn-ghost" onClick={() => setEditOpen(o => !o)}>Edit</button>
        <button className="btn btn-ghost" onClick={handleExportPdf} disabled={exporting}>
          {exporting ? 'Generating PDF…' : 'Export PDF'}
        </button>
        {/* Only meaningful when there is actually a plan to include */}
        {flight.flight_plan_name && (
          <label className="export-option">
            <input
              type="checkbox"
              checked={includePlan}
              disabled={exporting}
              onChange={e => setIncludePlan(e.target.checked)}
            />
            Include flight plan
          </label>
        )}
        <button className="btn btn-danger" onClick={handleDelete}>Delete Flight</button>
        {exportError && <span className="edit-error">{exportError}</span>}
      </div>
    </main>
  );
}
