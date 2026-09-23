import { useEffect, useState } from 'react';
import { InlineLoading } from '@carbon/react';
import { getPlannedLeg, listPlannedLegs } from '../../../mock/api';
import type { PlannedLegWithChildren } from '../../../mock/types';
import { FlightMap } from '../FlightMap';
import { NavdataOverlay } from '../NavdataControls';
import { RouteGeometryOverlay } from './RouteGeometryOverlay';

/** Gallery block: a leg with a SID, STAR and approach on a FlightMap with the navdata controls and route geometry. */
export function NavdataGallerySection() {
  const [leg, setLeg] = useState<PlannedLegWithChildren | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPlannedLegs()
      .then(legs => {
        const withProcedures = legs.find(l => l.sid_name && l.star_name && l.approach_name);
        if (!withProcedures) throw new Error('No mock leg has a SID, STAR and approach');
        return getPlannedLeg(withProcedures.id);
      })
      .then(setLeg)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <h4 style={{ marginTop: '2rem' }}>Navdata layers and route geometry</h4>
      {error && <p style={{ color: 'var(--cds-text-error)' }}>{error}</p>}
      {!leg && !error && <InlineLoading description="Loading leg" />}
      {leg && (
        <FlightMap points={[]} plannedLeg={leg} height="28rem">
          <NavdataOverlay />
          <RouteGeometryOverlay leg={leg} />
        </FlightMap>
      )}
    </>
  );
}
