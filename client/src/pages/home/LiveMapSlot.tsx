import type { Status } from '../../mock/types';
import { LiveMap } from '../../components/maps';

/** The Home live map: a spacer above and the Leaflet map filling the panel width. */
export function LiveMapSlot({ status }: { status: Status }) {
  return (
    <div data-testid="live-map-slot" style={{ marginTop: '1rem' }}>
      <LiveMap status={status} height="20rem" />
    </div>
  );
}
