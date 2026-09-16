import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { GhostLegRow, plannedLegBadge } from '../components/PlannedLegRows';
import { apiFetch } from '../utils/api';
import type {
  Flight,
  PlannedLegImportResponse,
  PlannedLegListItem,
  PlannedLegStatus,
  SimbriefImportResponse,
  SimbriefImportResult,
  SimbriefSettings,
} from '../types';

const STATUS_FILTER_OPTIONS: PlannedLegStatus[] = ['planned', 'skipped', 'flown', 'diverted'];

/**
 * The non-trip entry point: every planned leg (loose and trip-linked) in one
 * list, plus the two import forms a trip page already offers — here without
 * a trip id, so an operator can prefile a flight plan before deciding, or
 * without ever needing, a trip for it.
 */
export function Prefiles() {
  const [legs, setLegs] = useState<PlannedLegListItem[] | null>(null);
  const [loadError, setLoadError] = useState('');

  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importResults, setImportResults] = useState<PlannedLegImportResponse['results'] | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  // Same SimBrief-settings idiom as TripDetail.tsx: a user-level setting,
  // loaded alongside the list but failing independently of it.
  const [simbriefUserId, setSimbriefUserId] = useState('');
  const [simbriefSaved, setSimbriefSaved] = useState<string | null | undefined>(undefined);
  const [simbriefSaving, setSimbriefSaving] = useState(false);
  const [simbriefSettingsError, setSimbriefSettingsError] = useState('');
  const [simbriefImporting, setSimbriefImporting] = useState(false);
  const [simbriefError, setSimbriefError] = useState('');
  const [simbriefResult, setSimbriefResult] = useState<SimbriefImportResult | null>(null);

  const [skipBusyLegId, setSkipBusyLegId] = useState<number | null>(null);
  const [skipErrorByLeg, setSkipErrorByLeg] = useState<Record<number, string>>({});

  // Link a flight, initiated from a row's own picker — same shape as
  // TripDetail.tsx's leg-initiated link flow.
  const [linkingLegId, setLinkingLegId] = useState<number | null>(null);
  const [linkFlightChoice, setLinkFlightChoice] = useState<number | ''>('');
  const [linkableFlights, setLinkableFlights] = useState<Flight[] | null>(null);
  const [linkFlightsError, setLinkFlightsError] = useState('');
  const [linkBusyLegId, setLinkBusyLegId] = useState<number | null>(null);
  const [linkErrorByLeg, setLinkErrorByLeg] = useState<Record<number, string>>({});

  // List filters: derived-only, never mutate `legs` and never touched by any
  // of the handlers above, which all keep operating on a leg by its real id.
  const [statusFilter, setStatusFilter] = useState<'all' | PlannedLegStatus>('all');
  const [tripFilter, setTripFilter] = useState<'all' | 'none' | number>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const loadLegs = useCallback(async () => {
    try {
      const all = await apiFetch<PlannedLegListItem[]>('/api/planned-legs');
      setLegs(all);
      setLoadError('');
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    loadLegs();
    apiFetch<SimbriefSettings>('/api/settings/simbrief')
      .then(s => {
        setSimbriefSaved(s.simbrief_user_id);
        setSimbriefUserId(s.simbrief_user_id ?? '');
      })
      .catch(err => setSimbriefSettingsError((err as Error).message));
  }, [loadLegs]);

  /** Same request/response handling as TripDetail.tsx's handleImportPlannedLegs, against the loose route. */
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

      const res = await fetch('/api/planned-legs', { method: 'POST', body: formData });
      const body = await res.json().catch(() => null) as (PlannedLegImportResponse & { error?: string }) | null;

      if (!body) {
        setImportError(`Import failed: ${res.statusText || 'invalid server response'}`);
        return;
      }
      if (!Array.isArray(body.results)) {
        // No results[] -> a plain { error } response (no files, or a multer
        // limit), not a per-file outcome.
        setImportError(`Import failed: ${body.error || res.statusText}`);
        return;
      }

      setImportResults(body.results);
      if (body.batch && body.batch.ordering === 'upload') {
        setImportNotice(
          `Import order was taken from upload order (${body.batch.reason}), not the route.`
        );
      }

      await loadLegs();
    } catch (err) {
      setImportError('Import failed: ' + (err as Error).message);
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  async function handleSaveSimbriefId() {
    setSimbriefSaving(true);
    setSimbriefSettingsError('');
    try {
      const result = await apiFetch<SimbriefSettings>('/api/settings/simbrief', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simbrief_user_id: simbriefUserId.trim() || null }),
      });
      setSimbriefSaved(result.simbrief_user_id);
      setSimbriefUserId(result.simbrief_user_id ?? '');
    } catch (err) {
      setSimbriefUserId(simbriefSaved ?? '');
      setSimbriefSettingsError((err as Error).message);
    } finally {
      setSimbriefSaving(false);
    }
  }

  /** Same request/response handling as TripDetail.tsx's handleImportSimbrief, against the loose route. */
  async function handleImportSimbrief() {
    setSimbriefImporting(true);
    setSimbriefError('');
    setSimbriefResult(null);
    try {
      const body = await apiFetch<SimbriefImportResponse>('/api/planned-legs/simbrief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allow_duplicates: false }),
      });
      setSimbriefResult(body.result);
      if (body.result.status === 'imported') {
        await loadLegs();
      }
    } catch (err) {
      setSimbriefError((err as Error).message);
    } finally {
      setSimbriefImporting(false);
    }
  }

  async function handleDeletePlannedLeg(legId: number) {
    if (!confirm('Delete this planned leg?')) return;
    try {
      await apiFetch(`/api/planned-legs/${legId}`, { method: 'DELETE' });
      await loadLegs();
    } catch (err) {
      alert('Failed to delete planned leg: ' + (err as Error).message);
    }
  }

  async function handleToggleSkip(legId: number, nextStatus: 'planned' | 'skipped') {
    if (!confirm(nextStatus === 'skipped' ? 'Skip this planned leg?' : 'Unskip this planned leg?')) return;
    setSkipErrorByLeg(prev => { const { [legId]: _drop, ...rest } = prev; return rest; });
    setSkipBusyLegId(legId);
    try {
      await apiFetch(`/api/planned-legs/${legId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      await loadLegs();
    } catch (err) {
      // A 409 here means a flight got linked to this leg between page load
      // and click; surface the server's message rather than failing silently.
      setSkipErrorByLeg(prev => ({ ...prev, [legId]: (err as Error).message }));
    } finally {
      setSkipBusyLegId(null);
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

  async function handleLinkFromLeg(legId: number) {
    if (!linkFlightChoice) return;
    setLinkErrorByLeg(prev => { const { [legId]: _drop, ...rest } = prev; return rest; });
    setLinkBusyLegId(legId);
    try {
      await apiFetch<Flight>(`/api/flights/${linkFlightChoice}/planned-leg`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plannedLegId: legId }),
      });
      setLinkableFlights(null);
      setLinkingLegId(null);
      setLinkFlightChoice('');
      await loadLegs();
    } catch (err) {
      // A 409 double-link names the offending flight — surfaced verbatim,
      // inline, rather than a generic failure toast.
      setLinkErrorByLeg(prev => ({ ...prev, [legId]: (err as Error).message }));
    } finally {
      setLinkBusyLegId(null);
    }
  }

  const simbriefSettingsLoading = simbriefSaved === undefined && !simbriefSettingsError;
  const simbriefIdDirty = simbriefUserId !== (simbriefSaved ?? '');
  const simbriefImportHint = simbriefSettingsLoading
    ? null
    : simbriefIdDirty
      ? 'Save your SimBrief User ID first.'
      : (simbriefSaved == null ? 'Enter your SimBrief Pilot ID to enable import.' : null);
  const simbriefImportDisabled =
    simbriefSettingsLoading || simbriefSaving || simbriefImporting || simbriefIdDirty || simbriefSaved == null;

  // Every distinct trip actually present among the currently loaded legs, not
  // a separate fetch of all trips — a trip with no legs left in this list
  // (e.g. every leg in it has flown and dropped off) has no reason to show up
  // as a filter option.
  const tripOptions = useMemo(() => {
    if (!legs) return [];
    const byId = new Map<number, string>();
    for (const leg of legs) {
      if (leg.trip_id !== null) byId.set(leg.trip_id, leg.trip_name ?? `Trip #${leg.trip_id}`);
    }
    return Array.from(byId.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [legs]);

  const filteredLegs = useMemo(() => {
    if (!legs) return null;
    const query = searchQuery.trim().toLowerCase();
    return legs.filter(leg => {
      if (statusFilter !== 'all' && leg.status !== statusFilter) return false;
      if (tripFilter === 'none' && leg.trip_id !== null) return false;
      if (typeof tripFilter === 'number' && leg.trip_id !== tripFilter) return false;
      if (query) {
        const haystack = [leg.departure_ident, leg.destination_ident, leg.aircraft_type ?? '']
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [legs, statusFilter, tripFilter, searchQuery]);

  return (
    <main className="container" id="prefiles">
      <h2 className="flight-title">Prefiles</h2>
      <p className="flight-subtitle">Every planned leg, loose or attached to a trip.</p>

      <div className="planned-legs-import-section">
        <div className="section-title">Import Planned Route (.lnmpln)</div>
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
            {importResults.filter((r): r is typeof r & { warnings: NonNullable<typeof r.warnings> } =>
              r.status === 'imported' && !!r.warnings && r.warnings.length > 0
            ).map(r => (
              <li key={`${r.filename}-warnings`} className="import-result-warning">
                {r.filename}: imported — {r.warnings.map(w => w.message).join('; ')}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="simbrief-import-section">
        <div className="section-title">Import from SimBrief</div>
        <div className="flight-plan-upload">
          <label htmlFor="prefiles-simbrief-user-id" className="simbrief-id-label">SimBrief User ID</label>
          <input
            id="prefiles-simbrief-user-id"
            type="text"
            className="simbrief-id-input"
            value={simbriefUserId}
            placeholder={simbriefSettingsLoading ? 'Loading…' : ''}
            disabled={simbriefSettingsLoading || simbriefSaving}
            onChange={e => setSimbriefUserId(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-ghost"
            disabled={simbriefSettingsLoading || simbriefSaving || !simbriefIdDirty}
            onClick={handleSaveSimbriefId}
          >{simbriefSaving ? 'Saving…' : 'Save'}</button>
        </div>
        {simbriefSettingsError && <span className="edit-error">{simbriefSettingsError}</span>}
        <div className="flight-plan-upload simbrief-import-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={simbriefImportDisabled}
            onClick={handleImportSimbrief}
          >{simbriefImporting ? 'Importing…' : 'Import from SimBrief'}</button>
          {simbriefImporting && <span className="flight-plan-status">Importing from SimBrief…</span>}
          {!simbriefImporting && simbriefImportHint && <span className="flight-plan-status">{simbriefImportHint}</span>}
        </div>
        {simbriefError && <span className="edit-error">{simbriefError}</span>}
        {simbriefResult?.status === 'imported' && (
          <>
            <p className="import-notice">Imported {simbriefResult.label} as a new planned leg.</p>
            {simbriefResult.warnings.length > 0 && (
              <ul className="import-results">
                {simbriefResult.warnings.map((w, i) => (
                  <li key={`${w.code}-${i}`} className="import-result-warning">{w.message}</li>
                ))}
              </ul>
            )}
          </>
        )}
        {simbriefResult?.status === 'duplicate' && (
          <p className="import-notice">{simbriefResult.error}</p>
        )}
      </div>

      <div className="legs-section">
        <div className="section-title">Planned legs</div>
        {loadError && <p className="edit-error">Failed to load planned legs: {loadError}</p>}
        {legs !== null && legs.length > 0 && (
          <div className="flight-plan-upload" style={{ flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <label htmlFor="prefiles-status-filter" className="simbrief-id-label">Status</label>
            <select
              id="prefiles-status-filter"
              className="simbrief-id-input"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as 'all' | PlannedLegStatus)}
            >
              <option value="all">All</option>
              {STATUS_FILTER_OPTIONS.map(status => (
                <option key={status} value={status}>{plannedLegBadge(status).label}</option>
              ))}
            </select>

            <label htmlFor="prefiles-trip-filter" className="simbrief-id-label">Trip</label>
            <select
              id="prefiles-trip-filter"
              className="simbrief-id-input"
              value={tripFilter === 'all' || tripFilter === 'none' ? tripFilter : String(tripFilter)}
              onChange={e => {
                const v = e.target.value;
                setTripFilter(v === 'all' || v === 'none' ? v : Number(v));
              }}
            >
              <option value="all">All trips</option>
              <option value="none">No trip</option>
              {tripOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>

            <label htmlFor="prefiles-search-filter" className="simbrief-id-label">Search</label>
            <input
              id="prefiles-search-filter"
              type="text"
              className="simbrief-id-input"
              placeholder="Departure, destination, aircraft…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        )}
        {legs === null ? (
          !loadError && <p style={{ color: '#4b5563' }}>Loading...</p>
        ) : legs.length === 0 ? (
          <div className="empty-state">
            <p>No planned legs yet.</p>
            <p>Import a .lnmpln file or a SimBrief plan above to prefile one.</p>
          </div>
        ) : filteredLegs !== null && filteredLegs.length === 0 ? (
          <div className="empty-state">
            <p>No planned legs match these filters.</p>
          </div>
        ) : (
          <div className="legs-table-wrap">
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
                {(filteredLegs ?? []).map(leg => {
                  const pickerOpen = linkingLegId === leg.id;
                  return (
                    <Fragment key={leg.id}>
                      <tr className="tr-ghost">
                        <td colSpan={8} style={{ fontWeight: 600 }}>
                          {leg.trip_id !== null && leg.trip_name ? (
                            <Link to={`/trip/${leg.trip_id}`} className="flight-plan-link">{leg.trip_name}</Link>
                          ) : (
                            'No trip'
                          )}
                        </td>
                      </tr>
                      <GhostLegRow
                        leg={leg}
                        onDelete={handleDeletePlannedLeg}
                        onMove={() => {}}
                        canMoveUp={false}
                        canMoveDown={false}
                        busy={false}
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
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
