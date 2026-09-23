import { Tile } from '@carbon/react';
import type { Status } from '../../mock/types';

/**
 * Where the live map goes. Deliberately a placeholder Tile: the Leaflet map
 * replaces this component's body and keeps the same `status` prop.
 */
export function LiveMapSlot({ status }: { status: Status }) {
  const { frame } = status;
  return (
    <Tile
      data-testid="live-map-slot"
      style={{
        marginTop: '1rem',
        minHeight: '16rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--cds-layer-accent-01)',
        color: 'var(--cds-text-secondary)',
        textAlign: 'center',
      }}
    >
      <div>
        <div style={{ fontSize: '0.875rem' }}>Live map</div>
        {frame && (
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", marginTop: '0.25rem' }}>
            {frame.lat.toFixed(3)}, {frame.lon.toFixed(3)}
          </div>
        )}
      </div>
    </Tile>
  );
}
