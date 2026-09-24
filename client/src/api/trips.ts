import { apiFetch } from '../utils/api';
import { notifyMutation } from './mutations';
import type { ActiveTrip, Journey, Trip } from '../types';

/** `planned_legs` on every element is always []; only getTrip populates it. */
export function listTrips(): Promise<Trip[]> {
  return apiFetch<Trip[]>('/api/trips');
}

export function getTrip(id: number): Promise<Trip> {
  return apiFetch<Trip>(`/api/trips/${id}`);
}

export async function createTrip(name: string): Promise<{ id: number }> {
  const result = await apiFetch<{ id: number }>('/api/trips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  notifyMutation();
  return result;
}

export async function patchTrip(
  id: number, patch: Partial<Pick<Trip, 'name' | 'notes'>>,
): Promise<Trip> {
  const trip = await apiFetch<Trip>(`/api/trips/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  notifyMutation();
  return trip;
}

export async function deleteTrip(id: number): Promise<void> {
  await apiFetch(`/api/trips/${id}`, { method: 'DELETE' });
  notifyMutation();
}

export async function addFlightToTrip(tripId: number, flightId: number): Promise<void> {
  await apiFetch(`/api/trips/${tripId}/flights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flightId }),
  });
  notifyMutation();
}

export async function removeFlightFromTrip(tripId: number, flightId: number): Promise<void> {
  await apiFetch(`/api/trips/${tripId}/flights/${flightId}`, { method: 'DELETE' });
  notifyMutation();
}

export async function setActiveTrip(tripId: number | null): Promise<ActiveTrip> {
  const active = await apiFetch<ActiveTrip>('/api/active-trip', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tripId }),
  });
  notifyMutation();
  return active;
}

export function getJourney(tripId: number): Promise<Journey> {
  return apiFetch<Journey>(`/api/trips/${tripId}/journey`);
}
