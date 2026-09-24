import type { PlannedLegWithChildren } from '../../../types';
import {
  detailTargets,
  FetchDetailPrompt,
  geometryHasChains,
  procedureNote,
  RouteGeometryLayer,
  useRouteGeometry,
} from '../RouteGeometryLayer';
import { unwrapLonChain } from '../../../utils/geo';

/**
 * Child of a FlightMap: fetches the expanded route (SID, enroute, STAR,
 * approach) for `leg` and draws it, with the fetch-detail prompt for any
 * airport whose procedures could not be drawn. Draws nothing until the
 * replica reports itself present and the answer has chains.
 */
export function RouteGeometryOverlay({ leg }: { leg: PlannedLegWithChildren }) {
  const { geometries } = useRouteGeometry([leg.id]);
  const geometry = geometries[leg.id] ?? null;
  const sorted = leg.waypoints.slice().sort((a, b) => a.seq - b.seq);
  const anchor = unwrapLonChain(sorted.map(w => [w.lat, w.lon] as [number, number]))[0] ?? null;
  const label = `Planned route: ${leg.departure_ident} → ${leg.destination_ident}`;
  return (
    <>
      {geometry && geometryHasChains(geometry) && (
        <RouteGeometryLayer
          legId={leg.id}
          legSeq={leg.seq}
          geometry={geometry}
          label={label}
          note={procedureNote(leg, geometry)}
          anchor={anchor}
        />
      )}
      <FetchDetailPrompt targets={detailTargets(geometry)} />
    </>
  );
}
