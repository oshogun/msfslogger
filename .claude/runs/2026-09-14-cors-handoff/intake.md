# Intake — MSFS Coherent gauge CORS handoff

## Goal

Allow the in-sim MSFS Coherent GT gauge at origin `coui://html_ui` to send
authenticated JSON requests to `/api/ingest/*`, without broadening CORS access
for any other origin or application route.

## Frozen user requirements

- CORS middleware applies only to `/api/ingest/*`.
- The only allowed origin is `coui://html_ui`; no wildcard origin.
- Allowed methods are `POST, OPTIONS`.
- Allowed headers are `Content-Type, X-Ingest-Token`.
- Responses for the allowed origin include `Vary: Origin`.
- Allowed-origin preflight returns `204` without ingest authentication.
- Actual POST requests retain the existing ingest-token authentication and
  response behavior, including `401` for an invalid token.
- Unrelated origins receive no allow-origin header.
- Origin-less desktop-agent requests behave exactly as before.

## Success criteria

1. `OPTIONS /api/ingest/frame` from `coui://html_ui` returns `204`, an empty
   body, and the four required CORS headers.
2. A valid authenticated frame POST from that origin retains its existing
   status/behavior and includes the allowed-origin header.
3. An invalid-token frame POST still returns `401` and exposes that response
   through the allowed-origin header.
4. A request from an unrelated origin has no `Access-Control-Allow-Origin`.
5. A request without `Origin` retains existing desktop-agent behavior.
6. `npm test` and `npm run test:types` pass under Node 20.

## Workflow

Tier 2: one backend implementer followed by an independent reviewer. This is a
single router seam with a fully specified contract. Planner and Designer are
skipped because no schema, endpoint, payload, or shared type is introduced.
DevOps is skipped because the task does not modify build, packaging, deployment,
or the protected live server. Network deployment verification remains an
operator follow-up after deployment.

## Constraints

- Do not stop, restart, rebuild over, or reconfigure the user's server on port
  3000.
- Do not read from or write to live `flights.db` for verification.
- Use Node 20 via nvm for every Node/npm/npx command.
- Limit implementation edits to `src/ingest.ts` and request-level tests under
  `tests/`.
- Preserve the saved brief at `user_stories/cors_handoff.md`.
