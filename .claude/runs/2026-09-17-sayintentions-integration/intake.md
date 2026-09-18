# Intake — SayIntentions.AI optional integration (pull + push)

Run id: 2026-09-17-sayintentions-integration
Orchestrator: Claude (msfslogger session)
Source: user conversation, 2026-09-17 (SayIntentions API exploration →
narrowed to pilot-key-only integrations → user asked for a full spec)

## Goal (restated)

Produce a frozen design — not implementation — for two independent, optional
integrations between msfslogger and SayIntentions.AI's pilot-facing SAPI:

1. **Pull**: import SayIntentions' ATC/CPDLC comms transcript
   (`getCommsHistory`) into a flight's existing ACARS message thread.
2. **Push**: deliver msfslogger's already-generated PDC/clearance content
   into the pilot's live SayIntentions session as a real in-sim ACARS/CPDLC
   message (`sayAs`, `channel=ACARS_IN`).

This run stops at Design. Nothing is implemented, reviewed, or shipped here
— the user asked specifically for "the specification for both designs."

## Success criteria

- `design.md` covers, for both directions:
  - How an operator's SayIntentions pilot API key is stored (mirroring the
    existing SimBrief-key settings pattern).
  - How one msfslogger flight/trip is linked to "whichever SayIntentions
    session this key currently holds" — the correlation problem noted below
    is real and has no API-provided answer; the Designer resolves it.
  - Exact new/changed API routes, request/response shapes, error codes.
  - Whether either direction reuses the existing `acars_messages` table
    (default assumption, per precedent) or needs a new one, and why.
  - Failure modes: no key set, no active SayIntentions session, upstream
    error/timeout, malformed upstream payload — each mapped to a specific,
    non-crashing outcome, same posture as `weatherClient.ts`/`WeatherFetchError`.
  - Where each half is triggered from (operator-initiated button vs. a
    background poll) and why.
- Both features are fully optional: an operator who never sets a
  SayIntentions key sees zero behavior change anywhere else in the app.
- No design decision silently assumes a partner API key — pilot key only.

## Frozen decisions (user, verbatim)

- "I don't have a partner API. Narrow it down to what can be integrated with
  a pilot's api." → scope is pilot-key endpoints only; `importVAData`
  (partner `va_api_key`) is out of scope entirely.
- "yes, write the specification for both designs. It's fine to have an extra
  per-flight step of linking the two sessions, as sayintentions can't be
  assumed for regular usage of msfslogger and is an optional enhancement
  option." → a manual per-flight (or per-trip) linking step is an accepted,
  frozen part of the design, not something to design around. "Optional
  enhancement" is explicit: default-off, no regression for operators who
  don't use it.

## Research already done (Orchestrator, this session)

Full findings in
[`sayintentions-api-notes.md`](sayintentions-api-notes.md) (same directory)
— endpoint reference for `getCommsHistory` and `sayAs`, auth model, the
128-char `ACARS_IN` cap, the no-shared-session-id constraint, and pointers to
the existing repo patterns (`weatherClient.ts`, `settings.ts`,
`acars_messages`, `.claude/runs/2026-09-17-acars-pdc-request/`) to build on.
Pass this file to Planner/Designer by path — do not re-fetch the SayIntentions
docs unless verifying a specific field against a live response.

## Tier and steps taken

**Tier 3** (full loop) — this introduces a new external integration, at least
one new settings key, a new correlation concept (linking a flight/trip to a
SayIntentions session), and touches the ACARS contract in both directions.
That's a schema/API-shape decision worth freezing before any code exists.

Steps for *this* delegation: **Intake → Plan → Design**, then report back to
the user. Implement/Review/Ship are deliberately not started — the user asked
for the specification, not the feature. When/if the user says to build it,
resume the loop at Implement using the frozen `plan.json`/`design.md` from
this run.

## Out of scope (this run)

- `importVAData` / any partner-key-gated endpoint.
- `setFreq`/`setVar`/`setPause`/`getAirport`/`assignGate`/`getParking` —
  sim-control and airport-ops endpoints, out of msfslogger's domain as a
  passive logger (per prior conversation ranking).
- `getWX`/`getVATSIM`/`getTFRs` — redundant with existing weather source or
  out of domain (no ATC/map-overlay feature exists to attach them to).
- Actual implementation, tests, MCDU-client coordination — follow-on runs
  once/if the user approves the design.
