import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { FlightPoint } from '../types';
import {
  buildTimeline,
  sample,
  DEFAULT_SPEED,
  SPEED_STEPS,
} from '../utils/replay';
import type { ReplayEventMarker, ReplaySample, Timeline } from '../utils/replay';
import { useReplayClock } from '../hooks/useReplayClock';
import type { FrameScheduler, TickReason } from '../hooks/useReplayClock';
import { formatAlt, formatDuration, formatSpeed } from '../utils/format';

interface Props {
  /** Full, non-downsampled track. */
  points: FlightPoint[];
  id?: string;
  /** Reserved for event ticks on the scrubber. */
  events?: ReplayEventMarker[];
  /** Test seam: replaces requestAnimationFrame. */
  scheduler?: FrameScheduler;
}

const UI_INTERVAL_MS = 100;

const READOUT: { field: string; label: string }[] = [
  { field: 'time', label: 'TIME' },
  { field: 'elapsed', label: 'ELAPSED' },
  { field: 'alt', label: 'ALT' },
  { field: 'ias', label: 'IAS' },
  { field: 'gs', label: 'GS' },
  { field: 'hdg', label: 'HDG' },
  { field: 'vs', label: 'VS' },
  { field: 'state', label: 'STATE' },
  { field: 'point', label: 'POINT' },
];

function readoutValues(timeline: Timeline, s: ReplaySample): Record<string, string> {
  const vs = Math.round(s.verticalSpeedFpm / 10) * 10;
  return {
    time: new Date(s.realTimeMs).toISOString().slice(11, 19) + 'Z',
    elapsed: formatDuration(Math.round((s.realTimeMs - timeline.startMs) / 1000)),
    alt: formatAlt(s.altitudeFt) + ' ft',
    ias: formatSpeed(s.airspeedKnots) + ' kt',
    gs: formatSpeed(s.groundSpeedKnots) + ' kt',
    hdg: String(Math.round(s.headingDeg) % 360).padStart(3, '0') + '°',
    vs: `${vs < 0 ? '-' : '+'}${Math.abs(vs).toLocaleString()} fpm`,
    state: s.inGap
      ? `Recording gap — ${formatDuration(Math.round(s.gapRealSec))}`
      : s.onGround
        ? 'On ground'
        : 'Airborne',
    point: `${s.pointIndex + 1} / ${timeline.points.length}`,
  };
}

function makeAircraftIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    iconAnchor: [12, 12],
    html: `<div class="replay-aircraft" style="transform:rotate(-90deg);font-size:24px;line-height:1;filter:drop-shadow(0 1px 3px rgba(0,0,0,.8))">✈</div>`,
  });
}

interface MapHandles {
  map: L.Map;
  marker: L.Marker;
  aircraftEl: HTMLElement;
}

// Creates the aircraft marker once and hands the imperative handles up to the
// panel, which moves it every frame without a React render.
function ReplayMapController({
  timeline,
  handlesRef,
  onReady,
}: {
  timeline: Timeline;
  handlesRef: { current: MapHandles | null };
  onReady: () => void;
}) {
  const map = useMap();
  useEffect(() => {
    const first = timeline.latlngs[0];
    const marker = L.marker(first, {
      icon: makeAircraftIcon(),
      zIndexOffset: 1000,
      interactive: false,
      keyboard: false,
    }).addTo(map);
    const aircraftEl = marker.getElement()?.firstElementChild as HTMLElement | null;
    map.fitBounds(L.latLngBounds(timeline.latlngs), { padding: [30, 30] });
    map.invalidateSize();
    if (aircraftEl) {
      handlesRef.current = { map, marker, aircraftEl };
      onReady();
    }
    return () => {
      handlesRef.current = null;
      marker.remove();
    };
  }, [map, timeline, handlesRef, onReady]);
  return null;
}

