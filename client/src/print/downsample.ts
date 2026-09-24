import type { FlightPoint } from '../types';

/**
 * Uniform stride sampling. Cheap, and good enough for a map polyline where the
 * eye only sees the overall shape. First and last points are always kept so the
 * departure/arrival markers stay exactly on the recorded coordinates.
 */
export function strideSample<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints || maxPoints < 2) return points;

  const step = (points.length - 1) / (maxPoints - 1);
  const out: T[] = [];
  for (let i = 0; i < maxPoints - 1; i++) {
    out.push(points[Math.round(i * step)]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Largest-Triangle-Three-Buckets downsampling.
 *
 * Unlike stride sampling this preserves visual peaks and troughs, which matters
 * for the altitude profile — a naive stride can step straight over the cruise
 * ceiling or a brief descent and visibly flatten the chart.
 */
export function lttb(points: FlightPoint[], maxPoints: number): FlightPoint[] {
  if (points.length <= maxPoints || maxPoints < 3) return points;

  const bucketSize = (points.length - 2) / (maxPoints - 2);
  const sampled: FlightPoint[] = [points[0]];
  let prev = 0;

  for (let i = 0; i < maxPoints - 2; i++) {
    const rangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, points.length - 1);

    // Average of the *next* bucket forms the third vertex of the triangle
    let avgX = 0;
    let avgY = 0;
    const avgRangeStart = rangeEnd;
    const avgRangeEnd = Math.min(Math.floor((i + 3) * bucketSize) + 1, points.length);
    const avgCount = Math.max(avgRangeEnd - avgRangeStart, 1);
    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += j;
      avgY += points[j].altitude_ft;
    }
    avgX /= avgCount;
    avgY /= avgCount;

    let maxArea = -1;
    let chosen = rangeStart;
    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs(
        (prev - avgX) * (points[j].altitude_ft - points[prev].altitude_ft) -
        (prev - j) * (avgY - points[prev].altitude_ft)
      );
      if (area > maxArea) {
        maxArea = area;
        chosen = j;
      }
    }

    sampled.push(points[chosen]);
    prev = chosen;
  }

  sampled.push(points[points.length - 1]);
  return sampled;
}

export const MAP_MAX_POINTS = 2000;
export const CHART_MAX_POINTS = 800;
