import { useEffect, useState } from 'react';
import { InlineLoading, InlineNotification } from '@carbon/react';
import { getFlight } from '../../mock/api';
import type { FlightPoint } from '../../mock/types';
import { AltitudeChart } from '../charts/AltitudeChart';
import { ReplayPanel } from './ReplayPanel';
import type { ReplaySample } from './replay';

/** Altitude chart and replay panel over the 600-point mock flight. */
export function ChartsReplayGallerySection() {
  const [points, setPoints] = useState<FlightPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<ReplaySample | null>(null);

  useEffect(() => {
    getFlight(1)
      .then(f => setPoints(f.points ?? []))
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <section id="charts-replay-gallery" aria-label="Altitude chart and replay">
      {error && <InlineNotification kind="error" title="Could not load flight" subtitle={error} hideCloseButton />}
      {!error && !points && <InlineLoading description="Loading flight" />}
      {points && (
        <>
          <h2 className="sabia-heading-03" style={{ marginTop: '2rem' }}>AltitudeChart</h2>
          <AltitudeChart points={points} />
          <h2 className="sabia-heading-03" style={{ marginTop: '2rem' }}>ReplayPanel</h2>
          <ReplayPanel id="gallery-replay" points={points} onPosition={s => setPos(s)} />
          <p data-testid="replay-position" style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
            {pos ? `marker ${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)} hdg ${Math.round(pos.headingDeg)} pt ${pos.pointIndex + 1}` : ''}
          </p>
        </>
      )}
    </section>
  );
}
