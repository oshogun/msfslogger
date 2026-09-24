import { apiFetch } from '../utils/api';
import { notifyMutation } from './mutations';
import type { Flight, PlannedLegWithChildren } from '../types';

export function listFlights(): Promise<Flight[]> {
  return apiFetch<Flight[]>('/api/flights');
}

export function getFlight(id: number): Promise<Flight> {
  return apiFetch<Flight>(`/api/flights/${id}`);
}

export async function patchFlight(
  id: number, patch: Partial<Pick<Flight, 'aircraft' | 'notes'>>,
): Promise<Flight> {
  const flight = await apiFetch<Flight>(`/api/flights/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  notifyMutation();
  return flight;
}

export async function deleteFlight(id: number): Promise<void> {
  await apiFetch(`/api/flights/${id}`, { method: 'DELETE' });
  notifyMutation();
}

export async function combineFlights(id1: number, id2: number): Promise<{ id: number }> {
  const result = await apiFetch<{ id: number }>('/api/flights/combine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id1, id2 }),
  });
  notifyMutation();
  return result;
}

export async function attachFlightPlan(flightId: number, file: File): Promise<Flight> {
  const formData = new FormData();
  formData.append('file', file);
  const flight = await apiFetch<Flight>(`/api/flights/${flightId}/flight-plan`, {
    method: 'POST',
    body: formData,
  });
  notifyMutation();
  return flight;
}

export async function removeFlightPlan(flightId: number): Promise<Flight> {
  const flight = await apiFetch<Flight>(`/api/flights/${flightId}/flight-plan`, { method: 'DELETE' });
  notifyMutation();
  return flight;
}

export async function linkFlightToLeg(flightId: number, legId: number | null): Promise<Flight> {
  const flight = await apiFetch<Flight>(`/api/flights/${flightId}/planned-leg`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plannedLegId: legId }),
  });
  notifyMutation();
  return flight;
}

export async function setFlightPlannedLegStatus(
  flightId: number, status: 'flown' | 'planned',
): Promise<PlannedLegWithChildren> {
  const leg = await apiFetch<PlannedLegWithChildren>(`/api/flights/${flightId}/planned-leg-status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  notifyMutation();
  return leg;
}
