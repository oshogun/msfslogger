import { useId, useLayoutEffect, useRef, useState } from 'react';
import { formatAlt } from '../../utils/format';
import type { FlightPoint } from '../../types';
import './AltitudeChart.scss';

interface Props {
  points: FlightPoint[];
}

const PAD = { top: 16, right: 16, bottom: 44, left: 64 };

/** Round-number tick values covering [lo, hi], about `target` of them. */
function niceTicks(lo: number, hi: number, target: number): number[] {
  const span = hi - lo || 1;
  const raw = span / Math.max(1, target - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find(m => m * mag >= raw) ?? 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v < hi + step - 1e-9; v += step) {
    ticks.push(Math.round(v * 100) / 100);
    if (v >= hi) break;
  }
  return ticks;
}

/** HH:MMZ, UTC, as the replay readout shows time of day. */
function clock(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}

/**
 * Altitude against time for one flight. The svg's viewBox is the container's
 * measured pixel size, so it is drawn at 1:1 and text is never scaled.
 */
export function AltitudeChart({ points }: Props) {
  // useId() emits colons (":r0:"), which are not safe inside a CSS url(#...) reference
  const gradId = `alt-grad-${useId().replace(/:/g, '')}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [points.length < 2]);

  if (points.length < 2) return null;

  const W = width;
  const H = W >= 1200 ? 280 : 240;
  const alts = points.map(p => p.altitude_ft);
  const maxAlt = Math.max(...alts);
  const minAlt = Math.min(...alts);
  const ticks = niceTicks(minAlt, maxAlt, W < 480 ? 3 : 5);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1] || lo + 1;
  const plotW = W - PAD.left - PAD.right;
  const plotBottom = H - PAD.bottom;

  const xScale = (i: number) => PAD.left + (i / (points.length - 1)) * plotW;
  const yScale = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (plotBottom - PAD.top);

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(p.altitude_ft).toFixed(1)}`).join(' ');
  const areaD = `${pathD} L${xScale(points.length - 1).toFixed(1)},${plotBottom} L${PAD.left},${plotBottom} Z`;
  const mid = points[Math.floor((points.length - 1) / 2)];
  const xLabels: { x: number; text: string; anchor: 'start' | 'middle' | 'end' }[] = [
    { x: PAD.left, text: clock(points[0].ts), anchor: 'start' },
    { x: PAD.left + plotW / 2, text: clock(mid.ts), anchor: 'middle' },
    { x: PAD.left + plotW, text: clock(points[points.length - 1].ts), anchor: 'end' },
  ];

  return (
    <div ref={wrapRef} className="altitude-chart-wrap">
      {W > 0 && (
        <svg
          className="altitude-chart"
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Altitude profile, ${formatAlt(minAlt)} to ${formatAlt(maxAlt)} ft, ${clock(points[0].ts)} to ${clock(points[points.length - 1].ts)}`}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop className="altitude-chart__stop altitude-chart__stop--top" offset="0%" />
              <stop className="altitude-chart__stop altitude-chart__stop--bottom" offset="100%" />
            </linearGradient>
          </defs>
          {ticks.map(t => (
            <g key={t}>
              <line className="altitude-chart__grid" x1={PAD.left} x2={PAD.left + plotW} y1={yScale(t)} y2={yScale(t)} />
              <text className="altitude-chart__label" x={PAD.left - 8} y={yScale(t)} textAnchor="end" dominantBaseline="middle">{formatAlt(t)}</text>
            </g>
          ))}
          <path d={areaD} fill={`url(#${gradId})`} />
          <path className="altitude-chart__line" d={pathD} fill="none" strokeWidth="2" />
          {xLabels.map(l => (
            <text key={l.anchor} className="altitude-chart__label" x={l.x} y={plotBottom + 16} textAnchor={l.anchor}>{l.text}</text>
          ))}
          <text className="altitude-chart__label" x={PAD.left + plotW / 2} y={H - 6} textAnchor="middle">Time</text>
          <text className="altitude-chart__label" x={12} y={(PAD.top + plotBottom) / 2} textAnchor="middle" transform={`rotate(-90,12,${(PAD.top + plotBottom) / 2})`}>ft</text>
        </svg>
      )}
    </div>
  );
}
