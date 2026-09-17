import express, { Router } from 'express';
import { getFlightById } from '../db/flights';
import {
  insertAcarsMessage, insertAcarsMessageOnce, listAcarsMessagesForFlight,
  listAcarsMessagesForPlannedLeg, findAcarsMessageByDedupKey,
} from '../db/acarsMessages';
import { getPlannedLegById } from '../db/plannedLegs';
import {
  CANNED_MESSAGES, CLIENT_DIRECTION, cannedMessageIdList,
  findCannedMessage, findCannedMessageByBody,
  LOADSHEET_REQUEST_LABEL, LOADSHEET_LABEL, NO_DISPATCH_DATA_MESSAGE,
  dispatchDedupKey, loadsheetRequestDedupKey, loadsheetReplyDedupKey,
  parseDispatchPayload, buildLoadsheetFigures, buildLoadsheetRequestBody, buildLoadsheetReplyBody,
  normaliseIcao, isValidIcaoShape, wxRequestLabelAndBody, wxReplyLabel,
  buildWxReplyBody, buildWxUnavailableBody, WX_UNAVAILABLE_LABEL,
  NO_FLIGHT_PLAN_MESSAGE, CLEARANCE_REQUEST_LABEL, CLEARANCE_LABEL,
  clearanceRequestDedupKey, clearanceDedupKey, buildClearanceDetails, buildClearanceBody,
} from '../acars';
import { getCachedWeather, WeatherFetchError } from '../weatherClient';
import type {
  AcarsThread, CannedAcarsMessageList, LoadsheetRequestResponse, WxRequestResponse, WxWeatherPayload,
  PlannedLegAcarsThread, PlannedLegWxRequestResponse, ClearanceRequestResponse,
} from '../types';

