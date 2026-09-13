# SimBrief fixtures

## Layout

    samples/simbrief/*.json, *.txt         raw, unedited responses from SimBrief
    samples/simbrief/synthetic/*           hand-built bodies, one per rejection

## The real captures

Both files at the top level are **raw, unedited response bodies** from
SimBrief's dispatch API, captured with `curl` on **2026-09-13** (UTC). Nothing
was reformatted, trimmed or hand-edited — byte-for-byte what came back.

| File | Exact request URL | HTTP | Content-Type | Bytes |
|---|---|---|---|---|
| `simbrief.userid.json` | `https://www.simbrief.com/api/xml.fetcher.php?userid=1099607&json=1` | 200 | `application/json` | 333773 |
| `simbrief.error.baduserid.txt` | `https://www.simbrief.com/api/xml.fetcher.php?userid=999999999&json=1` | **400** | `application/json` | 96 |

The operator supplied their own pilot ID (`1099607`) for the success capture.
The endpoint takes no credential of any kind — no key, no token, no cookie —
so both requests are reproducible by anyone:

    curl -sS 'https://www.simbrief.com/api/xml.fetcher.php?userid=1099607&json=1'

`simbrief.userid.json` is a snapshot of *the most recent OFP at capture time*:
UHPP → UHSS, flight SHG037, King Air 200, generated `1789306516`
(2026-09-13T13:35:16Z), 17 navlog fixes, no alternate. Generating a new OFP on
simbrief.com changes what that URL returns; it does not change the field paths,
which are structural.

### What only the raw captures prove

1. **Every scalar is a string.** `"elevation":"128"`, `"altitude_feet":"7400"`,
   `"pos_lat":"53.169444"`. There is not one JSON number in the 333 KB
   document, so every numeric field is coerced explicitly.
2. **An empty element is `{}`** — not `""`, not `null`. 164 of them in the
   success capture (`general.icao_airline`, `origin.faa_code`,
   `general.sid_trans`). In the *error* bodies the same `static_id` field is
   `""` instead; the two shapes disagree with each other.
3. **A repeated element that appears once collapses to a bare object**, not a
   one-element array. This capture was filed `altn=NONE` so `alternate` is `{}`;
   two unrelated pilot IDs whose latest plan carries one alternate were probed
   for *shape only* (their bodies are deliberately not saved here — they are
   other people's flight plans) and both returned `alternate` as a 38-key
   object. Reading `alternate` or `navlog.fix` without the array normaliser
   works on this fixture and silently drops the only alternate on a real plan
   that has one.
4. **The origin airport is not in the navlog; the destination is.** The first
   fix is `PP003`, a SID waypoint. The last is `UHSS` as `{"type":"apt"}`. The
   parser prepends the origin and appends the destination only when missing —
   this fixture is what proves both halves are needed.
5. **Failure is HTTP 400 with a body carrying only `fetch`.** No `params`, no
   `general`, no `navlog`. A non-numeric or unknown ID is
   `"Error: Unknown UserID"`, which is also what an unknown *username* returns,
   so the two cannot be told apart.

## The synthesized fixtures (`synthetic/`)

One per rejection the parser can produce. Each exists to make a rule
falsifiable, so **do not "tidy" one into looking like a normal response** — the
deviation is the point.

| File | Code | What it proves |
|---|---|---|
| `bad-not-json.txt` | `NOT_JSON` | An HTML error page where JSON was expected — a proxy or an outage page. One line, no `SyntaxError` stack |
| `bad-no-route.json` | `NO_ROUTE` | A well-formed OFP with `navlog.fix` as `{}`: origin and destination are fine, there is simply no route to store |
| `bad-no-plan.json` | `NOT_AN_OFP` | The "no recent plan" signal. **This one is a real capture, not hand-built**: it is byte-for-byte the 400 body from `…?userid=2&json=1`, an ID that has never filed a plan (`{"fetch":{…,"status":"Error: No flight plan on file for the specified user",…}}`). It lives here because what it exercises is a rejection, and the import route also refuses it earlier, at the network client, where it becomes the `NO_PLAN` message |
| `bad-lat-91.json` | `BAD_POSITION` | A route whose second fix has `pos_lat` 91.5. Out of range is a *wrong* payload, not an incomplete one, so the whole plan is refused rather than the fix dropped |

A fix that is merely *missing* a position, or an ident, is a different case: it
is dropped with a `FIX_MISSING_POSITION` warning and the rest of the plan
imports, because `planned_waypoints` cannot store a positionless row but losing
one waypoint beats losing the flight plan.

## Running them

    npx ts-node src/inspect-simbrief.ts samples/simbrief/simbrief.userid.json
    npx ts-node src/inspect-simbrief.ts 'samples/simbrief/synthetic/bad-*'

The first exits 0 and prints UHPP → UHSS, 18 waypoints, 28000 ft, approx.
755.3 nm — against SimBrief's own `route_distance` of 754, which is the check
that the chain really was assembled in route order. The second exits 1 and
prints one line per file, naming the code and the offending field.

The unit tests (`tests/simbrief.test.ts`, `tests/simbriefClient.test.ts`) read
these files read-only and name every one of them explicitly. **No test globs
this directory for its inputs** — a glob would keep passing while quietly
asserting something else every time a file is added here.
