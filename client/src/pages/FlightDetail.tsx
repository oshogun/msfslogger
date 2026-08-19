import { useState, useEffect, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { FlightMap } from '../components/FlightMap';
import { AltitudeChart } from '../components/AltitudeChart';
import { StatsGrid } from '../components/StatsGrid';
import { apiFetch, downloadPdf } from '../utils/api';
import { formatDate, formatDuration, formatDistance, formatAlt, formatSpeed, coordStr } from '../utils/format';
import type { Flight } from '../types';

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
          <FlightMap points={flight.points || []} />
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
