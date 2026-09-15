import type { CreateGroundSession, GroundSession, GroundSessionEndReason, GroundSessionSource } from '../types';
import { getDb } from './connection';

// ── Ground sessions ───────────────────────────────────────────────────────────
//
// One table, ground_sessions: the pre-flight / on-ground record — an airport,
// sometimes a stand, sometimes a planned leg — that exists before a flights
// row does. At most one row is ever open (ended_at IS NULL) at a time, a rule
// the partial unique index in the schema enforces; every function here that
// writes assumes it and none of them lift it.
//
// Reads never use SELECT *: the sixteen columns are listed in DDL order so a
// column added later cannot silently change a response shape.

const COLUMNS = `
  id, source, airport_icao, airport_name, lat, lon,
  parking_position, parking_position_source,
  planned_leg_id, planned_leg_link_source, aircraft,
  started_at, ended_at, ended_reason, flight_id, created_at, updated_at
`;

function getGroundSessionRow(id: number): GroundSession | null {
  const row = getDb().prepare(`SELECT ${COLUMNS} FROM ground_sessions WHERE id = ?`)
    .get(id) as GroundSession | undefined;
  return row ?? null;
}

/**
 * Inserts an open session and returns the stored row. Throws if one is
 * already open — this is the strict path a caller uses only when it has
 * already established none is open (the automatic ground-state machine's
 * entry step). A manual request that might find one open already goes
 * through insertManualGroundSession() instead.
 */
export function insertGroundSession(input: CreateGroundSession): GroundSession {
  return getDb().transaction((): GroundSession => {
    const open = getDb().prepare('SELECT 1 FROM ground_sessions WHERE ended_at IS NULL').get();
    if (open) {
      throw new Error('Cannot insert a ground session while one is already open');
    }

    const now = new Date().toISOString();
    const startedAt = input.started_at ?? now;
    const result = getDb().prepare(`
      INSERT INTO ground_sessions
        (source, airport_icao, airport_name, lat, lon,
         parking_position, parking_position_source,
         planned_leg_id, planned_leg_link_source, aircraft,
         started_at, ended_at, ended_reason, flight_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
    `).run(
      input.source, input.airport_icao ?? null, input.airport_name ?? null,
      input.lat ?? null, input.lon ?? null,
      input.parking_position ?? null, input.parking_position_source ?? null,
      input.planned_leg_id ?? null, input.planned_leg_link_source ?? null,
      input.aircraft ?? null,
      startedAt, now, now,
    );

    const row = getGroundSessionRow(result.lastInsertRowid as number);
    if (!row) throw new Error('Ground session vanished immediately after insert');
    return row;
  })();
}

/** The open row, or null. */
export function getOpenGroundSession(): GroundSession | null {
  const row = getDb().prepare(`SELECT ${COLUMNS} FROM ground_sessions WHERE ended_at IS NULL`)
    .get() as GroundSession | undefined;
  return row ?? null;
}

export function getGroundSessionById(id: number): GroundSession | null {
  return getGroundSessionRow(id);
}

/** Most recent first. For a future history view; capped by `limit`. */
export function listGroundSessions(limit: number): GroundSession[] {
  return getDb().prepare(`SELECT ${COLUMNS} FROM ground_sessions ORDER BY started_at DESC LIMIT ?`)
    .all(limit) as GroundSession[];
}

/** Stamps ended_at/ended_reason (and flight_id when given). No-op returning null if none is open. */
export function closeOpenGroundSession(
  reason: GroundSessionEndReason, flightId: number | null = null,
): GroundSession | null {
  return getDb().transaction((): GroundSession | null => {
    const open = getDb().prepare('SELECT id FROM ground_sessions WHERE ended_at IS NULL')
      .get() as { id: number } | undefined;
    if (!open) return null;

    const now = new Date().toISOString();
    getDb().prepare(`
      UPDATE ground_sessions
         SET ended_at = ?, ended_reason = ?, flight_id = ?, updated_at = ?
       WHERE id = ?
    `).run(now, reason, flightId, now, open.id);

    return getGroundSessionRow(open.id);
  })();
}

/** Sets parking_position + parking_position_source on the open row. No-op returning null if none is open. */
export function updateOpenGroundSessionParking(
  parkingPosition: string | null, source: GroundSessionSource,
): GroundSession | null {
  return getDb().transaction((): GroundSession | null => {
    const open = getDb().prepare('SELECT id FROM ground_sessions WHERE ended_at IS NULL')
      .get() as { id: number } | undefined;
    if (!open) return null;

    const now = new Date().toISOString();
    getDb().prepare(`
      UPDATE ground_sessions
         SET parking_position = ?, parking_position_source = ?, updated_at = ?
       WHERE id = ?
    `).run(parkingPosition, source, now, open.id);

    return getGroundSessionRow(open.id);
  })();
}

