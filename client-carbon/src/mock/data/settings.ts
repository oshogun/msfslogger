import type { SayIntentionsLink, SayIntentionsSettings, SimbriefSettings } from '../types';

export const SEED_SIMBRIEF: SimbriefSettings = { simbrief_user_id: '482913' };

export const SEED_SAYINTENTIONS_KEY = 'si-mock-key-7f3a91c2d4e5b6a8';

export function maskKey(key: string): string {
  return '••••••••' + key.slice(-4);
}

export const SEED_SAYINTENTIONS: SayIntentionsSettings = {
  sayintentions_api_key_set: true,
  sayintentions_api_key_masked: maskKey(SEED_SAYINTENTIONS_KEY),
};

/** Flight 13 is already bound to a SayIntentions session. */
export const SEED_SI_LINKS: SayIntentionsLink[] = [
  {
    flight_id: 13, upstream_flight_id: 'SI-88214', since_id: 5310, baseline_comm_id: 5302,
    linked_at: '2026-09-23T13:15:00.000Z', last_import_at: '2026-09-23T13:45:00.000Z', imported_count: 4,
  },
];
