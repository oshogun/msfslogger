// Reference artifact for run 2026-09-18-mcp-server. NOT compiled, NOT imported
// by the build. Authoritative prose: design.md §6.5.
//
// Type ownership: SimbriefImportOutcome + importSimbriefLooseLeg live in the
// NEW file src/simbriefImport.ts. src/routes/plannedLegs.ts keeps ownership of
// the route; src/mcp/tools/write.ts calls the same function.
//
// This is pure code motion out of src/routes/plannedLegs.ts's
// `router.post('/planned-legs/simbrief', ...)` handler (today lines ~430-517).
// The trip-nested variant (`/trips/:id/planned-legs/simbrief`) is NOT touched.

import type { PlannedLegWithChildren } from '../../../../src/types';

/** `status` is the HTTP status the existing route already returns for this
 *  outcome, and `body` is the exact JSON body it already sends — so the route
 *  handler reduces to `res.status(o.status).json(o.body)` and a Reviewer can
 *  diff old-vs-new response shapes case by case (§12, must-not-change #7).
 *  Every console.log/console.error line the route emits today moves into this
 *  function unchanged, including the `(no trip)` suffix. */
export type SimbriefImportOutcome =
  | {
      kind: 'imported';
      status: 201;
      body: {
        imported: [PlannedLegWithChildren];
        result: { status: 'imported'; planned_leg_id: number; label: string; warnings: string[] };
      };
      plannedLegId: number;
      label: string;
    }
  | {
      kind: 'duplicate';
      status: 200;
      body: {
        imported: [];
        result: {
          status: 'duplicate';
          planned_leg_id: number;
          label: string;
          warnings: [];
          error: string;
        };
      };
      plannedLegId: number;
      label: string;
    }
  | {
      kind: 'error';
      /** 400 NO_USER_ID | SIMBRIEF_FAILURE_STATUS[code] | 502 BAD_BODY | 500 | 500 DB_ERROR */
      status: number;
      body: { error: string; code?: string };
      /** Present whenever the body has one; the MCP tool reports it verbatim. */
      code?: string;
    };

export function importSimbriefLooseLeg(opts: {
  /** From the route: `req.body?.allow_duplicates === true`. From the MCP tool:
   *  the zod-validated `allow_duplicates` input, default false. */
  allowDuplicates: boolean;
}): Promise<SimbriefImportOutcome>;
