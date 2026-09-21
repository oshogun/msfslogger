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

/**
 * Fits the map to `points` on mount and whenever the points themselves change.
 * A parent re-render that rebuilds the array with the same coordinates does not
 * refit, so a zoom or pan the user made is left alone. Once the user has moved
 * or zoomed the map (wheel, buttons, pinch, drag, double-click), no automatic
 * refit happens again for the life of the map, even if more points arrive.
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

  useEffect(() => {
    userMoved.current = false;
    // Leaflet raises movestart/zoomstart synchronously inside fitBounds, so the
    // flag only needs to cover the call itself to tell our moves from the user's.
    const onStart = () => {
      if (!fitting.current) userMoved.current = true;
    };
    map.on('movestart zoomstart', onStart);
    return () => {
      map.off('movestart zoomstart', onStart);
    };
  }, [map]);

  const signature = pointsSignature(points);
  const [padX, padY] = padding;
  useEffect(() => {
    const pts = latest.current;
    if (pts.length === 0 || userMoved.current) return;
    fitting.current = true;
    try {
      map.fitBounds(L.latLngBounds(pts as LatLng[]), { padding: [padX, padY] });
    } finally {
      fitting.current = false;
    }
  }, [map, signature, padX, padY]);
}
