import { useState, useEffect, useRef } from 'react';
import { StructuredListBody, StructuredListCell, StructuredListRow, StructuredListWrapper, Tag, Tile, Toggle } from '@carbon/react';
import './device/device.scss';

const STORAGE_KEY = 'msfslogger.device.engaged';
const SINCE_KEY = 'msfslogger.device.since';

/** Deterministic drift, so the readouts move without ever meaning anything. */
function drift(seed: number, t: number, spread: number): number {
  return (Math.sin(t / (900 + seed * 311)) + Math.sin(t / (140 + seed * 57))) * spread;
}

function pad(n: number, w = 2): string {
  return String(Math.floor(n)).padStart(w, '0');
}

export function Device() {
  const [engaged, setEngaged] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  });
  const [since, setSince] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(SINCE_KEY);
      return v ? Number(v) : null;
    } catch { return null; }
  });
  const [tick, setTick] = useState(0);
  const armed = useRef(false);

  useEffect(() => { document.title = 'The Device'; }, []);

  // Everything is local to this terminal. Nothing is transmitted.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, engaged ? '1' : '0');
      if (since === null) localStorage.removeItem(SINCE_KEY);
      else localStorage.setItem(SINCE_KEY, String(since));
    } catch { /* storage may be unavailable; the switch still works */ }
  }, [engaged, since]);

  useEffect(() => {
    if (!engaged) return;
    const id = setInterval(() => setTick(t => t + 1), 100);
    return () => clearInterval(id);
  }, [engaged]);

  function toggle() {
    armed.current = true;
    setEngaged(prev => {
      const next = !prev;
      setSince(next ? Date.now() : null);
      return next;
    });
  }

  const t = tick;
  const elapsedMs = engaged && since ? Date.now() - since : 0;
  const hh = pad(elapsedMs / 3_600_000);
  const mm = pad((elapsedMs / 60_000) % 60);
  const ss = pad((elapsedMs / 1000) % 60);
  const cs = pad((elapsedMs / 10) % 100);

  const flux = engaged ? 4.117 + drift(1, t, 0.42) : 0;
  const phase = engaged ? 61.4 + drift(2, t, 7.1) : 0;
  const margin = engaged ? 0.0092 + drift(3, t, 0.0031) : 0;
  const lamps = [0, 1, 2, 3, 4, 5].map(i =>
    engaged && Math.sin(t / (7 + i * 3) + i) > -0.35
  );

  const readout: [string, string][] = [
    ['FLUX', flux.toFixed(3)],
    ['PHASE', `${phase.toFixed(1)}°`],
    ['MARGIN', margin.toFixed(4)],
    ['ELAPSED', `${hh}:${mm}:${ss}.${cs}`],
  ];

  return (
    <div className="device-page">
      <Tile className={`device-frame${engaged ? ' is-engaged' : ''}`}>
        <div className="device-head">
          <div>
            <div className="device-title">THE DEVICE</div>
            <div className="device-sub">UNIT 0x7F3A · REV C</div>
            <div className="device-sub">NO SERVICEABLE PARTS</div>
          </div>
          <Tag className="device-state" type={engaged ? 'warm-gray' : 'gray'}>
            {engaged ? 'ENGAGED' : 'DORMANT'}
          </Tag>
        </div>

        <div className="device-lamps" aria-hidden="true">
          {lamps.map((on, i) => (
            <span key={i} className={`device-lamp${on ? ' is-lit' : ''}`} />
          ))}
        </div>

        <div className="device-toggle">
          <Toggle
            id="device-switch"
            labelText=""
            hideLabel
            aria-label="The Device"
            labelA=""
            labelB=""
            toggled={engaged}
            onToggle={toggle}
          />
        </div>

        <StructuredListWrapper className="device-readout-list" isCondensed aria-label="Readout">
          <StructuredListBody>
            {readout.map(([k, v]) => (
              <StructuredListRow key={k}>
                <StructuredListCell head>{k}</StructuredListCell>
                <StructuredListCell>{v}</StructuredListCell>
              </StructuredListRow>
            ))}
          </StructuredListBody>
        </StructuredListWrapper>

        <div className="device-footer">
          {engaged
            ? 'Do not disengage during transit.'
            : 'Disengaged. Conditions unchanged.'}
        </div>
      </Tile>
    </div>
  );
}
