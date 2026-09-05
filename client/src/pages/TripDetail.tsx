import { Fragment, useRef, useState, useEffect } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { TripMap } from '../components/TripMap';
import { TripAtlas } from '../components/TripAtlas';
import { StatsGrid } from '../components/StatsGrid';
import { interleaveTripRows, GhostLegRow, plannedLegBadge, plannedLegLandingNote } from '../components/PlannedLegRows';
import { apiFetch, downloadPdf } from '../utils/api';
import { formatDate, formatDuration, formatDistance, formatAlt } from '../utils/format';
import type { Trip, Journey, PlannedLegImportResponse, PlannedLegWithChildren, Flight, ActiveTrip } from '../types';

const LEG_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#a78bfa', '#f87171'];

export function TripDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'atlas' ? 'atlas' : 'overview';
  const [journey, setJourney] = useState<Journey | null>(null);
  const [journeyError, setJourneyError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [includePlans, setIncludePlans] = useState(true);

  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importResults, setImportResults] = useState<PlannedLegImportResponse['results'] | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState('');
  const [reorderingLegId, setReorderingLegId] = useState<number | null>(null);

  // Active-trip toggle (design.md §11).
  const [activeBusy, setActiveBusy] = useState(false);
  const [activeError, setActiveError] = useState('');

  // Link a flight, initiated from a ghost (planned) leg row: pick a flight.
  const [linkingLegId, setLinkingLegId] = useState<number | null>(null);
  const [linkFlightChoice, setLinkFlightChoice] = useState<number | ''>('');
  const [linkableFlights, setLinkableFlights] = useState<Flight[] | null>(null);
  const [linkFlightsError, setLinkFlightsError] = useState('');
  const [linkBusyLegId, setLinkBusyLegId] = useState<number | null>(null);
  const [linkErrorByLeg, setLinkErrorByLeg] = useState<Record<number, string>>({});

  // Link a flight, initiated from a flight row: pick a leg (any trip, per
  // T-012's deliberate non-restriction — this is also how a mislinked flight
  // is re-targeted to a different leg, design.md §12.2).
  const [linkingFlightId, setLinkingFlightId] = useState<number | null>(null);
  const [linkLegChoice, setLinkLegChoice] = useState<number | ''>('');
  const [linkableLegs, setLinkableLegs] = useState<{ tripName: string; leg: PlannedLegWithChildren }[] | null>(null);
  const [linkLegsError, setLinkLegsError] = useState('');
  const [linkBusyFlightId, setLinkBusyFlightId] = useState<number | null>(null);
  const [linkErrorByFlight, setLinkErrorByFlight] = useState<Record<number, string>>({});

  const [unlinkBusyFlightId, setUnlinkBusyFlightId] = useState<number | null>(null);
  const [unlinkErrorByFlight, setUnlinkErrorByFlight] = useState<Record<number, string>>({});

  const [skipBusyLegId, setSkipBusyLegId] = useState<number | null>(null);
  const [skipErrorByLeg, setSkipErrorByLeg] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!id) { navigate('/'); return; }
    apiFetch<Trip>(`/api/trips/${id}`)
      .then(t => {
        setTrip(t);
        setEditName(t.name);
        setEditNotes(t.notes || '');
        document.title = `${t.name} — msfslogger`;
      })
      .catch(err => setLoadError((err as Error).message));
  }, [id, navigate]);

  useEffect(() => {
    // Lazy: only pay for the tracks once the atlas is actually opened
    if (view !== 'atlas' || journey || journeyError || !id) return;
    apiFetch<Journey>(`/api/trips/${id}/journey`)
      .then(setJourney)
      .catch(err => setJourneyError((err as Error).message));
  }, [view, journey, journeyError, id]);

  function setView(next: 'overview' | 'atlas') {
    const params = new URLSearchParams(searchParams);
    if (next === 'atlas') params.set('view', 'atlas');
    else params.delete('view');
    setSearchParams(params, { replace: true });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editName.trim()) { setSaveError('Name is required'); return; }
    setSaving(true);
    setSaveError('');
    try {
      const updated = await apiFetch<Trip>(`/api/trips/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), notes: editNotes.trim() || null }),
      });
      setTrip(updated);
      setEditOpen(false);
    } catch (err) {
      setSaveError('Save failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!trip || !confirm(`Delete trip "${trip.name}"? The flights will not be deleted.`)) return;
    try {
      await apiFetch(`/api/trips/${id}`, { method: 'DELETE' });
      navigate('/');
    } catch (err) {
      alert('Delete failed: ' + (err as Error).message);
    }
  }

  async function handleExportPdf() {
    setExporting(true);
    setExportError('');
    try {
      await downloadPdf(`/api/trips/${id}/export.pdf`, `trip-${id}.pdf`, { includePlans });
    } catch (err) {
      setExportError('Export failed: ' + (err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  async function handleRemoveLeg(flightId: number) {
    if (!confirm('Remove this leg from the trip?')) return;
    try {
      await apiFetch(`/api/trips/${id}/flights/${flightId}`, { method: 'DELETE' });
      // Reload
      const updated = await apiFetch<Trip>(`/api/trips/${id}`);
      setTrip(updated);
    } catch (err) {
      alert('Failed to remove leg: ' + (err as Error).message);
    }
  }

  /**
   * Imports one or more .lnmpln files as planned legs (design.md §7.1). Uses a
   * raw fetch rather than apiFetch: on both success (201) and a "some/all files
   * rejected" failure (400) the body is the same rich shape — { imported,
   * batch, results } — and results[] must be rendered either way so a rejected
   * or duplicate file's reason is never silently swallowed. apiFetch's generic
   * `{ error }` handling only fits the OTHER 400s here (bad trip id, no files,
   * a multer limit), which carry a plain { error } and no results.
   */
  async function handleImportPlannedLegs(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setImporting(true);
    setImportError('');
    setImportResults(null);
    setImportNotice(null);
    try {
      const formData = new FormData();
      for (const file of Array.from(files)) formData.append('lnmpln', file);

      const res = await fetch(`/api/trips/${id}/planned-legs`, { method: 'POST', body: formData });
      const body = await res.json().catch(() => null) as (PlannedLegImportResponse & { error?: string }) | null;

      if (!body) {
        setImportError(`Import failed: ${res.statusText || 'invalid server response'}`);
        return;
      }
      if (!Array.isArray(body.results)) {
        // No results[] -> a plain { error } response (invalid trip id, no
        // files, or a multer limit), not a per-file outcome.
        setImportError(`Import failed: ${body.error || res.statusText}`);
        return;
      }

      setImportResults(body.results);
      // The chain-resolution warning (design.md §9.2): non-blocking, the import
      // already succeeded and the legs exist — this only explains the order.
      if (body.batch && body.batch.ordering === 'upload') {
        setImportNotice(
          `Import order was taken from upload order (${body.batch.reason}), not the route — ` +
          'use the ↑/↓ controls below to correct it.'
        );
      }

      const updated = await apiFetch<Trip>(`/api/trips/${id}`);
      setTrip(updated);
    } catch (err) {
      setImportError('Import failed: ' + (err as Error).message);
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  async function handleDeletePlannedLeg(legId: number) {
    if (!confirm('Delete this planned leg?')) return;
    try {
      await apiFetch(`/api/planned-legs/${legId}`, { method: 'DELETE' });
      const updated = await apiFetch<Trip>(`/api/trips/${id}`);
      setTrip(updated);
    } catch (err) {
      alert('Failed to delete planned leg: ' + (err as Error).message);
    }
  }

  /**
   * Reorders planned legs via the full-permutation PATCH (design.md §7.2): the
   * ↑/↓ control swaps this leg with its immediate neighbour in the trip's
   * complete `seq ASC, id ASC` ordering (flown-linked legs included, even
   * though only unflown ones render as ghost rows) and sends the whole
   * permutation, because that endpoint has no "move" primitive.
   */
  async function handleReorderLeg(legId: number, direction: 'up' | 'down') {
    if (!trip) return;
    const allLegs = [...trip.planned_legs].sort((a, b) => a.seq - b.seq || a.id - b.id);
    const idx = allLegs.findIndex((l) => l.id === legId);
    if (idx === -1) return;
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= allLegs.length) return;

    const legIds = allLegs.map((l) => l.id);
    [legIds[idx], legIds[swapWith]] = [legIds[swapWith], legIds[idx]];

    setReorderError('');
    setReorderingLegId(legId);
    try {
      const updatedLegs = await apiFetch<PlannedLegWithChildren[]>(`/api/trips/${id}/planned-legs/order`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legIds }),
      });
      setTrip((t) => (t ? { ...t, planned_legs: updatedLegs } : t));
    } catch (err) {
      setReorderError('Reorder failed: ' + (err as Error).message);
    } finally {
      setReorderingLegId(null);
    }
  }

  async function handleToggleActive() {
    if (!trip) return;
    const activating = trip.is_active !== 1;
    if (!confirm(activating
      ? `Make "${trip.name}" the active trip? Any other active trip is cleared automatically.`
      : `Clear "${trip.name}" as the active trip?`
    )) return;
    setActiveError('');
    setActiveBusy(true);
    try {
      await apiFetch<ActiveTrip>('/api/active-trip', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tripId: activating ? trip.id : null }),
      });
      const updated = await apiFetch<Trip>(`/api/trips/${id}`);
      setTrip(updated);
    } catch (err) {
      setActiveError('Failed: ' + (err as Error).message);
    } finally {
      setActiveBusy(false);
    }
  }

  async function loadLinkableFlights() {
    setLinkFlightsError('');
    try {
      const allFlights = await apiFetch<Flight[]>('/api/flights');
      setLinkableFlights(allFlights.filter(f => f.planned_leg_id === null));
    } catch (err) {
      setLinkFlightsError((err as Error).message);
    }
  }

  /**
   * The leg picker is deliberately not scoped to this trip (design.md §12.3):
   * manual linking is the escape hatch and must reach any unflown leg of any
   * trip, so this fans out to every trip's own planned-legs endpoint rather
   * than reading trip.planned_legs, which only ever holds this page's trip.
   */
  async function loadLinkableLegs() {
    setLinkLegsError('');
    try {
      const allTrips = await apiFetch<Trip[]>('/api/trips');
      const perTrip = await Promise.all(allTrips.map(t =>
        apiFetch<PlannedLegWithChildren[]>(`/api/trips/${t.id}/planned-legs`)
          .then(legs => legs.filter(l => l.linked_flight_id === null).map(leg => ({ tripName: t.name, leg })))
      ));
      setLinkableLegs(perTrip.flat());
    } catch (err) {
      setLinkLegsError((err as Error).message);
    }
  }

  /** Shared by both link directions: same PUT either way (design.md §12.3). */
  async function linkFlightToLeg(flightId: number, legId: number) {
    await apiFetch<Flight>(`/api/flights/${flightId}/planned-leg`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plannedLegId: legId }),
    });
    // Both picker caches are now stale: the linked flight must disappear from
    // the flight-picker and the linked leg must disappear from the leg-picker.
    setLinkableFlights(null);
    setLinkableLegs(null);
    const updated = await apiFetch<Trip>(`/api/trips/${id}`);
    setTrip(updated);
  }

  async function handleLinkFromLeg(legId: number) {
    if (!linkFlightChoice) return;
    setLinkErrorByLeg(prev => { const { [legId]: _drop, ...rest } = prev; return rest; });
    setLinkBusyLegId(legId);
    try {
      await linkFlightToLeg(Number(linkFlightChoice), legId);
      setLinkingLegId(null);
      setLinkFlightChoice('');
    } catch (err) {
      // A 409 double-link names the offending flight (design.md §12.3) —
      // surfaced verbatim, inline, rather than a generic failure toast.
      setLinkErrorByLeg(prev => ({ ...prev, [legId]: (err as Error).message }));
    } finally {
      setLinkBusyLegId(null);
    }
  }

  async function handleLinkFromFlight(flightId: number) {
    if (!linkLegChoice) return;
    setLinkErrorByFlight(prev => { const { [flightId]: _drop, ...rest } = prev; return rest; });
    setLinkBusyFlightId(flightId);
    try {
      await linkFlightToLeg(flightId, Number(linkLegChoice));
      setLinkingFlightId(null);
      setLinkLegChoice('');
    } catch (err) {
      setLinkErrorByFlight(prev => ({ ...prev, [flightId]: (err as Error).message }));
    } finally {
      setLinkBusyFlightId(null);
    }
  }

  async function handleUnlinkFlight(flightId: number) {
    if (!confirm('Unlink this flight from its planned leg? The leg becomes unflown again.')) return;
    setUnlinkErrorByFlight(prev => { const { [flightId]: _drop, ...rest } = prev; return rest; });
    setUnlinkBusyFlightId(flightId);
    try {
      await apiFetch<Flight>(`/api/flights/${flightId}/planned-leg`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plannedLegId: null }),
      });
      setLinkableFlights(null);
      setLinkableLegs(null);
      const updated = await apiFetch<Trip>(`/api/trips/${id}`);
      setTrip(updated);
    } catch (err) {
      setUnlinkErrorByFlight(prev => ({ ...prev, [flightId]: (err as Error).message }));
    } finally {
      setUnlinkBusyFlightId(null);
    }
  }

  async function handleToggleSkip(legId: number, nextStatus: 'planned' | 'skipped') {
    if (!confirm(nextStatus === 'skipped' ? 'Skip this planned leg?' : 'Unskip this planned leg?')) return;
    setSkipErrorByLeg(prev => { const { [legId]: _drop, ...rest } = prev; return rest; });
    setSkipBusyLegId(legId);
    try {
      await apiFetch<PlannedLegWithChildren>(`/api/planned-legs/${legId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const updated = await apiFetch<Trip>(`/api/trips/${id}`);
      setTrip(updated);
    } catch (err) {
      // A 409 here means a flight got linked to this leg between page load
      // and click; surface the server's message rather than failing silently.
      setSkipErrorByLeg(prev => ({ ...prev, [legId]: (err as Error).message }));
    } finally {
      setSkipBusyLegId(null);
    }
  }

  if (loadError) {
    return <main className="container"><p style={{ color: '#f87171' }}>Failed to load trip: {loadError}</p></main>;
  }
  if (!trip) {
    return <main className="container"><p style={{ color: '#4b5563' }}>Loading...</p></main>;
  }

  const planCount = trip.flights.filter(f => f.flight_plan_name).length;
  // trip.planned_legs is always [] for a trip with no imported plans, so this
  // is a no-op for every trip that predates this feature (design.md §9.3, §18).
  const mergedRows = interleaveTripRows(trip.flights, trip.planned_legs);
  const sortedPlannedLegs = [...trip.planned_legs].sort((a, b) => a.seq - b.seq || a.id - b.id);
  const legByIdForFlights = new Map(trip.planned_legs.map(l => [l.id, l] as const));
  // The "Link to leg" escape hatch only appears once this trip actually uses
  // the planned-leg feature — otherwise a trip untouched by this feature must
  // render exactly as it did before (design.md §18, plan.json T-013 DoD).
  const showLinkToLeg = trip.planned_legs.length > 0;
  // The active-trip control shares that same gate, widened by one clause: an
  // active trip that has since lost every planned leg (all deleted) must
  // still show the control, or the user could never clear the flag from the
  // only page that offers it. One condition, not two that can drift.
  //
  // Gating (rather than always showing) is deliberate, not just cosmetic: an
  // active trip with no planned legs is not merely unused, it is INERT — the
  // matcher refuses with NO_PLANNED_LEGS before distance is even computed
  // (design.md §13.2 step 2) — so offering the control on a trip that has
  // never seen a .lnmpln import would invite setting state with no effect.
  // T-014 F-4.
  const showActiveTripControl = showLinkToLeg || trip.is_active === 1;

  const stats = [
    { label: 'Total Duration', value: formatDuration(trip.total_duration_sec) },
    { label: 'Total Distance', value: formatDistance(trip.total_distance_nm), unit: 'nm' },
    { label: 'Peak Altitude',  value: formatAlt(trip.max_altitude_ft),        unit: 'ft' },
    { label: 'Legs',           value: trip.flight_count },
  ];

  return (
    <main className="container" id="trip-detail">
      <Link to="/" className="back-link">← All Flights</Link>

      <h2 className="flight-title">{trip.name}</h2>
      <p className="flight-subtitle">
        {trip.flight_count} leg{trip.flight_count !== 1 ? 's' : ''}
        {trip.total_distance_nm != null ? ` · ${formatDistance(trip.total_distance_nm)} nm total` : ''}
      </p>

      {/*
        Gated on showActiveTripControl (see its definition above): a trip with
        no planned legs and not active renders exactly as it did before this
        feature (design.md §18's last bullet, T-013 DoD 8) — the control
        appears exactly when it starts to be able to mean something. T-014 F-4.
      */}
      {showActiveTripControl && (
        <div className="active-trip-row">
          {trip.is_active === 1 && <span className="badge badge-active-trip">Active Trip</span>}
          <button className="btn btn-ghost" disabled={activeBusy} onClick={handleToggleActive}>
            {activeBusy ? 'Working…' : (trip.is_active === 1 ? 'Clear Active Trip' : 'Set as Active Trip')}
          </button>
          {activeError && <span className="edit-error">{activeError}</span>}
        </div>
      )}

      <div className="view-toggle" role="tablist">
        <button
          role="tab"
          aria-selected={view === 'overview'}
          className={`view-tab${view === 'overview' ? ' is-active' : ''}`}
          onClick={() => setView('overview')}
        >Overview</button>
        <button
          role="tab"
          aria-selected={view === 'atlas'}
          className={`view-tab${view === 'atlas' ? ' is-active' : ''}`}
          onClick={() => setView('atlas')}
        >Atlas</button>
      </div>

      {view === 'atlas' ? (
        journeyError
          ? <p style={{ color: '#f87171' }}>Failed to load atlas: {journeyError}</p>
          : journey
            ? <TripAtlas journey={journey} />
            : <p style={{ color: '#4b5563' }}>Loading atlas...</p>
      ) : (
      <>
      <StatsGrid stats={stats} />

      {trip.notes && (
        <div className="notes-section">
          <div className="section-title">Notes</div>
          <p className="notes-text">{trip.notes}</p>
        </div>
      )}

      {editOpen && (
        <div className="edit-section">
          <div className="section-title">Edit Trip</div>
          <form className="edit-form" onSubmit={handleSave}>
            <div className="edit-field">
              <label>Trip Name</label>
              <input
                type="text"
                value={editName}
                maxLength={200}
                placeholder="Trip name"
                onChange={e => setEditName(e.target.value)}
              />
            </div>
            <div className="edit-field">
              <label>Notes</label>
              <textarea
                rows={4}
                value={editNotes}
                placeholder="Free-form notes about this trip..."
                onChange={e => setEditNotes(e.target.value)}
              />
            </div>
            <div className="edit-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
              <button type="button" className="btn btn-ghost" onClick={() => {
                setEditOpen(false);
                setEditName(trip.name);
                setEditNotes(trip.notes || '');
                setSaveError('');
              }}>Cancel</button>
              {saveError && <span className="edit-error">{saveError}</span>}
            </div>
          </form>
        </div>
      )}

      <div className="map-section">
        <div className="section-title">Combined Route</div>
        <div id="map">
          <TripMap flights={trip.flights} plannedLegs={trip.planned_legs} />
        </div>
      </div>

      <div className="planned-legs-import-section">
        <div className="section-title">Import Flight Plan(s)</div>
        <div className="flight-plan-upload">
          <input
            ref={importInputRef}
            type="file"
            accept=".lnmpln"
            multiple
            onChange={handleImportPlannedLegs}
            disabled={importing}
          />
          {importing && <span className="flight-plan-status">Importing…</span>}
          {importError && <span className="edit-error">{importError}</span>}
        </div>
        {importNotice && <p className="import-notice">{importNotice}</p>}
        {importResults && importResults.some(r => r.status !== 'imported' || (r.warnings && r.warnings.length > 0)) && (
          <ul className="import-results">
            {importResults.filter(r => r.status !== 'imported').map(r => (
              <li key={`${r.filename}-error`} className="import-result-error">{r.filename}: {r.error}</li>
            ))}
            {/* F-2: a successful import can still carry parser warnings (e.g.
                UNKNOWN_ELEMENT) — design.md §5.4e only works as a safety net if
                a human actually sees them, so show them without implying the
                import failed. */}
            {importResults.filter((r): r is typeof r & { warnings: NonNullable<typeof r.warnings> } =>
              r.status === 'imported' && !!r.warnings && r.warnings.length > 0
            ).map(r => (
              <li key={`${r.filename}-warnings`} className="import-result-warning">
                {r.filename}: imported — {r.warnings.map(w => w.message).join('; ')}
              </li>
            ))}
          </ul>
        )}
        {reorderError && <p className="edit-error">{reorderError}</p>}
      </div>

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
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {mergedRows.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: '1rem', color: '#4b5563' }}>No flights in this trip.</td></tr>
            ) : (
              mergedRows.map(row => {
                if (row.kind === 'planned') {
                  const leg = row.leg;
                  const legIdx = sortedPlannedLegs.findIndex(l => l.id === leg.id);
                  const pickerOpen = linkingLegId === leg.id;
                  return (
                    <GhostLegRow
                      key={`planned-${leg.id}`}
                      leg={leg}
                      onDelete={handleDeletePlannedLeg}
                      onMove={handleReorderLeg}
                      canMoveUp={legIdx > 0}
                      canMoveDown={legIdx >= 0 && legIdx < sortedPlannedLegs.length - 1}
                      busy={reorderingLegId === leg.id}
                      linkPickerOpen={pickerOpen}
                      onToggleLinkPicker={() => {
                        const opening = !pickerOpen;
                        setLinkingLegId(opening ? leg.id : null);
                        setLinkFlightChoice('');
                        if (opening && linkableFlights === null) loadLinkableFlights();
                      }}
                      linkBusy={linkBusyLegId === leg.id}
                      linkError={linkErrorByLeg[leg.id]}
                      linkableFlights={linkableFlights}
                      linkFlightsError={linkFlightsError}
                      linkFlightChoice={linkFlightChoice}
                      onLinkFlightChoiceChange={setLinkFlightChoice}
                      onConfirmLink={() => handleLinkFromLeg(leg.id)}
                      skipBusy={skipBusyLegId === leg.id}
                      skipError={skipErrorByLeg[leg.id]}
                      onToggleSkip={() => handleToggleSkip(leg.id, leg.status === 'skipped' ? 'planned' : 'skipped')}
                    />
                  );
                }
                const f = row.flight;
                const i = row.flightIndex;
                const linkedLeg = f.planned_leg_id != null ? legByIdForFlights.get(f.planned_leg_id) : undefined;
                const linkedBadge = linkedLeg ? plannedLegBadge(linkedLeg.status) : null;
                // design.md §14 (T-018 F-3): the flight itself IS the linked
                // flight, already in hand as `f` — no second fetch, exactly
                // the mapping this row already uses for the badge above.
                const landingNote = linkedLeg ? plannedLegLandingNote(linkedLeg, f) : null;
                const unlinkBusy = unlinkBusyFlightId === f.id;
                const unlinkErr = unlinkErrorByFlight[f.id];
                const linkFlightBusy = linkBusyFlightId === f.id;
                const linkFlightErr = linkErrorByFlight[f.id];
                const legPickerOpen = linkingFlightId === f.id;
                return (
                  <Fragment key={`flight-${f.id}`}>
                    <tr>
                      <td className="td-stat">
                        <span className="leg-color-swatch" style={{ background: LEG_COLORS[i % LEG_COLORS.length] }}></span>
                        Leg {i + 1}
                        {linkedBadge && <span className={`badge ${linkedBadge.className}`}>{linkedBadge.label}</span>}
                      </td>
                      <td className="td-aircraft">{f.aircraft || 'Unknown'}</td>
                      <td className="td-date">{formatDate(f.start_time)}</td>
                      <td className="td-stat">{formatDuration(f.duration_sec)}</td>
                      <td className="td-stat">{formatDistance(f.distance_nm)} nm</td>
                      <td className="td-stat">
                        {(f.departure_icao || f.arrival_icao) ? (
                          <span className="td-route" title={`${f.departure_name || ''} → ${f.arrival_name || ''}`}>
                            {f.departure_icao || '???'} → {f.arrival_icao || '???'}
                          </span>
                        ) : (
                          <span style={{ color: '#4b5563' }}>—</span>
                        )}
                        {landingNote && (
                          <div className={`td-planned-meta${linkedLeg?.status === 'diverted' ? ' td-planned-meta-diverted' : ''}`}>
                            {landingNote}
                          </div>
                        )}
                      </td>
                      <td className="td-actions">
                        <Link to={`/flight/${f.id}`} className="btn btn-ghost" style={{ fontSize: '0.8rem' }}>View</Link>
                        {f.planned_leg_id != null ? (
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: '0.8rem' }}
                            disabled={unlinkBusy}
                            onClick={() => handleUnlinkFlight(f.id)}
                          >{unlinkBusy ? 'Unlinking…' : 'Unlink'}</button>
                        ) : showLinkToLeg ? (
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: '0.8rem' }}
                            disabled={linkFlightBusy}
                            onClick={() => {
                              const opening = !legPickerOpen;
                              setLinkingFlightId(opening ? f.id : null);
                              setLinkLegChoice('');
                              if (opening && linkableLegs === null) loadLinkableLegs();
                            }}
                          >{legPickerOpen ? 'Cancel' : 'Link to leg'}</button>
                        ) : null}
                        {unlinkErr && <div className="edit-error">{unlinkErr}</div>}
                      </td>
                      <td className="td-actions">
                        <button className="btn btn-danger" style={{ fontSize: '0.8rem' }} onClick={() => handleRemoveLeg(f.id)}>Remove</button>
                      </td>
                    </tr>
                    {legPickerOpen && (
                      <tr className="tr-link-picker">
                        <td colSpan={8}>
                          <div className="link-picker">
                            {linkableLegs === null ? (
                              <span className="flight-plan-status">Loading legs…</span>
                            ) : linkableLegs.length === 0 ? (
                              <span className="flight-plan-status">No unlinked planned legs available.</span>
                            ) : (
                              <>
                                <select value={linkLegChoice} onChange={e => setLinkLegChoice(Number(e.target.value))}>
                                  <option value="">Choose a leg…</option>
                                  {linkableLegs.map(({ tripName, leg }) => (
                                    <option key={leg.id} value={leg.id}>
                                      {tripName} · Leg {leg.seq}: {leg.departure_ident} → {leg.destination_ident}
                                      {leg.status === 'skipped' ? ' (Skipped)' : ''}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className="btn btn-primary"
                                  style={{ fontSize: '0.8rem' }}
                                  disabled={!linkLegChoice || linkFlightBusy}
                                  onClick={() => handleLinkFromFlight(f.id)}
                                >{linkFlightBusy ? 'Linking…' : 'Link'}</button>
                              </>
                            )}
                            {linkLegsError && <span className="edit-error">{linkLegsError}</span>}
                            {linkFlightErr && <span className="edit-error">{linkFlightErr}</span>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      </>
      )}

      <div className="flight-actions">
        <Link to="/" className="btn btn-ghost">← Back</Link>
        <button className="btn btn-ghost" onClick={() => setEditOpen(o => !o)}>Edit</button>
        <button className="btn btn-ghost" onClick={handleExportPdf} disabled={exporting}>
          {exporting ? 'Generating PDF…' : 'Export PDF'}
        </button>
        {/* Only meaningful when at least one leg has a plan attached */}
        {planCount > 0 && (
          <label className="export-option">
            <input
              type="checkbox"
              checked={includePlans}
              disabled={exporting}
              onChange={e => setIncludePlans(e.target.checked)}
            />
            Include flight plans ({planCount})
          </label>
        )}
        <button className="btn btn-danger" onClick={handleDelete}>Delete Trip</button>
        {exportError && <span className="edit-error">{exportError}</span>}
      </div>
    </main>
  );
}
