import { useState, useEffect } from 'react';
import { fetchNavdataStatus } from '../utils/navdataApi';
import type { NavdataStatusResponse } from '../types';

const REFRESH_MS = 60_000;

/**
 * The navdata replica's status, fetched on mount and every minute. `null`
 * until the first answer, and after a failed fetch with nothing cached: a map
 * treats that the same as `present: false` and shows no navdata controls.
 */
export function useNavdataStatus(enabled = true): NavdataStatusResponse | null {
  const [status, setStatus] = useState<NavdataStatusResponse | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const controller = new AbortController();

    async function poll() {
      try {
        const s = await fetchNavdataStatus(controller.signal);
        if (!cancelled) setStatus(s);
      } catch {
        // Keep the last known status; the next tick tries again.
      }
      if (!cancelled) timeoutId = setTimeout(poll, REFRESH_MS);
    }

    poll();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [enabled]);

  return status;
}
