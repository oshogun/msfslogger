import { useEffect, useState } from 'react';
import type { LiveStatusView } from './AppShell';
import { failing, subscribeStatus } from '../mock/api';
import type { Status } from '../mock/types';

/** Same wording the production header uses, mapped onto Carbon Tag colours. */
export function statusToView(s: Status): LiveStatusView {
  if (!s.connected) return { type: 'gray', label: 'Sim not connected' };
  if (s.flightState === 'FLYING') {
    return s.paused
      ? { type: 'magenta', label: `Paused · ${s.aircraft ?? 'Unknown'}` }
      : { type: 'green', label: `Recording · ${s.aircraft ?? 'Unknown'}` };
  }
  if (s.flightState === 'GROUND') {
    return { type: 'gray', label: `On ground · ${s.groundSession?.airportIcao ?? s.aircraft ?? 'Unknown'}` };
  }
  return { type: 'blue', label: 'Connected · Idle' };
}

/** Live-status view for the header Tag, fed by the mock scripted status poll. */
export function useLiveStatus(): LiveStatusView {
  const [view, setView] = useState<LiveStatusView>({ type: 'gray', label: 'Checking…' });
  useEffect(() => {
    // `?fail=live` silences the poll; show the same state the live header does
    // when the server cannot be reached.
    if (failing('live')) {
      setView({ type: 'red', label: 'Server unreachable' });
      return;
    }
    return subscribeStatus(s => setView(statusToView(s)));
  }, []);
  return view;
}
