// tests/db/acarsMessages.test.ts — the acars_messages thread: insert,
// dedup-key insert-or-return, the by-id/by-dedup-key/by-scope reads and their
// ORDER BY, and the correlation_id ON DELETE SET NULL behavior. A real
// database, never mocked (a file that calls createScratchDb() must not
// vi.mock('../src/db')).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  insertAcarsMessage,
  insertAcarsMessageOnce,
  getAcarsMessageById,
  findAcarsMessageByDedupKey,
  listAcarsMessagesForFlight,
  listAcarsMessagesForPlannedLeg,
  setAcarsInsertListener,
} from '../../src/db';
import { createScratchDb, destroyScratchDb, seedFlight, seedPlannedLeg, seedTrip, seedAcarsMessage, type ScratchDb } from '../helpers/db';

let scratch: ScratchDb;

beforeEach(() => {
  scratch = createScratchDb();
});

afterEach(() => {
  destroyScratchDb(scratch);
});

describe('insertAcarsMessage()', () => {
  it('stores a row scoped to a flight and returns it with defaults filled in', () => {
    const flightId = seedFlight(scratch.db);

    const row = insertAcarsMessage({
      flight_id: flightId,
      direction: 'uplink',
      category: 'freetext',
      body: 'CLEARED TO DESTINATION',
    });

    expect(row.id).toBeGreaterThan(0);
    expect(row.flight_id).toBe(flightId);
    expect(row.planned_leg_id).toBeNull();
    expect(row.body).toBe('CLEARED TO DESTINATION');
    expect(row.label).toBeNull();
    expect(row.payload_json).toBeNull();
    expect(row.correlation_id).toBeNull();
    expect(row.dedup_key).toBeNull();
    expect(row.read_at).toBeNull();
    expect(typeof row.sent_at).toBe('string');
  });

  it('accepts a planned_leg_id-only scope, for a message that arrives before the flight exists', () => {
    const tripId = seedTrip(scratch.db);
    const legId = seedPlannedLeg(scratch.db, { trip_id: tripId });

    const row = insertAcarsMessage({
      planned_leg_id: legId,
      direction: 'uplink',
      category: 'pdc',
      body: 'PDC TEXT',
    });

    expect(row.flight_id).toBeNull();
    expect(row.planned_leg_id).toBe(legId);
  });

  it('throws when neither flight_id nor planned_leg_id is given', () => {
    expect(() =>
      insertAcarsMessage({ direction: 'uplink', category: 'freetext', body: 'ORPHAN' }),
    ).toThrow(/flight_id.*planned_leg_id/);
  });
});

