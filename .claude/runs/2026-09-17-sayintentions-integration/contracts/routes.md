# Route table — frozen

Reference stub. Mirrors design.md §9.1, §10.1 and §13; if the two ever
disagree, design.md wins and this file is the one to amend.

Every route below is mounted at `/api` by `createSayIntentionsRouter()` in
`src/routes/sayIntentions.ts` (settings routes excepted — they go in the
existing `src/routes/settings.ts`), behind `requireAuth` and
`requireSameOrigin`, and **before the SPA catch-all**. Registration point in
`src/server.ts`: immediately after `app.use('/api', createAcarsRouter());` and
before `createGroundSessionsRouter`.

**No route in this design accepts a request body** except the two settings
routes. The link mode is a query parameter, so `express.json()` can never
reject a malformed body on one of these paths and `src/server.ts`'s
SyntaxError handler needs no new clause.

| # | Method | Path | Body | Success | Owner |
|---|--------|------|------|---------|-------|
| R1 | GET | `/api/settings/sayintentions` | — | 200 `SayIntentionsSettings` | T-003 |
| R2 | PUT | `/api/settings/sayintentions` | `{ sayintentions_api_key: string \| null }` | 200 `SayIntentionsSettings` | T-003 |
| R3 | GET | `/api/flights/:id/sayintentions/link` | — | 200 `SayIntentionsLinkStatus` | T-006 |
| R4 | POST | `/api/flights/:id/sayintentions/link` | — (`?from=now\|session_start`) | 201 new / 200 re-link, `SayIntentionsLinkResponse` | T-006 |
| R5 | DELETE | `/api/flights/:id/sayintentions/link` | — | 200 `{ flight_id, unlinked: boolean }` | T-006 |
| R6 | POST | `/api/flights/:id/sayintentions/import` | — | 201 when `imported > 0`, else 200, `SayIntentionsImportResponse` | T-006 |
| R7 | POST | `/api/planned-legs/:legId/sayintentions/clearance` | — | 201 `SayIntentionsPushResponse` | T-009 |

## Reachability

No existing router can capture any of these. `src/routes/flights.ts` registers
`/flights/:id` (2 segments), `/flights/:id/flight-plan` (3) and
`/flights/combine`; R3–R6 are 4 segments. `src/routes/plannedLegs.ts` registers
`/planned-legs/:legId` (2), `/planned-legs/simbrief` (2) and
`/flights/:id/planned-leg[-status]` (3); R7 is 4 segments. `src/routes/acars.ts`
owns `…/acars-messages*` only.

## Ingest-token scope

None of R1–R7 is added to `INGEST_SCOPED_ROUTES`. `src/auth/ingestScope.ts` and
`tests/ingestScope.test.ts` are untouched by this design — see design.md §13
for the per-route reasoning and for the exact entries a later run would add.
