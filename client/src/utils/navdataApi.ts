import { apiFetch, UnauthorizedError } from './api';
import type {
  FeaturesResponse,
  NavdataRequestBody,
  NavdataRequestResponse,
  NavdataStatusResponse,
} from '../types';

export type NavdataKind = 'airports' | 'navaids' | 'waypoints' | 'airways' | 'runways';

/** [west, south, east, north]; west > east means the view crosses the antimeridian. */
export type Bbox = [number, number, number, number];

/** The replica is mid-swap. Not a failure: keep what is drawn and retry. */
export class NavdataBusyError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Navdata is updating');
    this.name = 'NavdataBusyError';
  }
}

function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * Pads a Leaflet view by 20% and folds it into the server's [-180,180]
 * convention. A view that has been panned past the dateline reports longitudes
 * outside that range; folding them yields west > east, which the server splits
 * into two ranges. A view 360° or wider clamps to the whole world.
 */
export function paddedBbox(b: { west: number; south: number; east: number; north: number }): Bbox {
  const padLon = (b.east - b.west) * 0.2;
  const padLat = (b.north - b.south) * 0.2;
  const south = Math.max(-90, b.south - padLat);
  const north = Math.min(90, b.north + padLat);
  const west = b.west - padLon;
  const east = b.east + padLon;
  if (east - west >= 360) return [-180, south, 180, north];
  const w = wrapLon(west);
  let e = wrapLon(east);
  if (e === -180) e = 180;
  return [w, south, e, north];
}

export async function fetchNavdataStatus(signal?: AbortSignal): Promise<NavdataStatusResponse> {
  return apiFetch<NavdataStatusResponse>('/api/navdata/status', { signal });
}

export async function fetchNavdataFeatures(
  bbox: Bbox,
  zoom: number,
  kinds: NavdataKind[],
  signal?: AbortSignal
): Promise<FeaturesResponse> {
  const params = new URLSearchParams({
    bbox: bbox.map(v => v.toFixed(5)).join(','),
    zoom: String(Math.round(zoom)),
    kinds: kinds.join(','),
  });
  const res = await fetch(`/api/navdata/features?${params}`, { signal });
  if (res.status === 503) {
    const retry = Number(res.headers.get('Retry-After'));
    throw new NavdataBusyError(Number.isFinite(retry) && retry > 0 ? retry : 2);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const message = (body as { error?: string }).error || res.statusText;
    if (res.status === 401) throw new UnauthorizedError(message);
    throw new Error(message);
  }
  return res.json() as Promise<FeaturesResponse>;
}

export async function requestNavdata(body: NavdataRequestBody): Promise<NavdataRequestResponse> {
  return apiFetch<NavdataRequestResponse>('/api/navdata/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
