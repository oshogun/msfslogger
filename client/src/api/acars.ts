import { apiFetch } from '../utils/api';
import { notifyMutation } from './mutations';
import type { AcarsMessage, CannedAcarsMessageList, SayIntentionsLink, SayIntentionsLinkStatus } from '../types';

/** Which thread an ACARS call addresses. */
export type AcarsScope = { flightId: number } | { legId: number };

/** The base acars-messages path for a scope, flight- or leg-rooted. */
function scopeBase(scope: AcarsScope): string {
  return 'flightId' in scope
    ? `/api/flights/${scope.flightId}/acars-messages`
    : `/api/planned-legs/${scope.legId}/acars-messages`;
}

export function getFlightAcars(flightId: number): Promise<{
  flight_id: number; planned_leg_id: number | null; messages: AcarsMessage[];
}> {
  return apiFetch(`/api/flights/${flightId}/acars-messages`);
}

export function getPlannedLegAcars(legId: number): Promise<{
  planned_leg_id: number; messages: AcarsMessage[];
}> {
  return apiFetch(`/api/planned-legs/${legId}/acars-messages`);
}

export function listCannedMessages(): Promise<CannedAcarsMessageList> {
  return apiFetch<CannedAcarsMessageList>('/api/acars/canned-messages');
}

export async function sendCannedAcars(scope: AcarsScope, cannedId: string): Promise<AcarsMessage> {
  const message = await apiFetch<AcarsMessage>(scopeBase(scope), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ canned_id: cannedId }),
  });
  notifyMutation();
  return message;
}

export async function requestWx(
  scope: AcarsScope, icao: string,
): Promise<{ request: AcarsMessage; reply: AcarsMessage }> {
  const result = await apiFetch<{ request: AcarsMessage; reply: AcarsMessage }>(`${scopeBase(scope)}/wx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ icao }),
  });
  notifyMutation();
  return result;
}

/**
 * Takes a planned-leg id, never a flight id — there is no flight-scoped
 * route on the server. `created: false` means the same stored pair came
 * back, so the caller must merge by id and re-sort rather than push.
 */
export async function requestAcarsPair(
  plannedLegId: number, kind: 'loadsheet' | 'clearance',
): Promise<{ created: boolean; request: AcarsMessage; reply: AcarsMessage }> {
  const result = await apiFetch<{ created: boolean; request: AcarsMessage; reply: AcarsMessage }>(
    `/api/planned-legs/${plannedLegId}/acars-messages/${kind}`,
    { method: 'POST' },
  );
  notifyMutation();
  return result;
}

/** Swallows its own failure to null rather than failing the page. */
export async function getSayIntentionsLink(flightId: number): Promise<SayIntentionsLinkStatus | null> {
  try {
    return await apiFetch<SayIntentionsLinkStatus>(`/api/flights/${flightId}/sayintentions/link`);
  } catch {
    return null;
  }
}

export async function linkSayIntentions(flightId: number): Promise<{
  link: SayIntentionsLink; pending_messages: number;
}> {
  const result = await apiFetch<{ link: SayIntentionsLink; pending_messages: number }>(
    `/api/flights/${flightId}/sayintentions/link`,
    { method: 'POST' },
  );
  notifyMutation();
  return result;
}

export async function unlinkSayIntentions(flightId: number): Promise<{
  flight_id: number; unlinked: boolean;
}> {
  const result = await apiFetch<{ flight_id: number; unlinked: boolean }>(
    `/api/flights/${flightId}/sayintentions/link`,
    { method: 'DELETE' },
  );
  notifyMutation();
  return result;
}

export async function importSayIntentions(flightId: number): Promise<{
  imported: number; messages: AcarsMessage[];
}> {
  const result = await apiFetch<{ imported: number; messages: AcarsMessage[] }>(
    `/api/flights/${flightId}/sayintentions/import`,
    { method: 'POST' },
  );
  notifyMutation();
  return result;
}

export async function pushClearanceToSayIntentions(legId: number): Promise<{ message: AcarsMessage }> {
  const result = await apiFetch<{ message: AcarsMessage }>(
    `/api/planned-legs/${legId}/sayintentions/clearance`,
    { method: 'POST' },
  );
  notifyMutation();
  return result;
}
