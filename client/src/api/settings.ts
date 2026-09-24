import { apiFetch } from '../utils/api';
import { notifyMutation } from './mutations';
import type { SayIntentionsSettings, SimbriefSettings } from '../types';

export function getSimbriefSettings(): Promise<SimbriefSettings> {
  return apiFetch<SimbriefSettings>('/api/settings/simbrief');
}

export async function saveSimbriefSettings(userId: string | null): Promise<SimbriefSettings> {
  const settings = await apiFetch<SimbriefSettings>('/api/settings/simbrief', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ simbrief_user_id: userId }),
  });
  notifyMutation();
  return settings;
}

export function getSayIntentionsSettings(): Promise<SayIntentionsSettings> {
  return apiFetch<SayIntentionsSettings>('/api/settings/sayintentions');
}

export async function saveSayIntentionsKey(key: string): Promise<SayIntentionsSettings> {
  const settings = await apiFetch<SayIntentionsSettings>('/api/settings/sayintentions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sayintentions_api_key: key }),
  });
  notifyMutation();
  return settings;
}

/** Not a separate endpoint: same route as saveSayIntentionsKey, null value. */
export async function clearSayIntentionsKey(): Promise<SayIntentionsSettings> {
  const settings = await apiFetch<SayIntentionsSettings>('/api/settings/sayintentions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sayintentions_api_key: null }),
  });
  notifyMutation();
  return settings;
}
