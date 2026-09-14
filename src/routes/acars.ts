import express, { Router } from 'express';
import { getFlightById } from '../db/flights';
import {
  insertAcarsMessage, insertAcarsMessageOnce, listAcarsMessagesForFlight, findAcarsMessageByDedupKey,
} from '../db/acarsMessages';
import { getPlannedLegById } from '../db/plannedLegs';
import {
  CANNED_MESSAGES, CLIENT_DIRECTION, cannedMessageIdList,
  findCannedMessage, findCannedMessageByBody,
  LOADSHEET_REQUEST_LABEL, LOADSHEET_LABEL, NO_DISPATCH_DATA_MESSAGE,
  dispatchDedupKey, loadsheetRequestDedupKey, loadsheetReplyDedupKey,
  parseDispatchPayload, buildLoadsheetFigures, buildLoadsheetRequestBody, buildLoadsheetReplyBody,
} from '../acars';
import type { AcarsThread, CannedAcarsMessageList, LoadsheetRequestResponse } from '../types';

/**
 * /api/flights/:id/acars-messages and /api/acars/canned-messages — mounted at
 * '/api' by src/server.ts, behind requireAuth and requireSameOrigin, and before
 * the SPA catch-all.
 *
 * No flightManager parameter, unlike the flights and trips routers: a message
 * thread is read and written entirely from the database, and nothing here
 * depends on whether a flight is currently in progress.
 *
 * The canned set is served rather than mirrored in the client because the
 * server is the one that rejects anything outside it, and because the MCDU
 * client lives in another repository and cannot import a constant from here.
 */
export function createAcarsRouter(): Router {
  const router = express.Router();

  router.get('/acars/canned-messages', (_req, res) => {
    const body: CannedAcarsMessageList = { messages: [...CANNED_MESSAGES] };
    res.json(body);
  });

  router.get('/flights/:id/acars-messages', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' }); return; }

    try {
      const flight = getFlightById(id);
      if (!flight) { res.status(404).json({ error: `Flight ${id} not found`, code: 'FLIGHT_NOT_FOUND' }); return; }

      // An envelope rather than a bare array, so a cursor can be added later
      // without changing the response type. planned_leg_id says which
      // pre-flight scope the thread was read under.
      const thread: AcarsThread = {
        flight_id: id,
        planned_leg_id: flight.planned_leg_id ?? null,
        messages: listAcarsMessagesForFlight(id),
      };
      res.json(thread);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/flights/:id/acars-messages', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' }); return; }

    try {
      const flight = getFlightById(id);
      if (!flight) { res.status(404).json({ error: `Flight ${id} not found`, code: 'FLIGHT_NOT_FOUND' }); return; }

      const body = req.body as unknown;
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        res.status(400).json({ error: 'Invalid request body', code: 'INVALID_BODY' });
        return;
      }
      const payload = body as Record<string, unknown>;

      // canned_id is the preferred form; body is for a client that holds only
      // the text, and is ignored when canned_id is present.
      let canned = null;
      if (payload.canned_id !== undefined && payload.canned_id !== null) {
        canned = findCannedMessage(payload.canned_id);
        if (!canned) {
          res.status(400).json({
            error: `canned_id must be one of: ${cannedMessageIdList()}`,
            code: 'UNKNOWN_CANNED_MESSAGE',
          });
          return;
        }
      } else if (payload.body !== undefined && payload.body !== null) {
        canned = findCannedMessageByBody(payload.body);
        if (!canned) {
          res.status(400).json({
            error: 'Only canned messages can be sent from a client. Free text is not accepted.',
            code: 'NOT_A_CANNED_MESSAGE',
          });
          return;
        }
      } else {
        res.status(400).json({
          error: `canned_id must be one of: ${cannedMessageIdList()}`,
          code: 'UNKNOWN_CANNED_MESSAGE',
        });
        return;
      }

      // 400 above means "this is not a message I know"; 403 here means "I know
      // exactly what you asked for and you are not allowed to ask for it" — a
      // client trying to write an uplink is not making a typo.
      if (payload.direction !== undefined && payload.direction !== CLIENT_DIRECTION) {
        res.status(403).json({
          error: 'A client may only send downlink messages',
          code: 'DIRECTION_NOT_PERMITTED',
        });
        return;
      }
      if (payload.category !== undefined && payload.category !== canned.category) {
        res.status(403).json({
          error: `category must be ${canned.category} for canned message ${canned.id}`,
          code: 'CATEGORY_NOT_PERMITTED',
        });
        return;
      }

      // Everything stored comes from the canned entry, never from the request:
      // a client cannot forge an uplink, impersonate dispatch or store free
      // text. No dedup — pressing the button twice files two messages, exactly
      // as it would on a real MCDU.
      const message = insertAcarsMessage({
        flight_id: id,
        direction: canned.direction,
        category: canned.category,
        label: canned.label,
        body: canned.body,
      });
      res.status(201).json(message);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Leg-scoped, not flight-scoped: a load sheet is generated from the leg's
  // on-file dispatch release, which exists before a flights row does. Takes
  // no request body — the leg id in the path is the only input. Idempotent:
  // a second call for the same leg returns the same pair rather than filing
  // a second one, because the figures come from the same immutable payload
  // and a repeat would be a byte-identical duplicate.
  router.post('/planned-legs/:legId/acars-messages/loadsheet', (req, res) => {
    const legId = parseInt(req.params.legId, 10);
    if (isNaN(legId)) { res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' }); return; }

    try {
      if (!getPlannedLegById(legId)) {
        res.status(404).json({ error: `Planned leg ${legId} not found`, code: 'PLANNED_LEG_NOT_FOUND' });
        return;
      }

      const dispatchMessage = findAcarsMessageByDedupKey(dispatchDedupKey(legId));
      const payload = parseDispatchPayload(dispatchMessage?.payload_json ?? null);
      if (!payload) {
        res.status(409).json({ error: NO_DISPATCH_DATA_MESSAGE, code: 'NO_DISPATCH_DATA' });
        return;
      }

      const sheet = buildLoadsheetFigures(payload);
      if (sheet.block_fuel === null && sheet.payload === null && sheet.zero_fuel_weight === null) {
        res.status(409).json({ error: NO_DISPATCH_DATA_MESSAGE, code: 'NO_DISPATCH_DATA' });
        return;
      }

      const issuedAt = new Date().toISOString();

      const requestResult = insertAcarsMessageOnce({
        planned_leg_id: legId,
        direction: 'downlink',
        category: 'dispatch',
        label: LOADSHEET_REQUEST_LABEL,
        body: buildLoadsheetRequestBody(payload),
        dedup_key: loadsheetRequestDedupKey(legId),
        sent_at: issuedAt,
      });
      const replyResult = insertAcarsMessageOnce({
        planned_leg_id: legId,
        direction: 'uplink',
        category: 'dispatch',
        label: LOADSHEET_LABEL,
        body: buildLoadsheetReplyBody(payload, sheet, issuedAt),
        payload_json: JSON.stringify(sheet),
        correlation_id: requestResult.message.id,
        dedup_key: loadsheetReplyDedupKey(legId),
        sent_at: issuedAt,
      });

      const body: LoadsheetRequestResponse = {
        planned_leg_id: legId,
        created: replyResult.created,
        request: requestResult.message,
        reply: replyResult.message,
        sheet,
      };
      res.status(replyResult.created ? 201 : 200).json(body);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
