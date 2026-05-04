import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import type { Status } from '../types';

export function useStatus(): { status: Status | null; serverError: boolean } {
  const [status, setStatus] = useState<Status | null>(null);
  const [serverError, setServerError] = useState(false);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function poll() {
      try {
        const s = await apiFetch<Status>('/api/status');
        if (cancelled) return;
        setStatus(s);
        setServerError(false);
        timeoutId = setTimeout(poll, s.flightState === 'FLYING' ? 1000 : 3000);
      } catch {
        if (cancelled) return;
        setServerError(true);
        timeoutId = setTimeout(poll, 3000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  return { status, serverError };
}
