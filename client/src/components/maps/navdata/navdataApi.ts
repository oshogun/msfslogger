import {
  failing,
  getNavdataFeatures,
  getNavdataStatus,
  getRouteGeometry,
  MOCK_LATENCY_MS,
} from '../../../mock/api';
import type {
  FeaturesResponse,
  NavdataRequestBody,
  NavdataRequestResponse,
  NavdataStatusResponse,
  RouteGeometryResponse,
} from '../../../mock/types';

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

export async function fetchNavdataStatus(_signal?: AbortSignal): Promise<NavdataStatusResponse> {
  return getNavdataStatus();
}

/**
 * Features for a view, from the mock accessor. Kinds that were not asked for
 * come back empty, as the server's `kinds` parameter does; the mock answers a
 * view cropped to `bbox` (west > east is not split, the mock data has no
 * antimeridian features).
 */
export async function fetchNavdataFeatures(
  bbox: Bbox,
  zoom: number,
  kinds: NavdataKind[],
  signal?: AbortSignal
): Promise<FeaturesResponse> {
  const res = await getNavdataFeatures(bbox, Math.round(zoom));
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return {
    ...res,
    airports: kinds.includes('airports') ? res.airports : [],
    navaids: kinds.includes('navaids') ? res.navaids : [],
    waypoints: kinds.includes('waypoints') ? res.waypoints : [],
    airways: kinds.includes('airways') ? res.airways : [],
    runways: kinds.includes('runways') ? res.runways : [],
  };
}

/** No mock accessor exists for this write, so it answers here: `queued`, after the usual latency. */
export function requestNavdata(body: NavdataRequestBody): Promise<NavdataRequestResponse> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (failing('navdata') || failing('requestNavdata')) reject(new Error('Mock failure: navdata'));
      else resolve({ ok: true, state: 'queued', ident: body.ident });
    }, MOCK_LATENCY_MS);
  });
}

export async function fetchRouteGeometry(legId: number, _signal?: AbortSignal): Promise<RouteGeometryResponse> {
  return getRouteGeometry(legId);
}