/**
 * /api/flights/:id/acars-messages and /api/acars/canned-messages — mounted at
 * '/api' by src/server.ts, behind requireAuth and requireSameOrigin, and before
 * the SPA catch-all. Every route here also accepts an x-ingest-token header
 * with no session cookie — the same shared secret the Windows agent uses —
 * as an alternative to a browser session.
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

  // Flight-scoped, not leg-scoped: a crew can request weather for any ICAO —
  // an alternate, a diversion field — not necessarily the linked leg's
  // departure or destination. Not idempotent, unlike the loadsheet route
  // below: there is no dedup key, so every accepted call inserts a brand-new
  // request/reply pair, and both "METAR found" and "no data" are successful,
  // request-was-processed outcomes rather than errors.
  router.post('/flights/:id/acars-messages/wx', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' }); return; }

    try {
      const flight = getFlightById(id);
      if (!flight) { res.status(404).json({ error: `Flight ${id} not found`, code: 'FLIGHT_NOT_FOUND' }); return; }

      const body = req.body as unknown;
      if (typeof body !== 'object' || body === null || Array.isArray(body) ||
          typeof (body as Record<string, unknown>).icao !== 'string' ||
          (body as Record<string, unknown>).icao === '' ||
          ((body as Record<string, unknown>).icao as string).trim() === '') {
        res.status(400).json({ error: 'icao is required', code: 'INVALID_BODY' });
        return;
      }

      const icao = normaliseIcao((body as Record<string, unknown>).icao as string);
      if (!isValidIcaoShape(icao)) {
        res.status(400).json({
          error: 'icao must be 4 letters or digits (e.g. EGLL)',
          code: 'INVALID_ICAO',
        });
        return;
      }

      const issuedAt = new Date().toISOString();
      const requestMessage = insertAcarsMessage({
        flight_id: id,
        direction: 'downlink',
        category: 'wx',
        label: wxRequestLabelAndBody(icao),
        body: wxRequestLabelAndBody(icao),
        payload_json: JSON.stringify({ icao }),
        sent_at: issuedAt,
      });

      let available: boolean;
      let replyMessage;
      let weather: WxWeatherPayload | null;

      try {
        const raw = await getCachedWeather(icao);
        if (raw.metar === null) {
          // Well-formed ICAO, upstream has nothing for it — a feature
          // outcome, not a thrown error.
          available = false;
          weather = null;
          replyMessage = insertAcarsMessage({
            flight_id: id, direction: 'uplink', category: 'wx',
            label: WX_UNAVAILABLE_LABEL, body: buildWxUnavailableBody(icao),
            payload_json: JSON.stringify({ icao, reason: 'NO_DATA' }),
            correlation_id: requestMessage.id, sent_at: new Date().toISOString(),
          });
        } else {
          available = true;
          weather = { icao, metar: raw.metar, taf: raw.taf, fetched_at: raw.fetched_at };
          replyMessage = insertAcarsMessage({
            flight_id: id, direction: 'uplink', category: 'wx',
            label: wxReplyLabel(icao), body: buildWxReplyBody(raw.metar, raw.taf),
            payload_json: JSON.stringify(weather),
            correlation_id: requestMessage.id, sent_at: new Date().toISOString(),
          });
        }
      } catch (err) {
        if (!(err instanceof WeatherFetchError)) throw err;
        available = false;
        weather = null;
        replyMessage = insertAcarsMessage({
          flight_id: id, direction: 'uplink', category: 'wx',
          label: WX_UNAVAILABLE_LABEL, body: buildWxUnavailableBody(icao),
          payload_json: JSON.stringify({ icao, reason: err.code }),
          correlation_id: requestMessage.id, sent_at: new Date().toISOString(),
        });
      }

      const responseBody: WxRequestResponse = {
        flight_id: id, icao, available, request: requestMessage, reply: replyMessage, weather,
      };
      res.status(201).json(responseBody);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Leg-scoped reads and writes: the pre-flight twin of the flight-scoped
  // routes above, for a planned leg no flights row has been created for yet.
  // Existence is checked with getPlannedLegById, same as the loadsheet route
  // below; every validation rule is the same helper the flight-scoped route
  // calls, so a rule change cannot drift between the two.
  router.get('/planned-legs/:legId/acars-messages', (req, res) => {
    const legId = parseInt(req.params.legId, 10);
    if (isNaN(legId)) { res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' }); return; }

    try {
      if (!getPlannedLegById(legId)) {
        res.status(404).json({ error: `Planned leg ${legId} not found`, code: 'PLANNED_LEG_NOT_FOUND' });
        return;
      }

      const thread: PlannedLegAcarsThread = {
        planned_leg_id: legId,
        messages: listAcarsMessagesForPlannedLeg(legId),
      };
      res.json(thread);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/planned-legs/:legId/acars-messages', (req, res) => {
    const legId = parseInt(req.params.legId, 10);
    if (isNaN(legId)) { res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' }); return; }

    try {
      if (!getPlannedLegById(legId)) {
        res.status(404).json({ error: `Planned leg ${legId} not found`, code: 'PLANNED_LEG_NOT_FOUND' });
        return;
      }

      const body = req.body as unknown;
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        res.status(400).json({ error: 'Invalid request body', code: 'INVALID_BODY' });
        return;
      }
      const payload = body as Record<string, unknown>;

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

      // No dedup here either — pressing the button twice files two messages,
      // same as the flight-scoped route.
      const message = insertAcarsMessage({
        planned_leg_id: legId,
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

  // Leg-scoped WX request: field-for-field the flight-scoped route above, with
  // planned_leg_id where flight_id was. Same "no data" and WeatherFetchError
  // handling — both are successful, request-was-processed outcomes.
  router.post('/planned-legs/:legId/acars-messages/wx', async (req, res) => {
    const legId = parseInt(req.params.legId, 10);
    if (isNaN(legId)) { res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' }); return; }

    try {
      if (!getPlannedLegById(legId)) {
        res.status(404).json({ error: `Planned leg ${legId} not found`, code: 'PLANNED_LEG_NOT_FOUND' });
        return;
      }

      const body = req.body as unknown;
      if (typeof body !== 'object' || body === null || Array.isArray(body) ||
          typeof (body as Record<string, unknown>).icao !== 'string' ||
          (body as Record<string, unknown>).icao === '' ||
          ((body as Record<string, unknown>).icao as string).trim() === '') {
        res.status(400).json({ error: 'icao is required', code: 'INVALID_BODY' });
        return;
      }

      const icao = normaliseIcao((body as Record<string, unknown>).icao as string);
      if (!isValidIcaoShape(icao)) {
        res.status(400).json({
          error: 'icao must be 4 letters or digits (e.g. EGLL)',
          code: 'INVALID_ICAO',
        });
        return;
      }

      const issuedAt = new Date().toISOString();
      const requestMessage = insertAcarsMessage({
        planned_leg_id: legId,
        direction: 'downlink',
        category: 'wx',
        label: wxRequestLabelAndBody(icao),
        body: wxRequestLabelAndBody(icao),
        payload_json: JSON.stringify({ icao }),
        sent_at: issuedAt,
      });

      let available: boolean;
      let replyMessage;
      let weather: WxWeatherPayload | null;

      try {
        const raw = await getCachedWeather(icao);
        if (raw.metar === null) {
          available = false;
          weather = null;
          replyMessage = insertAcarsMessage({
            planned_leg_id: legId, direction: 'uplink', category: 'wx',
            label: WX_UNAVAILABLE_LABEL, body: buildWxUnavailableBody(icao),
            payload_json: JSON.stringify({ icao, reason: 'NO_DATA' }),
            correlation_id: requestMessage.id, sent_at: new Date().toISOString(),
          });
        } else {
          available = true;
          weather = { icao, metar: raw.metar, taf: raw.taf, fetched_at: raw.fetched_at };
          replyMessage = insertAcarsMessage({
            planned_leg_id: legId, direction: 'uplink', category: 'wx',
            label: wxReplyLabel(icao), body: buildWxReplyBody(raw.metar, raw.taf),
            payload_json: JSON.stringify(weather),
            correlation_id: requestMessage.id, sent_at: new Date().toISOString(),
          });
        }
      } catch (err) {
        if (!(err instanceof WeatherFetchError)) throw err;
        available = false;
        weather = null;
        replyMessage = insertAcarsMessage({
          planned_leg_id: legId, direction: 'uplink', category: 'wx',
          label: WX_UNAVAILABLE_LABEL, body: buildWxUnavailableBody(icao),
          payload_json: JSON.stringify({ icao, reason: err.code }),
          correlation_id: requestMessage.id, sent_at: new Date().toISOString(),
        });
      }

      const responseBody: PlannedLegWxRequestResponse = {
        planned_leg_id: legId, icao, available, request: requestMessage, reply: replyMessage, weather,
      };
      res.status(201).json(responseBody);
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

  // Leg-scoped, not flight-scoped, and gated the same way as the load sheet
  // above: a PDC is generated from the leg's on-file dispatch release, and a
  // leg with none has no filed route to clear it against. Takes no request
  // body. Idempotent: a second call for the same leg returns the same pair
  // rather than filing a second one, because the same dispatch payload always
  // derives the same clearance.
  router.post('/planned-legs/:legId/acars-messages/clearance', (req, res) => {
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
        res.status(409).json({ error: NO_FLIGHT_PLAN_MESSAGE, code: 'NO_FLIGHT_PLAN' });
        return;
      }

      const details = buildClearanceDetails(payload, legId);
      const issuedAt = new Date().toISOString();

      const requestResult = insertAcarsMessageOnce({
        planned_leg_id: legId,
        direction: 'downlink',
        category: 'pdc',
        label: CLEARANCE_REQUEST_LABEL,
        body: CLEARANCE_REQUEST_LABEL,
        dedup_key: clearanceRequestDedupKey(legId),
        sent_at: issuedAt,
      });
      const replyResult = insertAcarsMessageOnce({
        planned_leg_id: legId,
        direction: 'uplink',
        category: 'pdc',
        label: CLEARANCE_LABEL,
        body: buildClearanceBody(details),
        payload_json: JSON.stringify(details),
        correlation_id: requestResult.message.id,
        dedup_key: clearanceDedupKey(legId),
        sent_at: issuedAt,
      });

      const body: ClearanceRequestResponse = {
        planned_leg_id: legId,
        created: replyResult.created,
        request: requestResult.message,
        reply: replyResult.message,
        clearance: details,
      };
      res.status(replyResult.created ? 201 : 200).json(body);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
