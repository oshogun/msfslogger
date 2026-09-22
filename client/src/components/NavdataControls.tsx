import { useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { NavdataLayers, NavdataPanes, type NavdataVisibility } from './NavdataLayers';
import { useNavdataStatus } from '../hooks/useNavdataStatus';
import { useNavdataFeatures, type NavdataFeaturesState } from '../hooks/useNavdataFeatures';
import { requestNavdata, type NavdataKind } from '../utils/navdataApi';
import type { FeaturesResponse, NavdataRequestResponse, NavdataStatusResponse } from '../types';

const KINDS: { kind: NavdataKind; label: string }[] = [
  { kind: 'airports', label: 'Airports' },
  { kind: 'navaids', label: 'Navaids' },
  { kind: 'waypoints', label: 'Waypoints' },
  { kind: 'airways', label: 'Airways' },
  { kind: 'runways', label: 'Runways' },
];

const AIRPORT_IDENT = /^[A-Z0-9]{1,8}$/;
const DETAIL_LIST_MAX = 5;

export function kindNote(kind: NavdataKind, data: FeaturesResponse): string | null {
  if (data.gated.includes(kind)) return `Zoom in to see ${kind}`;

  if (kind === 'airports') {
    if (data.airportThinning.mode === 'tier') {
      const { through, hidden } = data.airportThinning;
      if (through === 'large') return `Major airports only — ${hidden} more when you zoom in`;
      if (through === 'medium') return `Major and regional airports — ${hidden} more when you zoom in`;
      if (through === 'small') return `Hiding ${hidden} unlisted or non-airport fields — zoom in for the rest`;
      if (through === 'unknown') return `Hiding ${hidden} heliports and closed fields — zoom in for the rest`;
    }
    return data.coverage.airportsComplete && data.airports.length === 0 ? 'None here' : null;
  }
  const cov =
    kind === 'waypoints'
      ? data.coverage.byKind.W
      : kind === 'navaids'
        ? [data.coverage.byKind.V, data.coverage.byKind.N].reduce((a, b) => (b.fraction < a.fraction ? b : a))
        : null;
  if (!cov) return null;
  const count = kind === 'waypoints' ? data.waypoints.length : data.navaids.length;
  if (cov.harvestedCells === 0) return 'Not fetched here yet — fly through, or request a fix';
  if (cov.fraction >= 1 || cov.harvestedCells === data.coverage.totalCells) {
    return count === 0 ? 'None here' : null;
  }
  return `Partly fetched here (${Math.round(cov.fraction * 100)}%)`;
}

type RequestState =
  | { phase: 'pending' }
  | { phase: 'done'; state: NavdataRequestResponse['state'] }
  | { phase: 'error'; message: string };

function requestLabel(s: RequestState): string {
  if (s.phase === 'pending') return 'Requesting…';
  if (s.phase === 'error') return `Request failed: ${s.message}`;
  if (s.state === 'queued') return 'Queued';
  if (s.state === 'already-present') return 'Already fetched';
  return 'Not available';
}

export interface NavdataControlsProps {
  status: NavdataStatusResponse | null;
  visible: NavdataVisibility;
  onToggle: (kind: NavdataKind) => void;
  features: NavdataFeaturesState;
  /** Where the map is looking, for ordering the fetch-detail list nearest first. */
  anchor?: [number, number] | null;
}

export function NavdataControls({ status, visible, onToggle, features, anchor }: NavdataControlsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [requests, setRequests] = useState<Record<string, RequestState>>({});

  useEffect(() => {
    if (ref.current) {
      L.DomEvent.disableClickPropagation(ref.current);
      L.DomEvent.disableScrollPropagation(ref.current);
    }
  });

  if (!status || !status.present) return null;

  const data = features.data;
  const anyOn = KINDS.some(k => visible[k.kind]);
  const notes = data ? KINDS.filter(k => visible[k.kind]).map(k => ({ ...k, note: kindNote(k.kind, data) })) : [];
  const truncated = anyOn && data?.truncated === true;

  const indexOnly =
    visible.airports && data && !data.gated.includes('airports')
      ? data.airports
          .filter(a => !a.hasDetail && AIRPORT_IDENT.test(a.ident))
          .sort((a, b) => dist(a, anchor) - dist(b, anchor))
          .slice(0, DETAIL_LIST_MAX)
      : [];

  async function fetchDetail(ident: string) {
    setRequests(r => ({ ...r, [ident]: { phase: 'pending' } }));
    try {
      const res = await requestNavdata({ kind: 'A', ident });
      setRequests(r => ({ ...r, [ident]: { phase: 'done', state: res.state } }));
    } catch (err) {
      setRequests(r => ({ ...r, [ident]: { phase: 'error', message: err instanceof Error ? err.message : 'failed' } }));
    }
  }

  return (
    <div
      ref={ref}
      className="navdata-controls"
      style={{
        position: 'absolute', top: 10, right: 10, zIndex: 1000, maxWidth: 260,
        background: 'rgba(15,17,23,0.88)', color: '#e2e8f0', font: '12px system-ui',
        padding: '8px 10px', borderRadius: 6, border: '1px solid #334155',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Navdata</div>
      {KINDS.map(({ kind, label }) => {
        const gated = data?.gated.includes(kind) === true;
        return (
          <label
            key={kind}
            title={gated ? `Zoom in to see ${kind}` : undefined}
            style={{ display: 'flex', gap: 6, alignItems: 'center', opacity: gated ? 0.45 : 1 }}
          >
            <input type="checkbox" checked={visible[kind]} onChange={() => onToggle(kind)} />
            {label}
          </label>
        );
      })}
      {features.loading && anyOn && <div style={{ color: '#94a3b8', marginTop: 4 }}>Loading…</div>}
      {features.error && <div style={{ color: '#f87171', marginTop: 4 }}>{features.error}</div>}
      {notes.map(n => n.note && (
        <div key={n.kind} style={{ color: '#fbbf24', marginTop: 4 }}>{`${n.label}: ${n.note}`}</div>
      ))}
      {truncated && <div style={{ color: '#fbbf24', marginTop: 4 }}>Too many to draw — zoom in for more</div>}
      {indexOnly.length > 0 && (
        <div style={{ marginTop: 6, borderTop: '1px solid #334155', paddingTop: 4 }}>
          {indexOnly.map(a => {
            const req = requests[a.ident];
            return (
              <div key={a.ident} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                <span style={{ fontWeight: 600 }}>{a.ident}</span>
                {req ? (
                  <span style={{ color: req.phase === 'error' ? '#f87171' : '#94a3b8' }}>{requestLabel(req)}</span>
                ) : null}
                {(!req || req.phase === 'error') && (
                  <button type="button" onClick={() => fetchDetail(a.ident)}>Fetch detail</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function dist(a: { lat: number; lon: number }, anchor?: [number, number] | null): number {
  if (!anchor) return 0;
  return Math.hypot(a.lat - anchor[0], a.lon - anchor[1]);
}

const NONE_VISIBLE: NavdataVisibility = { airports: false, navaids: false, waypoints: false, airways: false, runways: false };

function ActiveNavdata({ status }: { status: NavdataStatusResponse }) {
  const map = useMap();
  const [visible, setVisible] = useState<NavdataVisibility>(NONE_VISIBLE);
  const kinds = KINDS.filter(k => visible[k.kind]).map(k => k.kind);
  const features = useNavdataFeatures(map, kinds, kinds.length > 0);

  return (
    <>
      {features.data && features.anchor && (
        <NavdataLayers data={features.data} anchor={features.anchor} visible={visible} />
      )}
      <NavdataControls
        status={status}
        visible={visible}
        onToggle={k => setVisible(v => ({ ...v, [k]: !v[k] }))}
        features={features}
        anchor={features.anchor}
      />
    </>
  );
}

/**
 * Mounts inside a MapContainer. Renders nothing at all — no panes, no
 * fetches beyond the status poll, no controls — until the server reports a
 * navdata replica.
 */
export function NavdataOverlay() {
  const status = useNavdataStatus();
  if (!status || !status.present) return null;
  return (
    <NavdataPanes>
      <ActiveNavdata status={status} />
    </NavdataPanes>
  );
}