/**
 * The automatic-entry adopt step: when a session is already open (typically
 * one the operator entered by hand) and detection trips anyway, this writes
 * ONLY the columns that are currently NULL — never `source`, and never a
 * column that already holds a value, whichever session created it. A field
 * absent from `patch`, or present as `null`, leaves the column untouched
 * either way: there is nothing to fill it with. No-op returning null if none
 * is open.
 */
export function fillOpenGroundSessionGaps(patch: Partial<CreateGroundSession>): GroundSession | null {
  return getDb().transaction((): GroundSession | null => {
    const open = getOpenGroundSession();
    if (!open) return null;

    const sets: string[] = [];
    const values: unknown[] = [];

    const fill = (column: string, current: unknown, value: unknown): void => {
      if (value === undefined || value === null) return;
      if (current !== null) return;
      sets.push(`${column} = ?`);
      values.push(value);
    };

    fill('airport_icao', open.airport_icao, patch.airport_icao);
    fill('airport_name', open.airport_name, patch.airport_name);
    fill('lat', open.lat, patch.lat);
    fill('lon', open.lon, patch.lon);
    fill('parking_position', open.parking_position, patch.parking_position);
    fill('parking_position_source', open.parking_position_source, patch.parking_position_source);
    fill('planned_leg_id', open.planned_leg_id, patch.planned_leg_id);
    fill('planned_leg_link_source', open.planned_leg_link_source, patch.planned_leg_link_source);
    fill('aircraft', open.aircraft, patch.aircraft);

    if (sets.length === 0) return open;

    const now = new Date().toISOString();
    sets.push('updated_at = ?');
    values.push(now, open.id);

    getDb().prepare(`UPDATE ground_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values);

    return getGroundSessionRow(open.id);
  })();
}

/**
 * Sets planned_leg_id + planned_leg_link_source on the open row. Not exported:
 * the only caller today is insertManualGroundSession()'s refine branch, and
 * assumes a session is already known to be open.
 */
function setOpenGroundSessionPlannedLeg(
  id: number, plannedLegId: number, source: GroundSessionSource,
): GroundSession {
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE ground_sessions
       SET planned_leg_id = ?, planned_leg_link_source = ?, updated_at = ?
     WHERE id = ?
  `).run(plannedLegId, source, now, id);

  const row = getGroundSessionRow(id);
  if (!row) throw new Error('Ground session vanished while updating its planned leg');
  return row;
}

/**
 * Argument to insertManualGroundSession(). The *Given flags exist because
 * "the operator supplied this field" and "the operator supplied null/absent"
 * are different facts when refining an already-open session: an omitted
 * field leaves the open session's existing value untouched, where a
 * present-but-null one overwrites it with null.
 */
export interface CreateManualGroundSession {
  airportIcao: string;
  parkingPositionGiven: boolean;
  parkingPosition: string | null;
  plannedLegIdGiven: boolean;
  plannedLegId: number | null;
  aircraft: string | null;
}

/**
 * The manual-entry variant of insertGroundSession(): implements the
 * precedence rules a POST from the operator must honour depending on what, if
 * anything, is already open.
 *
 * - Nothing open: a plain insert.
 * - An automatic session at the SAME airport: refined in place — only the
 *   fields the operator actually supplied change, `source` stays 'auto', and
 *   each changed field's own `*_source` column becomes 'manual'. `created`
 *   is false; the caller answers 200.
 * - An automatic session at a DIFFERENT airport (or with none resolved): the
 *   automatic session is wrong about the place, so it is closed
 *   ('corrected') and a fresh manual session is inserted.
 * - A manual session already open: closed ('superseded') and replaced.
 *
 * The close-then-insert branches run in the same transaction as the read
 * that decided them, so the "at most one open session" index can never
 * observe two open rows, and a failure partway rolls the whole thing back
 * rather than leaving no session open at all.
 */
export function insertManualGroundSession(
  input: CreateManualGroundSession,
): { session: GroundSession; created: boolean } {
  return getDb().transaction((): { session: GroundSession; created: boolean } => {
    const open = getOpenGroundSession();

    const freshInsert = (): GroundSession => insertGroundSession({
      source: 'manual',
      airport_icao: input.airportIcao,
      parking_position: input.parkingPosition,
      parking_position_source: input.parkingPosition !== null ? 'manual' : null,
      planned_leg_id: input.plannedLegId,
      planned_leg_link_source: input.plannedLegId !== null ? 'manual' : null,
      aircraft: input.aircraft,
    });

    if (!open) {
      return { session: freshInsert(), created: true };
    }

    if (open.source === 'auto' && open.airport_icao !== null && open.airport_icao === input.airportIcao) {
      let session = open;
      if (input.parkingPositionGiven) {
        session = updateOpenGroundSessionParking(input.parkingPosition, 'manual') ?? session;
      }
      if (input.plannedLegIdGiven && input.plannedLegId !== null) {
        session = setOpenGroundSessionPlannedLeg(session.id, input.plannedLegId, 'manual');
      }
      return { session, created: false };
    }

    closeOpenGroundSession(open.source === 'manual' ? 'superseded' : 'corrected');
    return { session: freshInsert(), created: true };
  })();
}
