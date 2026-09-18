import { createHash } from 'crypto';
import { createPlannedLeg, findPlannedLegBySource, getPlannedLegById } from './db/plannedLegs';
import { getSetting } from './db/settings';
import {
  SIMBRIEF_USER_ID_SETTING, parseSimbriefPlan, SimbriefParseError,
  type ParsedSimbriefPlan, type SimbriefWarning,
} from './simbrief';
import { fetchSimbriefPlan, SimbriefFetchError, type SimbriefErrorCode } from './simbriefClient';
import { insertAcarsMessageOnce } from './db/acarsMessages';
import { DISPATCH_RELEASE_LABEL, buildDispatchPayload, buildDispatchReleaseBody, dispatchDedupKey } from './acars';
import type { PlannedLegWithChildren } from './types';

/**
 * How a failed SimBrief request is reported. 502/504 rather than 500 because
 * the failure is upstream, and the distinction is what makes the log usable
 * when the operator reports "the import is broken". The trip-nested SimBrief
 * route (src/routes/plannedLegs.ts) keeps its own copy of this table rather
 * than importing it from here — that route is a separate, untouched copy of
 * this same import, not a caller of it.
 */
const SIMBRIEF_FAILURE_STATUS: Record<SimbriefErrorCode, number> = {
  UNKNOWN_USER: 400,
  NO_PLAN: 404,
  TIMEOUT: 504,
  NETWORK: 502,
  BAD_STATUS: 502,
  BAD_BODY: 502,
};

export type SimbriefImportOutcome =
  | {
      kind: 'imported';
      status: 201;
      body: {
        imported: [PlannedLegWithChildren];
        result: { status: 'imported'; planned_leg_id: number; label: string; warnings: SimbriefWarning[] };
      };
    }
  | {
      kind: 'duplicate';
      status: 200;
      body: {
        imported: [];
        result: {
          status: 'duplicate'; planned_leg_id: number; label: string; warnings: [];
          error: string;
        };
      };
    }
  | {
      kind: 'error';
      status: number;
      body: { error: string; code?: string };
    };

/**
 * The loose-leg SimBrief import (no trip attached): settings read, SimBrief
 * fetch, parse, duplicate check, createPlannedLeg as the first and only write
 * to planned_legs, then the ACARS dispatch release in its own try/catch. This
 * step order is the contract and does not move.
 *
 * Shared by POST /api/planned-legs/simbrief and the import_simbrief_leg MCP
 * tool so the dedup hash and dedup key are computed in exactly one place —
 * two independent copies would risk filing duplicate planned legs and
 * duplicate dispatch messages the moment they drifted.
 */