describe('insertAcarsMessageOnce()', () => {
  it('inserts a new row and reports created: true on the first call', () => {
    const flightId = seedFlight(scratch.db);

    const { message, created } = insertAcarsMessageOnce({
      flight_id: flightId,
      direction: 'uplink',
      category: 'pdc',
      body: 'PDC TEXT',
      dedup_key: 'pdc:leg:29',
    });

    expect(created).toBe(true);
    expect(message.dedup_key).toBe('pdc:leg:29');
  });

  it('does not insert a second row for a repeated dedup_key and returns the existing one, created: false', () => {
    const flightId = seedFlight(scratch.db);

    const first = insertAcarsMessageOnce({
      flight_id: flightId,
      direction: 'uplink',
      category: 'pdc',
      body: 'PDC TEXT',
      dedup_key: 'pdc:leg:29',
    });

    const second = insertAcarsMessageOnce({
      flight_id: flightId,
      direction: 'uplink',
      category: 'pdc',
      body: 'PDC TEXT REISSUED',
      dedup_key: 'pdc:leg:29',
    });

    expect(second.created).toBe(false);
    expect(second.message.id).toBe(first.message.id);
    expect(second.message.body).toBe('PDC TEXT');

    const count = scratch.db.prepare('SELECT COUNT(*) AS n FROM acars_messages').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('throws when dedup_key is missing', () => {
    const flightId = seedFlight(scratch.db);
    expect(() =>
      insertAcarsMessageOnce({
        flight_id: flightId,
        direction: 'uplink',
        category: 'pdc',
        body: 'PDC TEXT',
        dedup_key: '',
      }),
    ).toThrow(/dedup_key/);
  });
});

describe('getAcarsMessageById()', () => {
  it('returns the row for a stored id', () => {
    const flightId = seedFlight(scratch.db);
    const id = seedAcarsMessage(scratch.db, { flight_id: flightId, body: 'HELLO' });

    const row = getAcarsMessageById(id);

    expect(row?.body).toBe('HELLO');
  });

  it('returns null for an id nothing was stored under', () => {
    expect(getAcarsMessageById(999999)).toBeNull();
  });
});

describe('findAcarsMessageByDedupKey()', () => {
  it('returns the row for a stored dedup_key', () => {
    const flightId = seedFlight(scratch.db);
    seedAcarsMessage(scratch.db, { flight_id: flightId, dedup_key: 'oooi:81:OUT' });

    const row = findAcarsMessageByDedupKey('oooi:81:OUT');

    expect(row?.dedup_key).toBe('oooi:81:OUT');
  });

  it('returns null for a dedup_key nothing was stored under (miss case)', () => {
    expect(findAcarsMessageByDedupKey('no-such-key')).toBeNull();
  });

  it('returns null for an empty key, unqueried', () => {
    expect(findAcarsMessageByDedupKey('')).toBeNull();
  });
});

describe('listAcarsMessagesForFlight() and listAcarsMessagesForPlannedLeg()', () => {
  it('orders a flight thread by (sent_at, id), including its linked planned leg\'s rows', () => {
    const tripId = seedTrip(scratch.db);
    const legId = seedPlannedLeg(scratch.db, { trip_id: tripId });
    const flightId = seedFlight(scratch.db, { planned_leg_id: legId });

    // Out of insertion order, so the ORDER BY is what makes this pass.
    const third = seedAcarsMessage(scratch.db, { flight_id: flightId, sent_at: '2026-09-09T12:30:00.000Z', body: 'THIRD' });
    const first = seedAcarsMessage(scratch.db, { planned_leg_id: legId, sent_at: '2026-09-09T12:00:00.000Z', body: 'FIRST' });
    const second = seedAcarsMessage(scratch.db, { flight_id: flightId, sent_at: '2026-09-09T12:10:00.000Z', body: 'SECOND' });

    const thread = listAcarsMessagesForFlight(flightId);

    expect(thread.map(m => m.id)).toEqual([first, second, third]);
    expect(thread.map(m => m.body)).toEqual(['FIRST', 'SECOND', 'THIRD']);
  });

  it('breaks a tie in sent_at by ascending id', () => {
    const flightId = seedFlight(scratch.db);
    const earlier = seedAcarsMessage(scratch.db, { flight_id: flightId, sent_at: '2026-09-09T12:00:00.000Z', body: 'A' });
    const later = seedAcarsMessage(scratch.db, { flight_id: flightId, sent_at: '2026-09-09T12:00:00.000Z', body: 'B' });

    const thread = listAcarsMessagesForFlight(flightId);

    expect(thread.map(m => m.id)).toEqual([earlier, later]);
  });

  it('returns [] for a flight with no messages and no planned-leg link', () => {
    const flightId = seedFlight(scratch.db);
    expect(listAcarsMessagesForFlight(flightId)).toEqual([]);
  });

  it('returns [] for a flight id that does not exist', () => {
    expect(listAcarsMessagesForFlight(999999)).toEqual([]);
  });

  it('lists only leg-scoped rows, oldest first, for a leg with no flight yet', () => {
    const tripId = seedTrip(scratch.db);
    const legId = seedPlannedLeg(scratch.db, { trip_id: tripId });
    const otherLegId = seedPlannedLeg(scratch.db, { trip_id: tripId, seq: 2 });

    const second = seedAcarsMessage(scratch.db, { planned_leg_id: legId, sent_at: '2026-09-09T12:10:00.000Z', body: 'SECOND' });
    const first = seedAcarsMessage(scratch.db, { planned_leg_id: legId, sent_at: '2026-09-09T12:00:00.000Z', body: 'FIRST' });
    seedAcarsMessage(scratch.db, { planned_leg_id: otherLegId, sent_at: '2026-09-09T12:05:00.000Z', body: 'OTHER LEG' });

    const thread = listAcarsMessagesForPlannedLeg(legId);

    expect(thread.map(m => m.id)).toEqual([first, second]);
  });
});

describe('setAcarsInsertListener()', () => {
  afterEach(() => {
    setAcarsInsertListener(null); // never leak a listener into a later test file
  });

  it('insertAcarsMessage() calls the listener exactly once, with the created row\'s hint fields', () => {
    const flightId = seedFlight(scratch.db);
    const listener = vi.fn();
    setAcarsInsertListener(listener);

    const row = insertAcarsMessage({
      flight_id: flightId,
      direction: 'uplink',
      category: 'freetext',
      body: 'CLEARED TO DESTINATION',
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ flightId, plannedLegId: null, messageId: row.id });
  });

  it('insertAcarsMessageOnce() calls the listener once for a fresh dedup_key', () => {
    const flightId = seedFlight(scratch.db);
    const listener = vi.fn();
    setAcarsInsertListener(listener);

    const { message } = insertAcarsMessageOnce({
      flight_id: flightId,
      direction: 'uplink',
      category: 'pdc',
      body: 'PDC TEXT',
      dedup_key: 'pdc:leg:29',
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ flightId, plannedLegId: null, messageId: message.id });
  });

  it('insertAcarsMessageOnce() calls the listener zero times on a duplicate dedup_key', () => {
    const flightId = seedFlight(scratch.db);
    insertAcarsMessageOnce({
      flight_id: flightId, direction: 'uplink', category: 'pdc', body: 'PDC TEXT', dedup_key: 'pdc:leg:29',
    });

    const listener = vi.fn();
    setAcarsInsertListener(listener);
    insertAcarsMessageOnce({
      flight_id: flightId, direction: 'uplink', category: 'pdc', body: 'PDC TEXT REISSUED', dedup_key: 'pdc:leg:29',
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('passes the leg scope through for a leg-only row', () => {
    const tripId = seedTrip(scratch.db);
    const legId = seedPlannedLeg(scratch.db, { trip_id: tripId });
    const listener = vi.fn();
    setAcarsInsertListener(listener);

    const row = insertAcarsMessage({ planned_leg_id: legId, direction: 'uplink', category: 'pdc', body: 'PDC TEXT' });

    expect(listener).toHaveBeenCalledWith({ flightId: null, plannedLegId: legId, messageId: row.id });
  });

  it('a throwing listener is caught and logged, and the row is still stored and returned', () => {
    const flightId = seedFlight(scratch.db);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setAcarsInsertListener(() => { throw new Error('boom'); });

    const row = insertAcarsMessage({ flight_id: flightId, direction: 'uplink', category: 'freetext', body: 'HELLO' });

    expect(row.id).toBeGreaterThan(0);
    expect(getAcarsMessageById(row.id)?.body).toBe('HELLO');
    expect(warn).toHaveBeenCalledWith('[db/acarsMessages] insert listener failed:', expect.any(Error));
    warn.mockRestore();
  });

  it('detaching with null stops further notifications', () => {
    const flightId = seedFlight(scratch.db);
    const listener = vi.fn();
    setAcarsInsertListener(listener);
    setAcarsInsertListener(null);

    insertAcarsMessage({ flight_id: flightId, direction: 'uplink', category: 'freetext', body: 'HELLO' });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('correlation_id ON DELETE SET NULL', () => {
  it('leaves a reply row intact with correlation_id null after the request it correlates to is deleted', () => {
    const flightId = seedFlight(scratch.db);
    const requestId = seedAcarsMessage(scratch.db, { flight_id: flightId, category: 'wx', body: 'REQUEST METAR EGLL' });
    const replyId = seedAcarsMessage(scratch.db, {
      flight_id: flightId,
      category: 'wx',
      body: 'METAR EGLL 091200Z',
      correlation_id: requestId,
    });

    scratch.db.prepare('DELETE FROM acars_messages WHERE id = ?').run(requestId);

    const reply = getAcarsMessageById(replyId);
    expect(reply).not.toBeNull();
    expect(reply?.correlation_id).toBeNull();
    expect(reply?.body).toBe('METAR EGLL 091200Z');
  });
});
