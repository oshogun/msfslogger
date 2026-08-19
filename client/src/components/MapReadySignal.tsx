import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

const POLL_MS = 100;
const IDLE_TICKS_REQUIRED = 3;
const HARD_TIMEOUT_MS = 8000;

interface Props {
  onReady?: () => void;
}

/**
 * Fires `onReady` once every tile layer has stopped loading.
 *
 * Used by the PDF export to know when a map is safe to capture. This polls
 * rather than listening for TileLayer's 'load' event because that event is
 * unreliable for our purpose: it can fire before this component mounts (cached
 * tiles), and `fitBounds` immediately requests a fresh viewport of tiles right
 * after it. Requiring several consecutive idle ticks avoids firing in the gap
 * between the initial load finishing and the post-fitBounds requests starting.
 *
 * The hard timeout guarantees an export can never hang on a stalled OSM tile.
 */
export function MapReadySignal({ onReady }: Props) {
  const map = useMap();

  useEffect(() => {
    if (!onReady) return;

    let done = false;
    let idleTicks = 0;

    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      onReady();
    };

    const interval = setInterval(() => {
      let loading = false;
      map.eachLayer(layer => {
        if (layer instanceof L.TileLayer && (layer as L.TileLayer & { _loading?: boolean })._loading) {
          loading = true;
        }
      });

      idleTicks = loading ? 0 : idleTicks + 1;
      if (idleTicks >= IDLE_TICKS_REQUIRED) finish();
    }, POLL_MS);

    const hardTimeout = setTimeout(finish, HARD_TIMEOUT_MS);

    function cleanup() {
      clearInterval(interval);
      clearTimeout(hardTimeout);
    }

    return cleanup;
  }, [map, onReady]);

  return null;
}
