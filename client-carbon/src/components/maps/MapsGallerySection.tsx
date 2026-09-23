import { useEffect, useState } from 'react';
import { InlineLoading } from '@carbon/react';
import { getFlight } from '../../mock/api';
import type { Flight } from '../../mock/types';
import { FlightMap } from './FlightMap';

/** Gallery block for the map components: a finished flight on a FlightMap. */
export function MapsGallerySection() {
  const [flight, setFlight] = useState<Flight | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getFlight(1).then(setFlight).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <h4 style={{ marginTop: '2rem' }}>FlightMap</h4>
      {error && <p style={{ color: 'var(--cds-text-error)' }}>{error}</p>}
      {!flight && !error && <InlineLoading description="Loading track" />}
      {flight && <FlightMap points={flight.points ?? []} height="20rem" />}
    </>
  );
}
