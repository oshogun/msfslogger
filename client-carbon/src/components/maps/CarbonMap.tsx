import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './CarbonMap.scss';

type LatLng = [number, number];

/**
 * Standard OpenStreetMap tiles are light; this single filter darkens the tile
 * pane (and nothing else) to sit on Gray 100. Applied through a CSS custom
 * property read by `.sabia-map .leaflet-tile-pane`.
 */
export const TILE_DARK_FILTER = 'invert(1) hue-rotate(180deg) brightness(0.92) contrast(0.9)';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export interface CarbonMapProps {
  /** Initial centre. Overlays such as `FlightMap` refit afterwards. */
  center: LatLng;
  /** Initial zoom. Default 10. */
  zoom?: number;
  /** CSS height of the map slot. Default `'24rem'`. The width is always 100% of the parent. */
  height?: string;
  /** Leaflet's own +/- control, restyled. Default true. */
  zoomControl?: boolean;
  /** Draw vectors on a canvas. Default true. */
  preferCanvas?: boolean;
  /** Extra class on the wrapper element. */
  className?: string;
  /** Test hook / a11y label for the wrapper. */
  'data-testid'?: string;
  /**
   * Overlay layers. Anything react-leaflet renders (`Polyline`, `Marker`,
   * `Tooltip`, custom components calling `useMap()`) goes here, and is rendered
   * above the tile layer. Never give an overlay a z-index above 1000.
   */
  children?: ReactNode;
}

/** Re-measures the map whenever its box changes size (side nav, window, tabs). */
function ResizeSync() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

/**
 * The one Leaflet host every Carbon map composes: sizing slot, dark tiles,
 * stacking isolation, resize handling. Wrap overlay layers as children.
 */
export function CarbonMap({
  center, zoom = 10, height = '24rem', zoomControl = true, preferCanvas = true, className, children,
  'data-testid': testId,
}: CarbonMapProps) {
  const style = { height, '--sabia-map-tile-filter': TILE_DARK_FILTER } as CSSProperties;
  return (
    <div className={['sabia-map', className].filter(Boolean).join(' ')} style={style} data-testid={testId}>
      <MapContainer center={center} zoom={zoom} preferCanvas={preferCanvas} zoomControl={zoomControl}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={18} />
        <ResizeSync />
        {children}
      </MapContainer>
    </div>
  );
}

/**
 * Shifts each longitude by a multiple of 360 so consecutive points never
 * differ by more than 180 degrees; a dateline-crossing planned route then
 * draws the short way round.
 */
export function unwrapLonChain(points: LatLng[]): LatLng[] {
  if (points.length === 0) return points;
  const out: LatLng[] = [points[0]];
  let prevLon = points[0][1];
  for (let i = 1; i < points.length; i++) {
    const lat = points[i][0];
    let lon = points[i][1];
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    out.push([lat, lon]);
    prevLon = lon;
  }
  return out;
}

/** A cheap fingerprint of the coordinates (~1 m rounding) so equal arrays compare equal. */
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
const FIT_GUARD_MS = 100;

/**
 * Fits the map to `points` on mount and whenever the points themselves change.
 * A parent re-render that rebuilds the array with the same coordinates does not
 * refit. Once the user has moved or zoomed the map (wheel, buttons, pinch, drag,
 * double-click, keyboard) no automatic refit happens again for the life of the
 * map. Movement that follows no user gesture does not count.
 */
export function useFitBoundsOnChange(map: L.Map, points: readonly LatLng[], padding: [number, number]): void {
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

    // Leaflet may raise start events after fitBounds has returned, so one only
    // counts when the user just gestured and it is not the tail of our own fit.
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
