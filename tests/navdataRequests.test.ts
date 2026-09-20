// A real scratch database, never mocked. Synthetic idents only.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  upsertNavdataRequest,
  listNavdataRequests,
  pruneExpiredNavdataRequests,
  deleteNavdataRequest,
  deleteNavdataRequestById,
} from '../src/db/navdataRequests';
import { applySchema } from '../src/db/schema';
import { createScratchDb, destroyScratchDb, type ScratchDb } from './helpers/db';

let scratch: ScratchDb;
const T = new Date('2026-01-10T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => { scratch = createScratchDb(); });
afterEach(() => { destroyScratchDb(scratch); });

describe('navdata_requests', () => {
  it('creates a row with normalised ident/region and a 7-day expiry', () => {
    const r = upsertNavdataRequest('A', ' zzaa ', 'zz', T);
    expect(r).toMatchObject({ kind: 'A', ident: 'ZZAA', region: 'ZZ', requested_at: T.toISOString() });
    expect(r.expires_at).toBe(new Date(T.getTime() + 7 * DAY).toISOString());
    expect(listNavdataRequests(T)).toHaveLength(1);
  });

  it('is idempotent and refreshes timestamps, including with a NULL region', () => {
    const a = upsertNavdataRequest('W', 'ZZWPT', null, T);
    const later = new Date(T.getTime() + DAY);
    const b = upsertNavdataRequest('W', 'zzwpt', undefined, later);
    expect(b.id).toBe(a.id);
    expect(b.requested_at).toBe(later.toISOString());
    expect(listNavdataRequests(later)).toHaveLength(1);
    upsertNavdataRequest('W', 'ZZWPT', 'ZZ', later);
    expect(listNavdataRequests(later)).toHaveLength(2);
  });

  it('excludes and prunes rows older than 7 days', () => {
    upsertNavdataRequest('A', 'ZZAA', null, T);
    upsertNavdataRequest('A', 'ZZBB', null, new Date(T.getTime() + 3 * DAY));
    const at8 = new Date(T.getTime() + 8 * DAY);
    expect(listNavdataRequests(at8).map(r => r.ident)).toEqual(['ZZBB']);
    expect(pruneExpiredNavdataRequests(at8)).toBe(1);
    expect(listNavdataRequests(at8)).toHaveLength(1);
  });

  it('deletes by key and by id', () => {
    const a = upsertNavdataRequest('A', 'ZZAA', null, T);
    upsertNavdataRequest('W', 'ZZWPT', 'ZZ', T);
    expect(deleteNavdataRequest('A', 'zzaa')).toBe(true);
    expect(deleteNavdataRequest('A', 'ZZAA')).toBe(false);
    expect(deleteNavdataRequestById(a.id)).toBe(false);
    expect(deleteNavdataRequest('W', 'ZZWPT', 'ZZ')).toBe(true);
    expect(listNavdataRequests(T)).toHaveLength(0);
  });

  it('rejects an unknown kind at the database', () => {
    expect(() => scratch.db.prepare(
      "INSERT INTO navdata_requests (kind, ident, requested_at, expires_at) VALUES ('X','ZZ','a','b')"
    ).run()).toThrow();
  });

  it('applying the schema again is a no-op over existing rows', () => {
    upsertNavdataRequest('A', 'ZZAA', null, T);
    applySchema(scratch.db);
    applySchema(scratch.db);
    expect(listNavdataRequests(T)).toHaveLength(1);
  });
});
