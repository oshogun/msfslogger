import express, { Router } from 'express';
import { getFlightById } from '../db/flights';
import { getPlannedLegById } from '../db/plannedLegs';
import { getSetting } from '../db/settings';
import { insertAcarsMessage, insertAcarsMessageOnce, findAcarsMessageByDedupKey } from '../db/acarsMessages';
import {
  getSayIntentionsLink, upsertSayIntentionsLink, advanceSayIntentionsCursor, deleteSayIntentionsLink,
} from '../db/sayIntentionsLinks';
import {
  SAYINTENTIONS_API_KEY_SETTING, httpStatusForSayIntentionsError, responseCodeForSayIntentionsError,
  mapCommEntryToRows, maxCommId,
} from '../sayIntentions';
import { clearanceDedupKey, parseClearancePayload, buildCondensedClearanceMessage } from '../acars';
import { getCommsHistory, sayAs, SayIntentionsFetchError } from '../sayIntentionsClient';
import type {
  AcarsMessage, SayIntentionsImportResponse, SayIntentionsLinkResponse, SayIntentionsLinkStatus,
  SayIntentionsPushPayload, SayIntentionsPushResponse,
} from '../types';

/**
 * /api/flights/:id/sayintentions/link, .../import and
 * /api/planned-legs/:legId/sayintentions/clearance — both halves of the
 * SayIntentions integration: pulling a session's comms transcript into a
 * flight's ACARS thread, and pushing an already-generated clearance into a
 * live session. Mounted at '/api' by src/server.ts, behind requireAuth and
 * requireSameOrigin, and before the SPA catch-all, the same posture as
 * createAcarsRouter. No route here takes a request body — the import mode on
 * the link route is a query parameter — so express.json()'s SyntaxError
 * handler needs no new path.
 *
 * Every route validates its id param and the flight/leg's existence itself:
 * nothing else already mounted can capture a four-segment
 * /flights/:id/sayintentions/* or /planned-legs/:legId/sayintentions/* path —
 * src/routes/flights.ts's and src/routes/plannedLegs.ts's handlers are two or
 * three segments, and src/routes/acars.ts only owns .../acars-messages*.
 */
