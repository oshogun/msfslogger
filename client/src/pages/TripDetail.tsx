import { useRef, useState, useEffect } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { TripMap } from '../components/TripMap';
import { TripAtlas } from '../components/TripAtlas';
import { StatsGrid } from '../components/StatsGrid';
import { interleaveTripRows, GhostLegRow } from '../components/PlannedLegRows';
import { apiFetch, downloadPdf } from '../utils/api';
import { formatDate, formatDuration, formatDistance, formatAlt } from '../utils/format';
import type { Trip, Journey, PlannedLegImportResponse, PlannedLegWithChildren } from '../types';

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
          <TripMap flights={trip.flights} />
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
                  return (
                    <GhostLegRow
                      key={`planned-${leg.id}`}
                      leg={leg}
                      onDelete={handleDeletePlannedLeg}
                      onMove={handleReorderLeg}
                      canMoveUp={legIdx > 0}
                      canMoveDown={legIdx >= 0 && legIdx < sortedPlannedLegs.length - 1}
                      busy={reorderingLegId === leg.id}
                    />
                  );
                }
                const f = row.flight;
                const i = row.flightIndex;
                return (
                  <tr key={`flight-${f.id}`}>
                    <td className="td-stat">
                      <span className="leg-color-swatch" style={{ background: LEG_COLORS[i % LEG_COLORS.length] }}></span>
                      Leg {i + 1}
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
                    </td>
                    <td className="td-actions">
                      <Link to={`/flight/${f.id}`} className="btn btn-ghost" style={{ fontSize: '0.8rem' }}>View</Link>
                    </td>
                    <td className="td-actions">
                      <button className="btn btn-danger" style={{ fontSize: '0.8rem' }} onClick={() => handleRemoveLeg(f.id)}>Remove</button>
                    </td>
                  </tr>
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
