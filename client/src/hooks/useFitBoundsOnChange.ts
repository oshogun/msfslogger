import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { Map as LeafletMap } from 'leaflet';

type LatLng = [number, number];

/**
 * A cheap fingerprint of the coordinates (rounded to ~1 m, FNV-1a over the
 * values) so two arrays holding the same points compare equal even when they
 * are different objects.
 */
export function pointsSignature(points: readonly LatLng[]): string {
  let h = 0x811c9dc5;
  for (const [lat, lon] of points) {
    for (const v of [Math.round(lat * 1e5), Math.round(lon * 1e5)]) {
      h ^= v | 0;
      h = Math.imul(h, 0x01000193);
    }
  }
  return `${points.length}:${(h >>> 0).toString(16)}`;
}

const GESTURE_WINDOW_MS = 1000;
// Longest we keep ignoring start events after our own fit, if moveend never arrives.
const FIT_GUARD_MS = 100;

/**
 * Fits the map to `points` on mount and whenever the points themselves change.
 * A parent re-render that rebuilds the array with the same coordinates does not
 * refit, so a zoom or pan the user made is left alone. Once the user has moved
 * or zoomed the map (wheel, buttons, pinch, drag, double-click, keyboard), no
 * automatic refit happens again for the life of the map, even if more points
 * arrive. Movement that follows no user gesture, such as a popup opening and
 * panning the map, does not count.
 */
export function useFitBoundsOnChange(
  map: LeafletMap,
  points: readonly LatLng[],
  padding: [number, number],
): void {
  const latest = useRef(points);
  latest.current = points;
  const userMoved = useRef(false);
  const fitting = useRef(false);
  const fitGuard = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    userMoved.current = false;
    const container = map.getContainer();
    let lastGesture = -Infinity;
    let pointerDown = false;
    const stamp = () => {
      lastGesture = Date.now();
    };
    const onDown = () => {
      pointerDown = true;
      stamp();
    };
    const onUp = () => {
      pointerDown = false;
    };
    const gestureEvents = ['wheel', 'dblclick', 'keydown'] as const;
    const downEvents = ['mousedown', 'touchstart'] as const;
    const upEvents = ['mouseup', 'touchend', 'touchcancel'] as const;
    gestureEvents.forEach(n => container.addEventListener(n, stamp, true));
    downEvents.forEach(n => container.addEventListener(n, onDown, true));
    upEvents.forEach(n => window.addEventListener(n, onUp, true));

    // Leaflet may raise these after fitBounds has returned (animated moves run
    // in a later frame), so a start event only counts when the user just
    // gestured on the map and it is not the tail of our own fit.
    const onStart = () => {
      if (fitting.current) return;
      if (pointerDown || Date.now() - lastGesture < GESTURE_WINDOW_MS) userMoved.current = true;
    };
    const onEnd = () => {
      fitting.current = false;
    };
    map.on('movestart zoomstart', onStart);
    map.on('moveend', onEnd);
    return () => {
      map.off('movestart zoomstart', onStart);
      map.off('moveend', onEnd);
      gestureEvents.forEach(n => container.removeEventListener(n, stamp, true));
      downEvents.forEach(n => container.removeEventListener(n, onDown, true));
      upEvents.forEach(n => window.removeEventListener(n, onUp, true));
      if (fitGuard.current) clearTimeout(fitGuard.current);
    };
  }, [map]);

  const signature = pointsSignature(points);
  const [padX, padY] = padding;
  useEffect(() => {
    const pts = latest.current;
    if (pts.length === 0 || userMoved.current) return;
    fitting.current = true;
    if (fitGuard.current) clearTimeout(fitGuard.current);
    fitGuard.current = setTimeout(() => {
      fitting.current = false;
    }, FIT_GUARD_MS);
    map.fitBounds(L.latLngBounds(pts as LatLng[]), { padding: [padX, padY], animate: false });
  }, [map, signature, padX, padY]);
}