export function createSayIntentionsRouter(): Router {
  const router = express.Router();

  function respondUpstreamError(res: express.Response, err: SayIntentionsFetchError): void {
    res.status(httpStatusForSayIntentionsError(err.code)).json({
      error: err.userMessage,
      code: responseCodeForSayIntentionsError(err.code),
    });
  }

  router.get('/flights/:id/sayintentions/link', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' }); return; }

    try {
      const flight = getFlightById(id);
      if (!flight) { res.status(404).json({ error: `Flight ${id} not found`, code: 'FLIGHT_NOT_FOUND' }); return; }

      const apiKey = getSetting(SAYINTENTIONS_API_KEY_SETTING);
      const link = getSayIntentionsLink(id);
      const body: SayIntentionsLinkStatus = {
        flight_id: id,
        linked: link !== null,
        link,
        api_key_set: apiKey !== null,
      };
      res.json(body);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/flights/:id/sayintentions/link', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' }); return; }

    try {
      const flight = getFlightById(id);
      if (!flight) { res.status(404).json({ error: `Flight ${id} not found`, code: 'FLIGHT_NOT_FOUND' }); return; }

      const apiKey = getSetting(SAYINTENTIONS_API_KEY_SETTING);
      if (apiKey === null) {
        res.status(409).json({
          error: 'No SayIntentions API key is saved. Add one under Prefiles → SayIntentions first.',
          code: 'NO_API_KEY',
        });
        return;
      }

      // The literal 'now' selects the "from now" mode; every other value,
      // including a missing one, means 'session_start' — an unknown value
      // must not be an error on a route whose default is the safe one.
      const fromParam = typeof req.query.from === 'string' ? req.query.from : '';
      const fromNow = fromParam === 'now';

      let result;
      try {
        result = await getCommsHistory(apiKey);
      } catch (err) {
        if (err instanceof SayIntentionsFetchError) { respondUpstreamError(res, err); return; }
        throw err;
      }

      if (result.flight_id === null && result.comm_history.length === 0) {
        res.status(409).json({
          error: 'SayIntentions has no comms for this key yet. Start your flight in the sim with SayIntentions connected, make one radio call, then link.',
          code: 'NO_COMMS_TO_LINK',
        });
        return;
      }

      const baseline = maxCommId(result.comm_history, 0);

      const existed = getSayIntentionsLink(id) !== null;
      const link = upsertSayIntentionsLink({
        flight_id: id,
        upstream_flight_id: result.flight_id,
        since_id: fromNow ? baseline : null,
        baseline_comm_id: baseline,
        linked_at: new Date().toISOString(),
      });

      const body: SayIntentionsLinkResponse = {
        flight_id: id,
        created: !existed,
        link,
        pending_messages: fromNow ? 0 : result.comm_history.length,
      };
      res.status(existed ? 200 : 201).json(body);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete('/flights/:id/sayintentions/link', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' }); return; }

    try {
      const flight = getFlightById(id);
      if (!flight) { res.status(404).json({ error: `Flight ${id} not found`, code: 'FLIGHT_NOT_FOUND' }); return; }

      const unlinked = deleteSayIntentionsLink(id);
      res.json({ flight_id: id, unlinked });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/flights/:id/sayintentions/import', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' }); return; }

    try {
      const flight = getFlightById(id);
      if (!flight) { res.status(404).json({ error: `Flight ${id} not found`, code: 'FLIGHT_NOT_FOUND' }); return; }

      const apiKey = getSetting(SAYINTENTIONS_API_KEY_SETTING);
      if (apiKey === null) {
        res.status(409).json({
          error: 'No SayIntentions API key is saved. Add one under Prefiles → SayIntentions first.',
          code: 'NO_API_KEY',
        });
        return;
      }

      const link = getSayIntentionsLink(id);
      if (!link) {
        res.status(409).json({
          error: 'This flight is not linked to a SayIntentions session yet. Press LINK SAYINTENTIONS while your session is running.',
          code: 'NOT_LINKED',
        });
        return;
      }

      let result;
      try {
        result = await getCommsHistory(apiKey, link.since_id);
      } catch (err) {
        if (err instanceof SayIntentionsFetchError) { respondUpstreamError(res, err); return; }
        throw err;
      }

      // Session-changed guard: a manual link is only trustworthy if today's
      // session is still the one it was pointed at. Skipped — import
      // proceeds — when either side names no session, since there is then
      // nothing to compare.
      if (link.upstream_flight_id !== null && result.flight_id !== null && link.upstream_flight_id !== result.flight_id) {
        res.status(409).json({
          error: 'SayIntentions is now on a different flight session than the one this flight was linked to. Unlink and link again to import its comms.',
          code: 'SESSION_CHANGED',
        });
        return;
      }

      const fallbackIso = new Date().toISOString();
      let imported = 0;
      let alreadySeen = 0;
      let skipped = 0;
      const written: AcarsMessage[] = [];

      for (const entry of result.comm_history) {
        const rows = mapCommEntryToRows(entry, id, fallbackIso);
        if (rows.length === 0) { skipped++; continue; }
        for (const row of rows) {
          const { message, created } = insertAcarsMessageOnce(row);
          if (created) {
            imported++;
            written.push(message);
          } else {
            alreadySeen++;
          }
        }
      }

      // Computed over every entry in the response, including ones that were
      // skipped or produced no row, so a skipped entry can never make the
      // next import re-fetch the same window forever. Left exactly as it was
      // when the response carried no entries at all.
      let newSince = link.since_id;
      if (result.comm_history.length > 0) {
        newSince = maxCommId(result.comm_history, link.since_id ?? 0);
      }

      const advanced = advanceSayIntentionsCursor(id, newSince, imported, new Date().toISOString(), result.flight_id);
      if (!advanced) throw new Error(`SayIntentions link for flight ${id} vanished during import`);

      const body: SayIntentionsImportResponse = {
        flight_id: id,
        imported,
        already_seen: alreadySeen,
        skipped,
        since_id: advanced.since_id,
        messages: written,
      };
      res.status(imported > 0 ? 201 : 200).json(body);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Leg-scoped, not flight-scoped, and needs no link: sayAs addresses
  // "whatever session this key currently holds," so linking would block the
  // common case of an operator who pushes without ever pulling. Takes no
  // request body. Not idempotent — a repeat send files a second row, the same
  // choice the WX route makes: a pilot whose first uplink was missed in the
  // sim must be able to press it again.
  router.post('/planned-legs/:legId/sayintentions/clearance', async (req, res) => {
    const legId = parseInt(req.params.legId, 10);
    if (isNaN(legId)) { res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' }); return; }

    try {
      if (!getPlannedLegById(legId)) {
        res.status(404).json({ error: `Planned leg ${legId} not found`, code: 'PLANNED_LEG_NOT_FOUND' });
        return;
      }

      const apiKey = getSetting(SAYINTENTIONS_API_KEY_SETTING);
      if (apiKey === null) {
        res.status(409).json({
          error: 'No SayIntentions API key is saved. Add one under Prefiles → SayIntentions first.',
          code: 'NO_API_KEY',
        });
        return;
      }

      const clearanceMessage = findAcarsMessageByDedupKey(clearanceDedupKey(legId));
      const details = clearanceMessage ? parseClearancePayload(clearanceMessage.payload_json) : null;
      if (!clearanceMessage || !details) {
        res.status(409).json({
          error: 'No clearance has been issued for this leg yet. Press REQUEST CLEARANCE first.',
          code: 'NO_CLEARANCE',
        });
        return;
      }

      const sentText = buildCondensedClearanceMessage(details);
      const from = details.departure_icao ?? 'DISPATCH';

      let result;
      try {
        result = await sayAs(apiKey, {
          channel: 'ACARS_IN', message: sentText, from, messageType: 'cpdlc', rephrase: 0,
        });
      } catch (err) {
        if (err instanceof SayIntentionsFetchError) { respondUpstreamError(res, err); return; }
        throw err;
      }

      const sentAt = new Date().toISOString();
      const payload: SayIntentionsPushPayload = {
        v: 1,
        source: 'sayintentions',
        channel: 'ACARS_IN',
        message_type: 'cpdlc',
        from,
        sent_text: sentText,
        sent_at: sentAt,
        upstream_excerpt: result.rawText,
      };

      // A new row, not an update to the stored clearance: this is the event
      // of delivering it, with its own timestamp, in the same append-only
      // thread as every other acars_messages write.
      const message = insertAcarsMessage({
        planned_leg_id: legId,
        direction: 'uplink',
        category: 'pdc',
        label: 'PDC SENT',
        body: sentText,
        payload_json: JSON.stringify(payload),
        correlation_id: clearanceMessage.id,
        sent_at: sentAt,
      });

      const body: SayIntentionsPushResponse = { planned_leg_id: legId, sent_text: sentText, message };
      res.status(201).json(body);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
