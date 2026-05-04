import { formatAlt } from '../utils/format';
import type { FlightPoint } from '../types';

const W = 900;
const H = 140;
const PAD = { top: 16, right: 12, bottom: 28, left: 48 };

interface Props {
  points: FlightPoint[];
}

export function AltitudeChart({ points }: Props) {
  if (points.length < 2) return null;

  const alts = points.map(p => p.altitude_ft);
  const maxAlt = Math.max(...alts);
  const minAlt = Math.min(...alts);
  const range = maxAlt - minAlt || 1;

  const xScale = (i: number) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
  const yScale = (v: number) => PAD.top + (1 - (v - minAlt) / range) * (H - PAD.top - PAD.bottom);

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(p.altitude_ft).toFixed(1)}`).join(' ');
  const areaD = `${pathD} L${xScale(points.length - 1).toFixed(1)},${(H - PAD.bottom).toFixed(1)} L${PAD.left},${(H - PAD.bottom).toFixed(1)} Z`;

  return (
    <svg
      id="altitude-chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#grad)" />
      <path d={pathD} fill="none" stroke="#60a5fa" strokeWidth="1.8" />
      <text x={PAD.left - 6} y={yScale(maxAlt).toFixed(1)} fill="#64748b" fontSize="10" textAnchor="end" dominantBaseline="middle">{formatAlt(maxAlt)}</text>
      <text x={PAD.left - 6} y={yScale(minAlt).toFixed(1)} fill="#64748b" fontSize="10" textAnchor="end" dominantBaseline="middle">{formatAlt(minAlt)}</text>
      <text x={W / 2} y={H - 4} fill="#64748b" fontSize="10" textAnchor="middle">Time</text>
      <text x={PAD.left - 36} y={H / 2} fill="#64748b" fontSize="10" textAnchor="middle" transform={`rotate(-90,${PAD.left - 36},${H / 2})`}>ft</text>
    </svg>
  );
}
