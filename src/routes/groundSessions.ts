import express, { Router } from 'express';
import type { FlightManager } from '../flightManager';
import { getOpenGroundSession, insertManualGroundSession, closeOpenGroundSession } from '../db/groundSessions';
import { getPlannedLegById } from '../db/plannedLegs';
import { normaliseIcao, isValidIcaoShape } from '../acars';
import type { CurrentGroundSessionResponse } from '../types';

const MAX_PARKING_POSITION_LENGTH = 120;

/**
 * /api/ground-sessions and /api/ground-sessions/current — mounted at '/api' by
 * src/server.ts, behind requireAuth and requireSameOrigin, and before the SPA
 * catch-all. GET /ground-sessions/current also accepts an x-ingest-token
 * header with no session cookie, the same shared secret the Windows agent
 * uses; the two writes below stay session-only.
 *
 * Takes flightManager for two reasons: a manually-created session's
 * `aircraft` comes from the last telemetry frame, same as every other place
 * that field is read; and every write here calls
 * flightManager.refreshGroundSession() afterward, so the live-status cache
 * GET /api/status reads can never drift from the row a write just changed —
 * the manager talks to the database directly here, on its own connection,
 * and has no other way to find out.
 */
export function createGroundSessionsRouter(flightManager: FlightManager, onChanged: () => void = () => {}): Router {
  const router = express.Router();

  router.post('/ground-sessions', (req, res) => {
    try {
      const body = req.body as unknown;
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        res.status(400).json({ error: 'Invalid request body', code: 'INVALID_BODY' });
        return;
      }
      const payload = body as Record<string, unknown>;

      if (typeof payload.icao !== 'string' || payload.icao.trim() === '') {
        res.status(400).json({ error: 'icao is required', code: 'INVALID_BODY' });
        return;
      }
      const icao = normaliseIcao(payload.icao);
      if (!isValidIcaoShape(icao)) {
        res.status(400).json({
          error: 'icao must be 4 letters or digits (e.g. EGLL)',
          code: 'INVALID_ICAO',
        });
        return;
      }

      // Absent means "leave the field alone" on a refine; present-but-empty
      // means "the operator supplied this" and is what stores NULL.
      let parkingPositionGiven = false;
      let parkingPosition: string | null = null;
      if (payload.parking_position !== undefined) {
        if (payload.parking_position !== null && typeof payload.parking_position !== 'string') {
          res.status(400).json({ error: 'parking_position must be text or null', code: 'INVALID_BODY' });
          return;
        }
        const trimmed = payload.parking_position === null ? '' : payload.parking_position.trim();
        if (trimmed.length > MAX_PARKING_POSITION_LENGTH) {
          res.status(400).json({
            error: `parking_position is too long (max ${MAX_PARKING_POSITION_LENGTH} characters)`,
            code: 'INVALID_BODY',
          });
          return;
        }
        parkingPositionGiven = true;
        parkingPosition = trimmed === '' ? null : trimmed;
      }

      let plannedLegIdGiven = false;
      let plannedLegId: number | null = null;
      if (payload.planned_leg_id !== undefined && payload.planned_leg_id !== null) {
        if (typeof payload.planned_leg_id !== 'number' || !Number.isInteger(payload.planned_leg_id)) {
          res.status(400).json({ error: 'planned_leg_id must be an integer', code: 'INVALID_BODY' });
          return;
        }
        if (!getPlannedLegById(payload.planned_leg_id)) {
          res.status(404).json({
            error: `Planned leg ${payload.planned_leg_id} not found`,
            code: 'PLANNED_LEG_NOT_FOUND',
          });
          return;
        }
        plannedLegIdGiven = true;
        plannedLegId = payload.planned_leg_id;
      }

      const { session, created } = insertManualGroundSession({
        airportIcao: icao,
        parkingPositionGiven,
        parkingPosition,
        plannedLegIdGiven,
        plannedLegId,
        aircraft: flightManager.appState.lastFrame?.aircraft ?? null,
      });
      flightManager.refreshGroundSession();
      onChanged();
      res.status(created ? 201 : 200).json(session);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/ground-sessions/current', (_req, res) => {
    try {
      const body: CurrentGroundSessionResponse = { session: getOpenGroundSession() };
      res.json(body);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete('/ground-sessions/current', (_req, res) => {
    try {
      const closed = closeOpenGroundSession('manual');
      if (!closed) {
        res.status(404).json({ error: 'No ground session is open', code: 'NO_OPEN_GROUND_SESSION' });
        return;
      }
      flightManager.refreshGroundSession();
      onChanged();
      res.json(closed);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
