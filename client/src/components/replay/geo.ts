// Antimeridian handling for the replay timeline: shifts each longitude by a multiple
// of 360 degrees so consecutive points never differ by more than 180 degrees.

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