export function ReplayPanel({ points, id, scheduler }: Props) {
  const timeline = useMemo(() => buildTimeline(points), [points]);
  const [speed, setSpeed] = useState<number>(DEFAULT_SPEED);
  const [follow, setFollow] = useState(true);

  const handlesRef = useRef<MapHandles | null>(null);
  const scrubberRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const readoutRef = useRef<HTMLDListElement | null>(null);
  const lastUiMsRef = useRef(-Infinity);
  const followRef = useRef(follow);
  followRef.current = follow;
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  const applySample = useCallback((v: number, reason: TickReason) => {
    const tl = timelineRef.current;
    const s = sample(tl, v);
    const handles = handlesRef.current;
    if (!s) return;

    if (handles) {
      handles.marker.setLatLng([s.lat, s.lon]);
      handles.aircraftEl.style.transform = `rotate(${s.headingDeg - 90}deg)`;
    }

    const now = performance.now();
    if (reason === 'frame' && now - lastUiMsRef.current < UI_INTERVAL_MS) return;
    lastUiMsRef.current = now;

    const values = readoutValues(tl, s);
    const root = rootRef.current;
    if (root) {
      for (const [field, text] of Object.entries(values)) {
        const el = root.querySelector<HTMLElement>(`[data-field="${field}"]`);
        if (el) el.textContent = text;
      }
      const scrub = root.querySelector<HTMLElement>('[data-field="scrub"]');
      if (scrub) scrub.textContent = values.time;
    }
    readoutRef.current?.classList.toggle('replay-readout--gap', s.inGap);
    const scrubber = scrubberRef.current;
    if (scrubber) {
      scrubber.value = String(s.virtualSec);
      scrubber.setAttribute('aria-valuetext', values.time);
    }

    if (followRef.current && handles) {
      const pos = L.latLng(s.lat, s.lon);
      const size = handles.map.getSize();
      if (size.x === 0 || size.y === 0) {
        handles.map.panTo(pos, { animate: false });
      } else {
        const p = handles.map.latLngToContainerPoint(pos);
        const outside =
          p.x < size.x * 0.2 || p.x > size.x * 0.8 || p.y < size.y * 0.2 || p.y > size.y * 0.8;
        if (outside) handles.map.panTo(pos, { animate: false });
      }
    }
  }, []);

  const clock = useReplayClock({
    virtualDurationSec: timeline.virtualDurationSec,
    speed,
    onTick: applySample,
    scheduler,
  });

  // Once the marker exists, paint the current position (the initial sample on
  // first mount) so map and readout agree before anything is played.
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const onMapReady = useCallback(() => {
    lastUiMsRef.current = -Infinity;
    applySample(clockRef.current.getVirtualSec(), 'seek');
  }, [applySample]);

  useEffect(() => {
    if (!follow) return;
    const handles = handlesRef.current;
    if (handles) handles.map.panTo(handles.marker.getLatLng(), { animate: false });
  }, [follow]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, select, textarea, [contenteditable]')) return;
    const step = e.shiftKey ? 30 : 5;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        clock.toggle();
        break;
      case 'ArrowRight':
        clock.seekBy(step);
        break;
      case 'ArrowLeft':
        clock.seekBy(-step);
        break;
      case 'Home':
        clock.seekTo(0);
        break;
      case 'End':
        clock.seekTo(timeline.virtualDurationSec);
        break;
    }
  };

  const first = sample(timeline, 0);
  if (!first) {
    return (
      <section className="replay-panel" id={id} aria-label="Flight replay">
        <p className="acars-empty">No replayable GPS points for this flight.</p>
      </section>
    );
  }
  const initial = readoutValues(timeline, first);

  const playLabel = clock.finished ? 'Restart' : clock.playing ? 'Pause' : 'Play';

  return (
    <section
      className="replay-panel"
      id={id}
      tabIndex={0}
      aria-label="Flight replay"
      ref={rootRef}
      onKeyDown={onKeyDown}
    >
      <div className="replay-map">
        <MapContainer
          preferCanvas={false}
          zoomControl
          center={timeline.latlngs[0]}
          zoom={10}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            maxZoom={18}
          />
          <Polyline
            positions={timeline.latlngs}
            pathOptions={{ color: '#60a5fa', weight: 2.5, opacity: 0.45 }}
          />
          <ReplayMapController timeline={timeline} handlesRef={handlesRef} onReady={onMapReady} />
        </MapContainer>
      </div>

      <div className="replay-controls">
        <button
          type="button"
          className="btn btn-primary replay-play"
          aria-label={`${playLabel} replay`}
          onClick={() => (clock.finished ? clock.restart() : clock.toggle())}
        >
          {playLabel}
        </button>
        <input
          ref={scrubberRef}
          type="range"
          className="replay-scrubber"
          min="0"
          max={timeline.virtualDurationSec}
          step="0.1"
          defaultValue="0"
          aria-label="Replay position"
          aria-valuetext={initial.time}
          onChange={e => clock.seekTo(Number(e.target.value))}
        />
        <span className="replay-time" data-field="scrub">
          {initial.time}
        </span>
        <select
          className="replay-speed"
          aria-label="Replay speed"
          value={speed}
          onChange={e => setSpeed(Number(e.target.value))}
        >
          {SPEED_STEPS.map(s => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <label className="replay-follow">
          <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> Follow
          aircraft
        </label>
      </div>

      <dl className="replay-readout" ref={readoutRef}>
        {READOUT.map(({ field, label }) => (
          <div className="replay-readout-item" key={field}>
            <dt>{label}</dt>
            <dd className="replay-value" data-field={field}>
              {initial[field]}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
