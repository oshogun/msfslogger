# Intake — Security hardening

Run id: 2026-09-10-security-hardening
Orchestrator: Claude (msfslogger session)

## Goal (restated)

msfslogger currently ships with no authentication on the main web API at all
(flight/trip CRUD, deletes, PDF upload, KML export) and *optional* authentication
on the SimConnect agent ingest endpoints (`INGEST_TOKEN`, unset by default). The
README documents this as acceptable on a trusted LAN, not recommended otherwise.
The user wants the secure configuration to be the default, not something an
operator has to opt into, and wants the app safe to expose beyond localhost.

## Current state (verified against code, not assumed)

- `src/ingest.ts:120` — `INGEST_TOKEN` read from env; if unset, ingest endpoints
  (`/api/ingest/frame`, `/event`, `/traffic`) are unauthenticated. Documented at
  `README.md:26`.
- `src/server.ts` — **zero auth** on any route: `DELETE /api/flights/:id`,
  `DELETE /api/trips/:id`, `DELETE /api/trips/:id/flights/:flightId`,
  `DELETE /api/planned-legs/:legId`, `DELETE /api/flights/:id/flight-plan`,
  `POST /api/flights/combine`, and all reads, are open to anyone who can reach
  the port.
- `src/index.ts:23` — `app.listen(PORT)` with no host argument binds all
  interfaces (`0.0.0.0`), not just localhost.
- PDF upload (`server.ts:391`, flight-plan attach) **already validates**:
  `multer` `fileSize` limit (20 MB) + `mimetype === 'application/pdf'` +
  magic-byte sniff via `isPdfBuffer`. `.lnmpln` upload already has its own
  tighter limits (512 KB/file, 25 files) and content-sniffs for `<` after BOM
  strip. These are adequate as-is; this run should confirm, not rebuild, unless
  the Designer finds a gap.
- `express.json()` (`server.ts:122`) has no explicit `limit` — Express defaults
  JSON body parsing to `100kb`, which is already reasonably strict, but no other
  route-specific limits exist and this should be made explicit/reviewed rather
  than left implicit.
- No TLS anywhere in the app; no session/cookie infrastructure; no login route;
  no password/credential storage of any kind exists today.

## Success criteria

1. `INGEST_TOKEN` is required by default: the server refuses to start if it is
   unset, unless the operator sets an explicit, documented opt-out env var
   (e.g. `ALLOW_UNAUTHENTICATED_INGEST=1`) that the README labels insecure/LAN-only.
2. The web UI and its API — including destructive routes — are gated behind a
   session-based login (username/password form → server-side session cookie).
   No separate re-confirmation step for destructive actions; being logged in is
   sufficient, matching the rest of the API.
3. The Node server can terminate TLS itself (cert/key config via env vars),
   documented in the README, so HTTPS does not require a reverse proxy.
4. Upload validation (PDF, `.lnmpln`) and request-size limits are reviewed,
   made explicit where implicit, and tightened only where a real gap is found.
5. `README.md` is updated to reflect the new defaults and setup steps (env vars,
   generating/setting credentials, TLS cert config) — no more "fine on a trusted
   LAN" language for anything that is now authenticated by default.
6. Existing behavior for a purely localhost, all-defaults deployment keeps
   working after `npm run build` — i.e. this doesn't strand a user who takes no
   action beyond setting a password, on the same box, same port.

## Decisions already frozen by the user

Asked directly, verbatim choices:

- **Web UI auth mechanism**: session-based login page (username/password form,
  server-side session cookie) — not HTTP Basic Auth, not deferred to a reverse
  proxy.
- **HTTPS**: built into the Node server itself (cert/key config), not
  guidance-only / reverse-proxy-only.
- **INGEST_TOKEN default**: required by default, with an explicit, documented
  opt-out env var for LAN-only/insecure use — not auto-generated on first boot.
- **Destructive operations**: no separate authorization step beyond the
  standard session auth gate — deletes/combine are covered by the same login
  as everything else, not a re-confirmation prompt.

These four are frozen inputs to Design, not open questions for the Designer to
re-litigate. The Designer decides the mechanics (session store choice, cookie
settings, password hashing, cert file layout, migration path for existing
deployments) within these constraints.

## Tier and workflow steps

This is **full-loop** work (`.claude/agents.md` § Cost discipline rule 6): it
adds a new authentication/session contract, a new TLS/env-var contract, changes
a documented default (breaking for any deployment that relies on unauthenticated
ingest), touches several files across `src/`, `client/`, and `README.md`, and is
directly user-visible (login screen, changed startup behavior).

- **Design: required.** New contracts: session/cookie mechanism, password
  credential storage, TLS config surface, ingest opt-out env var, login
  API shape. Freeze before implementation.
- **Ship (DevOps): required.** Touches env/config surface (new required env
  vars can break `npm start` for an unconfigured deployment) and startup
  behavior; README/deploy docs need updating in step with the code.
- Planner and Reviewer run as normal for full-loop work.

## Non-negotiables carried into this run

- Never touch the user's live server (port 3000) or `flights.db` — all
  verification happens on a scratch port against a scratch DB copy per
  `.claude/ENVIRONMENT.md`.
- Credentials: this run introduces the app's first password. No credential
  value is ever logged, committed, or placed in a run artifact — only the
  mechanism (env var names, hashing scheme) is documented.
- 3 failed review rounds on any phase escalates to the user rather than
  continuing to iterate.
