# SayIntentions.AI SAPI — research notes (Orchestrator, 2026-09-17)

Reference material for this run only. Pulled from https://p2.sayintentions.ai/p2/docs/
(the real SAPI reference — `kb.sayintentions.ai` itself has no published articles)
plus corroborating search snippets from SayIntentions' Freshdesk KB. Not verified
against a live key/session — treat exact field names as best-effort, confirm
against a real response during implementation.

## Auth

Personal **pilot API key** — self-service from the pilot's own SayIntentions
account/portal, free while SAPI is in preview. This is distinct from a
**partner `va_api_key`** (Discord-approval-gated, used only by `importVAData`).
This run is scoped to pilot-key-only endpoints — no partner approval assumed
or required.

## Endpoints this run uses

### `getCommsHistory` (pull design)
`GET https://apipri.sayintentions.ai/sapi/getCommsHistory`
- Auth: `api_key` only, no active-session requirement.
- Params: `api_key` (required), `since_id` (optional, integer — incremental
  polling cursor).
- Returns: `{ flight_id, comm_history: [...], mission: {...} }`.
  `comm_history[]` fields (best-effort from docs): `id`, `ident`, `copilot`,
  `lat`, `lon`, `frequency`, `is_acars` (bool), `channel`, `stamp_zulu`,
  `station_name`, `incoming_message`, `incoming_message_english`,
  `outgoing_message`, `outgoing_message_english`, `language`, `atc_url`,
  `pilot_url`. `mission`: `mission_id`, `mission_type`, `status`.
- `id` is SayIntentions' own monotonic-ish message id (used as `since_id`
  cursor) — it is **not** correlated to our `acars_messages.id` or to any
  msfslogger flight id.
- `flight_id` in the response is SayIntentions' own flight/session id, not
  ours — confirms there is no shared identifier between the two systems.

### `sayAs` (push design)
`GET https://apipri.sayintentions.ai/sapi/sayAs`
- Auth: `api_key` + an **active flight session** in SayIntentions (i.e. the
  pilot must currently be flying/connected in their sim with SayIntentions
  running) — calling this with no active session is expected to fail.
- Params: `api_key`, `channel` (required — use `ACARS_IN` for this run:
  "send a message from an ACARS/CPDLC/Telex station to the pilot"), `message`
  (required, ≤255 chars generally, **≤128 chars for `ACARS_IN`**), optional
  `rephrase` (0/1), `from` (ACARS-only — sending station/callsign),
  `response_code` (ACARS-only), `message_type` (ACARS-only: `'cpdlc'` or
  `'telex'`).
- Returns: a confirmation of transmission (exact shape unconfirmed).
- No webhook/callback — this is fire-and-forget from our side; whether it
  was actually delivered/seen in-sim is only checkable indirectly via
  `getCommsHistory` afterward.

## Constraints/unknowns to flag to the Designer

1. **No shared session/flight id.** Every call is scoped to "the pilot's
   currently active SayIntentions session," identified only by their
   `api_key`. There is no way to ask "give me comms for msfslogger flight
   #42" — only "give me comms since message id N for whoever holds this
   key." Correlation to *our* flight/trip is our problem to solve, not
   something the API gives us.
2. **128-char cap on ACARS_IN.** Our existing generated PDC body
   (`buildClearanceBody`, multi-line, unbounded route length via
   `clampRoute()`) will not fit as-is — needs a condensed/telex-shaped
   rendering, not a reuse of the existing multi-line body text.
3. **`sayAs` requires an active session; `getCommsHistory` does not.** A
   push attempt with no active SayIntentions session is a normal, expected
   failure (pilot flying without SayIntentions running that day), not a bug.
4. **Rate/preview status.** Docs describe SAPI as "currently in PREVIEW and
   Free" — no documented rate limits found. Treat as an external dependency
   that can fail or change shape without notice, same posture as the
   existing `aviationweather.gov` client (`src/weatherClient.ts`).
5. **This is genuinely optional.** Nothing in this run should change
   behavior for an operator who never sets a SayIntentions key — mirrors how
   SimBrief import is fully optional today (`getSetting` returns null,
   features that need it 409/no-op).

## Existing patterns to build on (this repo)

- **Settings storage**: `src/routes/settings.ts` + `getSetting`/`setSetting`
  (`src/db`), keyed by a string constant — `SIMBRIEF_USER_ID_SETTING` is the
  precedent for a new `SAYINTENTIONS_API_KEY_SETTING` (and a per-flight/trip
  link value, see below).
- **Outbound HTTP client with caching/typed errors**: `src/weatherClient.ts`
  (`getCachedWeather`, `WeatherFetchError`) is the template for a new
  `sayIntentionsClient.ts`.
- **ACARS message model**: `acars_messages` table is already generic
  (flight- or leg-scoped, `direction`, `category`, `label`, `body`,
  `payload_json`, `correlation_id`, `dedup_key` via `insertAcarsMessageOnce`)
  — see `.claude/runs/2026-09-17-acars-pdc-request/intake.md` for the most
  recent addition to this model (`'pdc'` category, `ClearanceDetails`,
  `buildClearanceBody`). Both designs in this run almost certainly reuse this
  table rather than adding a new one.
- **Ingest-token scoping**: `src/auth/ingestScope.ts`'s `INGEST_SCOPED_ROUTES`
  allow-list — relevant if either new route should be callable by the MCDU
  client, not just the browser session.
