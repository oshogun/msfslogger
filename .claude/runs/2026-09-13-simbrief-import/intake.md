# Intake — SimBrief flight plan import

Run id: 2026-09-13-simbrief-import
Orchestrator: Claude (msfslogger session)
Source: `user_stories/simbrief_integration.md` (verbatim requirements below)

## Goal (restated)

Add a second planned-leg import source alongside the existing Little Navmap
(`.lnmpln`) import: a one-click "Import from SimBrief" action that fetches the
user's most recent SimBrief OFP/route via a saved SimBrief User ID and appends
it to a trip's planned legs, in the same `planned_legs` shape the `.lnmpln`
import already produces. The `.lnmpln` path must keep working unchanged.

## Success criteria (acceptance criteria, verbatim from the user story)

1. A visible SimBrief User ID field exists and accepts valid input.
2. The SimBrief User ID is stored and prefilled on next app load/session.
3. Clicking **Import from SimBrief** triggers a fetch for the latest SimBrief
   plan for that User ID.
4. Imported route legs appear in planned legs without manual re-entry.
5. If fetch fails (invalid ID, network/API error, no recent plan), the user
   sees a clear error message and existing planned legs remain unchanged.
6. Little Navmap integration continues to work as before.

Non-functional (from the story): import completes in reasonable time under
normal network conditions; error states are user-friendly and actionable;
import success/failure is logged for troubleshooting.

## Facts gathered from the codebase (survey, not guesses)

- `planned_legs` / `planned_waypoints` / `planned_alternates` tables
  (`src/db.ts:90-226`) are the target shape. `src/db.ts` never imports the
  `.lnmpln` parser's types — it declares its own structurally-compatible
  `CreatePlannedLegPlan`/`CreatePlannedLegInput` (`src/db.ts:767-851`), and
  `src/server.ts` is the only module that sees both the parser's output type
  and the db's input type, duck-typing one into the other. A SimBrief parser
  should follow the same seam: its own `ParsedSimbriefPlan` type, structurally
  compatible with `CreatePlannedLegPlan`, wired in `src/server.ts`.
- The `.lnmpln` import is `POST /api/trips/:id/planned-legs`
  (`src/server.ts:523-643`), parsed by `src/lnmpln.ts` (`parseLnmpln`), and its
  UI lives inline on the per-trip page (`client/src/pages/TripDetail.tsx:567-580`,
  handler `handleImportPlannedLegs` at 189-233) — there is **no existing global
  settings/integrations page** anywhere in the client.
- No user-editable settings persistence exists today. `src/config.ts` is
  env-var/boot-time only. The closest server-side key/value pattern is
  `app_secret` (`src/db.ts:258-262`, `getAppSecret`/`getOrCreateAppSecret` at
  1457-1476) — a `name TEXT PRIMARY KEY, value TEXT, created_at` table, though
  that one is documented for server-generated secrets, not user input. A new,
  small key/value settings table follows the same shape.
- The SimBrief User ID must be read by the **server** (it makes the outbound
  call), so it has to be persisted server-side, not in browser `localStorage`.
- No HTTP client dependency exists. Node 20 (pinned, see `.claude/ENVIRONMENT.md`)
  has a built-in `fetch`, already used server-side in `src/flightManager.ts:601`.
  `src/airports.ts` shows the other outbound-HTTP precedent (raw `https.get`).
  SimBrief import should use native `fetch`, no new dependency.
- Test pattern to imitate: `tests/lnmpln.test.ts` — pure parser tests against
  committed fixture files (`samples/lnmpln/*.lnmpln`), no network, no db. There
  is no route-level HTTP test for the `.lnmpln` endpoint either, so SimBrief
  doesn't need one to match existing coverage — but the outbound-fetch call
  itself is new ground (nothing in the repo mocks `fetch`/`https` today) and
  needs its own seam (an injectable fetcher) so the parser/orchestration logic
  can be unit-tested without a real network call.

## Decisions made now (reasonable defaults, not escalated)

These are implementation-shape calls consistent with existing patterns, not
ambiguous requirements — recorded here so Design freezes them rather than
re-deriving them:

1. **No new global settings page.** The SimBrief User ID field and the
   "Import from SimBrief" button live inline on `TripDetail.tsx`, next to the
   existing "Import Planned Route (.lnmpln)" section — same place a user
   already goes to populate planned legs for a trip.
2. **Single global setting, not per-trip.** This is a single-operator logbook
   app (no multi-tenant user model in scope) — the SimBrief User ID is one
   saved value, reused for every trip's import, similar in spirit to
   `app_secret` being a single row. Design should confirm there's no
   multi-user auth context (`src/auth/`) that would change this.
3. **New settings table**, not a repurposed `app_secret` — that table's own
   doc comment scopes it to server-generated secrets.
4. **New parser module** `src/simbrief.ts`, mirroring `src/lnmpln.ts`'s shape
   (a pure `parseSimbriefPlan(json): ParsedSimbriefPlan` function, exceptions
   for hard failures, a `warnings[]` array for soft issues) and wired into
   `POST /api/trips/:id/planned-legs` or a sibling endpoint the same way.
5. **Native `fetch`**, no new runtime dependency, for the outbound call to
   SimBrief's API.
6. The exact SimBrief API endpoint/response shape (XML vs JSON feed, field
   names, "no recent plan" signal) is **not yet verified against SimBrief's
   real API** — this is Design's job (it has WebFetch/WebSearch) before any
   code is written, same rigor as the LNM run's XSD verification pass
   (`.claude/runs/2026-09-04-lnmpln-trip-planner/intake.md` § "LNMPLN format —
   verified facts").

## Steps this run takes / skips

- **Plan** — yes, delegate to `planner`.
- **Design** — yes. This run introduces a contract (new settings table +
  endpoint(s), a new parsed-plan type crossing the `lnmpln`-style seam into
  `src/server.ts`, verified SimBrief API shape). Freeze before implementation.
- **Implement** — backend (settings table/endpoint, SimBrief parser, import
  endpoint) and frontend (settings field + import button on `TripDetail.tsx`)
  are separate tasks/agents per the domain-never-shares rule.
- **Ship (DevOps)** — skipped. No new runtime dependency, no build/packaging/
  deploy change expected (native `fetch` avoids a new dependency). Revisit if
  Design decides otherwise.

## Non-negotiables carried into every task envelope

- Never touch the running server (port 3000) or the live `flights.db`. Scratch
  port + scratch db copy for any verification that needs a live server.
- Node 20 via nvm for every command.
- No agent commits, pushes, or switches branches — Orchestrator only.
