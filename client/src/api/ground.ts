import { apiFetch } from '../utils/api';
import { notifyMutation } from './mutations';
import type { CurrentGroundSessionResponse, GroundSession } from '../types';

export function getCurrentGroundSession(): Promise<CurrentGroundSessionResponse> {
  return apiFetch<CurrentGroundSessionResponse>('/api/ground-sessions/current');
}

/**
 * A field left out of `input` entirely leaves the stored value alone; the
 * caller must only send a field the operator actually touched. Returns the
 * created session, not the /current envelope — re-fetch
 * getCurrentGroundSession() afterwards, as the live client does.
 */
export async function setGroundSession(input: {
  icao: string;
  parking_position?: string | null;
  planned_leg_id?: number | null;
}): Promise<GroundSession> {
  const session = await apiFetch<GroundSession>('/api/ground-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  notifyMutation();
  return session;
}
