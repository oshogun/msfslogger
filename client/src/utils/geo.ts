// ── Shared client geo helpers ─────────────────────────────────────────────────
//
// One home for `unwrapLonChain`, so the next map component that draws a planned
// route does not start a third copy. TripMap.tsx (T-008) and FlightMap.tsx
// (T-017) both import this rather than keeping their own — the antimeridian fix
// is the one piece of client geometry where a wrong answer still looks entirely
// plausible on screen, and it only surfaces on the long-haul trips this feature
// is aimed at, so it must not be able to drift between two copies.

/**
 * Antimeridian handling for planned routes (design.md DoD 7).
 *
 * A planned leg's waypoint chain is naturally ordered (seq ASC), so instead of
 * accepting Leaflet's default — which draws the straight line between raw
 * ±180° longitudes and visibly wraps the wrong way round the world for a
 * dateline-crossing leg — each chain is "unwrapped": every point's longitude is
 * shifted by a multiple of 360° so it never differs from the previous point by
 * more than 180°. Leaflet's default CRS projects longitude linearly with no
 * ±180 clamp, and the default tile layer (`noWrap` not set) already tiles
 * modulo 360°, so an unwrapped value like 190° renders as the correct imagery
 * just east of the dateline. This is the standard technique for this problem
 * and needs no extra dependency.
 *
 * This is applied only to the planned-route layer. Flown tracks are unchanged
 * — they never unwrap — which is a pre-existing limitation this feature does
 * not extend to, and is why pixel-comparable rendering when there are no
 * planned legs holds trivially: that code path is untouched.
 */
export function unwrapLonChain(points: [number, number][]): [number, number][] {
  if (points.length === 0) return points;
  const out: [number, number][] = [points[0]];
  let prevLon = points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [lat] = points[i];
    let lon = points[i][1];
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    out.push([lat, lon]);
    prevLon = lon;
  }
  return out;
}

/**
 * Threads `unwrapLonChain`'s continuity across a sequence of chains that are
 * drawn as separate polylines (one per leg, one per flight) but together
 * represent a single ordered route. Calling `unwrapLonChain` on each chain
 * independently only prevents a >180° jump *within* that chain — every chain
 * starts its own reference at its own first point, so on a route with an odd
 * number of dateline crossings between two chains (e.g. one leg ending just
 * past the antimeridian, the next starting there), the two land exactly 360°
 * apart even though they share an endpoint. A circumnavigation with several
 * legs near the dateline can drift like this repeatedly, scattering chains
 * across multiple world-copies. Threading a running reference longitude
 * across chain boundaries — as if every chain were one continuous route —
 * fixes that while still returning one array per input chain, so callers
 * that render each chain as its own `Polyline` are unaffected.
 */
export function unwrapLonChains(chains: [number, number][][]): [number, number][][] {
  const out: [number, number][][] = [];
  let prevLon: number | null = null;
  for (const chain of chains) {
    if (chain.length === 0) {
      out.push(chain);
      continue;
    }
    const unwrapped: [number, number][] = [];
    for (const [lat, lon0] of chain) {
      let lon = lon0;
      if (prevLon !== null) {
        while (lon - prevLon > 180) lon -= 360;
        while (lon - prevLon < -180) lon += 360;
      }
      unwrapped.push([lat, lon]);
      prevLon = lon;
    }
    out.push(unwrapped);
  }
  return out;
}
