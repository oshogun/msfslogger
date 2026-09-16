# Intake — Prefiles screen filters

Run id: `2026-09-16-prefiles-filters`
Tier: **2** — single seam (`client/src/pages/Prefiles.tsx` only), no new
contract (filtering is client-side over the already-fetched
`GET /api/planned-legs` result). Per `.claude/agents.md` § Cost discipline
rule 6, this run skips Planner/Designer/DevOps; `intake.md` is the only
artifact besides the diff and one review.

## Goal

User: "Add some filters for the prefile screen. Just listing them all is
going to grow out of hand very quickly." The Prefiles page
(`client/src/pages/Prefiles.tsx`, shipped in `2026-09-16-loose-flight-prefile`)
currently renders every planned leg — loose and trip-linked — with no way to
narrow the list.

## Scope decided by the Orchestrator (no Designer for tier-2 work)

Three client-side filters over the `legs` array already held in state,
combined with AND, all client-side (no new endpoint, no server change):

1. **Status** — `All / Planned / Skipped / Flown / Diverted`, matching
   `PlannedLegStatus` (`src/types.ts` / `client/src/types.ts`) and the same
   labels `plannedLegBadge()` in `PlannedLegRows.tsx` already uses.
2. **Trip** — `All / No trip / <trip name>` for every trip actually present
   among the loaded legs (derived from `leg.trip_id`/`leg.trip_name`, not a
   second API call). "No trip" matches `trip_id === null`.
3. **Search** — a free-text box matching (case-insensitive, substring) against
   `departure_ident`, `destination_ident`, and `aircraft_type`.

Default state: all three filters at "show everything" (today's behavior
unchanged for a user who never touches them). Filters live in local
component state (`useState`), not the URL — reset on navigation away, same
as the rest of this page's transient state.

## Non-negotiables

- No API/schema change. No new route. This is UI-only.
- The existing loose/trip-linked grouping (`tr-ghost` header row + `GhostLegRow`)
  stays as-is — filters narrow which legs render, they don't change how a
  shown leg renders.
- Filtering must not break any of the page's existing interactions (import,
  skip/unskip, delete, link-to-flight) — those still act on the real,
  unfiltered `legs` state array via leg id, never an index into the filtered
  view.
- Empty-state message must adapt: "No planned legs yet" only when the
  *unfiltered* list is empty; a distinct "No planned legs match these
  filters" message when filters have hidden everything.
