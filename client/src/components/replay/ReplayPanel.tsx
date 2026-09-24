import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  Checkbox,
  Dropdown,
  IconButton,
  Slider,
  StructuredListBody,
  StructuredListCell,
  StructuredListRow,
  StructuredListWrapper,
  Tag,
} from '@carbon/react';
import { Pause, Play, Restart } from '@carbon/icons-react';
import type { FlightPoint } from '../../mock/types';
import { formatAlt, formatDuration, formatSpeed } from '../../utils/format';
import { buildTimeline, sample, DEFAULT_SPEED, SPEED_STEPS } from './replay';
import type { ReplaySample, Timeline } from './replay';
import { useReplayClock } from './useReplayClock';
import type { FrameScheduler, TickReason } from './useReplayClock';
import './ReplayPanel.scss';

export interface ReplayPanelProps {
  /** Full, non-downsampled track. */
  points: FlightPoint[];
  id?: string;
  /**
   * Called on every clock tick (and once on mount) with the interpolated
   * position, so a map can move the replay marker without a React render.
   */
  onPosition?: (sample: ReplaySample, reason: TickReason) => void;
  /** Called when the follow-aircraft toggle changes (and once on mount). */
  onFollowChange?: (follow: boolean) => void;
  /** Test seam: replaces requestAnimationFrame. */
  scheduler?: FrameScheduler;
}

const UI_INTERVAL_MS = 100;

const READOUT_COLUMNS: { field: string; label: string }[][] = [
  [
    { field: 'time', label: 'TIME' },
    { field: 'elapsed', label: 'ELAPSED' },
    { field: 'point', label: 'POINT' },
  ],
  [
    { field: 'alt', label: 'ALT' },
    { field: 'ias', label: 'IAS' },
    { field: 'gs', label: 'GS' },
  ],
  [
    { field: 'hdg', label: 'HDG' },
    { field: 'vs', label: 'VS' },
    { field: 'state', label: 'STATE' },
  ],
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

export function ReplayPanel({ points, id, onPosition, onFollowChange, scheduler }: ReplayPanelProps) {
  const timeline = useMemo(() => buildTimeline(points), [points]);
  const [speed, setSpeed] = useState<number>(DEFAULT_SPEED);
  const [follow, setFollow] = useState(true);
  const [scrub, setScrub] = useState(0);
  const [everStarted, setEverStarted] = useState(false);

  const rootRef = useRef<HTMLElement | null>(null);
  const readoutRef = useRef<HTMLDivElement | null>(null);
  const lastUiMsRef = useRef(-Infinity);
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const onPositionRef = useRef(onPosition);
  onPositionRef.current = onPosition;

  const applySample = useCallback((v: number, reason: TickReason) => {
    const tl = timelineRef.current;
    const s = sample(tl, v);
    if (!s) return;

    onPositionRef.current?.(s, reason);

    const now = performance.now();
    if (reason === 'frame' && now - lastUiMsRef.current < UI_INTERVAL_MS) return;
    lastUiMsRef.current = now;

    // The readout is written straight into the DOM so a 60 fps clock never
    // costs a React render; only the scrubber position goes through state, and
    // only at the throttled rate.
    const values = readoutValues(tl, s);
    const root = rootRef.current;
    if (root) {
      for (const [field, text] of Object.entries(values)) {
        const el = root.querySelector<HTMLElement>(`[data-field="${field}"]`);
        if (el) el.textContent = text;
      }
    }
    readoutRef.current?.classList.toggle('replay-readout--gap', s.inGap);
    setScrub(s.virtualSec);
  }, []);

  const clock = useReplayClock({
    virtualDurationSec: timeline.virtualDurationSec,
    speed,
    onTick: applySample,
    scheduler,
  });

  // Paint the starting position once so a map and the readout agree before
  // anything is played.
  const clockRef = useRef(clock);
  clockRef.current = clock;
  useEffect(() => {
    lastUiMsRef.current = -Infinity;
    applySample(clockRef.current.getVirtualSec(), 'seek');
  }, [applySample, timeline]);

  useEffect(() => {
    onFollowChange?.(follow);
  }, [follow, onFollowChange]);

  useEffect(() => {
    if (clock.playing) setEverStarted(true);
  }, [clock.playing]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, select, textarea, [contenteditable], [role="slider"], [role="combobox"], [role="listbox"]')) return;
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
        <p className="replay-empty">No replayable GPS points for this flight.</p>
      </section>
    );
  }
  const initial = readoutValues(timeline, first);

  const playLabel = clock.finished ? 'Restart' : clock.playing ? 'Pause' : 'Play';
  const PlayIcon = clock.finished ? Restart : clock.playing ? Pause : Play;
  const stateLabel = clock.finished ? 'Ended' : clock.playing ? 'Playing' : everStarted ? 'Paused' : 'Idle';
  const stateType = clock.finished ? 'gray' : clock.playing ? 'green' : everStarted ? 'blue' : 'cool-gray';

  return (
    <section
      className="replay-panel"
      id={id}
      tabIndex={0}
      aria-label="Flight replay"
      ref={rootRef}
      onKeyDown={onKeyDown}
    >
      <div className="replay-controls">
        <IconButton
          label={`${playLabel} replay`}
          kind="primary"
          size="md"
          className="replay-play"
          onClick={() => (clock.finished ? clock.restart() : clock.toggle())}
        >
          <PlayIcon />
        </IconButton>
        <div className="replay-scrubber">
          <Slider
            id={id ? `${id}-scrubber` : undefined}
            ariaLabelInput="Replay position"
            labelText="Replay position"
            hideTextInput
            min={0}
            max={timeline.virtualDurationSec}
            step={0.1}
            stepMultiplier={5}
            value={scrub}
            formatLabel={v => {
              const s = sample(timeline, v);
              return s ? readoutValues(timeline, s).time : '';
            }}
            onChange={({ value }) => clock.seekTo(Number(value))}
          />
        </div>
        <Tag type={stateType} className="replay-state" data-testid="replay-state">
          {stateLabel}
        </Tag>
        <Dropdown
          id={id ? `${id}-speed` : 'replay-speed'}
          className="replay-speed"
          size="md"
          titleText="Speed"
          hideLabel
          label="Speed"
          aria-label="Replay speed"
          items={[...SPEED_STEPS]}
          selectedItem={speed}
          itemToString={s => `${s}×`}
          onChange={({ selectedItem }) => {
            if (selectedItem != null) setSpeed(selectedItem);
          }}
        />
        <Checkbox
          id={id ? `${id}-follow` : 'replay-follow'}
          className="replay-follow"
          labelText="Follow aircraft"
          checked={follow}
          onChange={(_, { checked }) => setFollow(checked)}
        />
      </div>

      <div className="replay-readout" ref={readoutRef}>
        {READOUT_COLUMNS.map((col, i) => (
          <StructuredListWrapper key={i} isCondensed className="replay-readout-list" aria-label="Replay readout">
            <StructuredListBody>
              {col.map(({ field, label }) => (
                <StructuredListRow key={field}>
                  <StructuredListCell noWrap className="replay-readout-label">{label}</StructuredListCell>
                  <StructuredListCell className="replay-value" data-field={field}>
                    {initial[field]}
                  </StructuredListCell>
                </StructuredListRow>
              ))}
            </StructuredListBody>
          </StructuredListWrapper>
        ))}
      </div>
    </section>
  );
}
