import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MapContainer } from 'react-leaflet';
import { ReplayMarker, newReplayBridge } from './ReplayMarker';
import type { ReplaySample } from '../../components/replay';

function sample(over: Partial<ReplaySample> = {}): ReplaySample {
  return {
    lat: 10, lon: 20, altitudeFt: 1000, airspeedKnots: 100, groundSpeedKnots: 100,
    headingDeg: 90, verticalSpeedFpm: 0, onGround: false, pointIndex: 0, segmentIndex: 0,
    inGap: false, gapRealSec: 0, realTimeMs: 0, virtualSec: 0,
    ...over,
  };
}

describe('ReplayMarker', () => {
  it('moves the marker and rotates its arrow as new samples arrive', () => {
    const bridge = newReplayBridge();
    const { container } = render(
      <MapContainer center={[10, 20]} zoom={10} style={{ height: 300, width: 300 }}>
        <ReplayMarker bridge={bridge} />
      </MapContainer>
    );

    bridge.sink?.(sample({ lat: 10, lon: 20, headingDeg: 90 }), false);
    const marker = container.querySelector<HTMLElement>('[data-replay-marker]');
    expect(marker).not.toBeNull();
    expect(marker!.dataset.lat).toBe('10.00000');
    expect(marker!.dataset.lon).toBe('20.00000');
    const arrow = marker!.firstElementChild as HTMLElement;
    expect(arrow.style.transform).toBe('rotate(90deg)');

    bridge.sink?.(sample({ lat: 11.5, lon: 21.5, headingDeg: 200 }), false);
    expect(marker!.dataset.lat).toBe('11.50000');
    expect(marker!.dataset.lon).toBe('21.50000');
    expect(arrow.style.transform).toBe('rotate(200deg)');
  });

  it('applies a sample already buffered on the bridge as soon as it mounts', () => {
    const bridge = newReplayBridge();
    bridge.last = sample({ lat: 5, lon: 6, headingDeg: 45 });
    bridge.follow = false;
    const { container } = render(
      <MapContainer center={[5, 6]} zoom={10} style={{ height: 300, width: 300 }}>
        <ReplayMarker bridge={bridge} />
      </MapContainer>
    );
    const marker = container.querySelector<HTMLElement>('[data-replay-marker]');
    expect(marker!.dataset.lat).toBe('5.00000');
    expect(marker!.dataset.lon).toBe('6.00000');
  });
});
