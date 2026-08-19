import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { TripMap } from '../components/TripMap';
import { StatsGrid } from '../components/StatsGrid';
import { apiFetch, downloadPdf } from '../utils/api';
import { formatDate, formatDuration, formatDistance, formatAlt } from '../utils/format';
import type { Trip } from '../types';

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
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [includePlans, setIncludePlans] = useState(true);

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

  if (loadError) {
    return <main className="container"><p style={{ color: '#f87171' }}>Failed to load trip: {loadError}</p></main>;
  }
  if (!trip) {
    return <main className="container"><p style={{ color: '#4b5563' }}>Loading...</p></main>;
  }

  const planCount = trip.flights.filter(f => f.flight_plan_name).length;

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
            {trip.flights.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: '1rem', color: '#4b5563' }}>No flights in this trip.</td></tr>
            ) : (
              trip.flights.map((f, i) => (
                <tr key={f.id}>
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
              ))
            )}
          </tbody>
        </table>
      </div>

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