export async function importSimbriefLooseLeg(
  { allowDuplicates }: { allowDuplicates: boolean },
): Promise<SimbriefImportOutcome> {
  const userId = getSetting(SIMBRIEF_USER_ID_SETTING);
  if (userId === null) {
    console.error('[SIMBRIEF] import failed: NO_USER_ID (no trip)');
    return {
      kind: 'error',
      status: 400,
      body: {
        error: 'No SimBrief User ID is saved. Enter your SimBrief Pilot ID above and save it, then try again.',
        code: 'NO_USER_ID',
      },
    };
  }

  let plan: ParsedSimbriefPlan;
  try {
    plan = parseSimbriefPlan(await fetchSimbriefPlan(userId));
  } catch (err) {
    if (err instanceof SimbriefFetchError) {
      console.error(`[SIMBRIEF] import failed: ${err.message}`);
      return {
        kind: 'error',
        status: SIMBRIEF_FAILURE_STATUS[err.code],
        body: { error: err.userMessage, code: err.code },
      };
    }
    if (err instanceof SimbriefParseError) {
      // The request succeeded and SimBrief said Success; the payload just had
      // no usable route in it. Still upstream's doing, so 502 and not 500.
      console.error(`[SIMBRIEF] import failed: BAD_BODY (${err.code}: ${err.message})`);
      return {
        kind: 'error',
        status: 502,
        body: { error: 'SimBrief returned a plan with no usable route.', code: 'BAD_BODY' },
      };
    }
    console.error(`[SIMBRIEF] import failed: INTERNAL (${String(err)})`);
    return { kind: 'error', status: 500, body: { error: String(err) } };
  }

  const label = `${plan.departure.ident} → ${plan.destination.ident}${plan.ofp.flightNumber ? ` (${plan.ofp.flightNumber})` : ''}`;
  const ofpId = plan.ofp.requestId ?? 'unknown';
  // NOT the hash of the response body, which the .lnmpln path uses on file
  // bytes: two requests for the same unchanged OFP come back differing in
  // SimBrief's own server-timing field, so a body hash would never match and
  // every re-import would land as a new leg. These three fields identify the
  // OFP itself and are stable across requests, while a newly generated OFP
  // changes them.
  const sha256 = createHash('sha256')
    .update(`simbrief\n${plan.ofp.requestId ?? ''}\n${plan.ofp.sequenceId ?? ''}\n${plan.ofp.timeGenerated ?? ''}`)
    .digest('hex');

  if (!allowDuplicates) {
    const existing = findPlannedLegBySource(null, sha256);
    if (existing) {
      // 200, not 4xx: nothing failed and nothing changed.
      console.log(`[SIMBRIEF] import duplicate: no-trip leg ${existing.id} ${plan.departure.ident}->${plan.destination.ident} ofp ${ofpId}`);
      return {
        kind: 'duplicate',
        status: 200,
        body: {
          imported: [],
          result: {
            status: 'duplicate', planned_leg_id: existing.id, label, warnings: [],
            error: `This SimBrief plan is already imported without a trip as leg ${existing.seq}. Generate a new OFP on simbrief.com, or re-import to add it again.`,
          },
        },
      };
    }
  }

  try {
    const legId = createPlannedLeg({
      tripId: null, plan, sourceFilename: `simbrief-${ofpId}.json`, sourceSha256: sha256,
    });
    console.log(
      `[SIMBRIEF] import ok: no-trip leg ${legId} ${plan.departure.ident}->${plan.destination.ident} ` +
      `${plan.waypoints.length} wpts ${plan.approxDistanceNm.toFixed(1)}nm ofp ${ofpId}`,
    );

    // Files the dispatch release into the new leg's ACARS thread. Its own
    // try/catch, and deliberately so: the leg is already committed by the
    // time this runs, so a failure here must not turn a successful import
    // into an error response — the leg exists either way, and a missing
    // message is recoverable while an error on a committed insert is not.
    // The key is the leg id, so running this twice for one leg is a no-op
    // rather than a second release.
    try {
      const issuedAt = new Date().toISOString();
      const payload = buildDispatchPayload(plan);
      insertAcarsMessageOnce({
        planned_leg_id: legId,
        direction: 'uplink',
        category: 'dispatch',
        label: DISPATCH_RELEASE_LABEL,
        body: buildDispatchReleaseBody(payload, issuedAt),
        payload_json: JSON.stringify(payload),
        dedup_key: dispatchDedupKey(legId),
        sent_at: issuedAt,
      });
    } catch (err) {
      console.error(`[SIMBRIEF] dispatch release not filed: leg ${legId} ofp ${ofpId} (${String(err)})`);
    }

    return {
      kind: 'imported',
      status: 201,
      body: {
        imported: [getPlannedLegById(legId)!],
        result: { status: 'imported', planned_leg_id: legId, label, warnings: plan.warnings },
      },
    };
  } catch (err) {
    console.error(`[SIMBRIEF] import failed: DB_ERROR (no trip, ofp ${ofpId}, ${String(err)})`);
    return { kind: 'error', status: 500, body: { error: String(err), code: 'DB_ERROR' } };
  }
}
