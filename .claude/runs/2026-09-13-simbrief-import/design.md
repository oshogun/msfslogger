# Design freeze — SimBrief flight plan import

Run: `2026-09-13-simbrief-import` · Task: T-001 · Frozen 2026-09-13

Read one section at a time: `.claude/tools/ctx.sh design 2026-09-13-simbrief-import 4`.
Sections are self-contained and cross-reference by number. Section numbers are
stable; an amendment edits in place and keeps its number.

| Section | What it freezes |
|---|---|
| 1 | SimBrief's real API, verified against captured responses |
| 2 | The `app_setting` table |
| 3 | The settings endpoints |
| 4 | `ParsedSimbriefPlan` and its mapping onto `CreatePlannedLegPlan` |
| 5 | The fetch client and the error taxonomy |
| 6 | The import endpoint |
| 7 | The client contract and the end-to-end verification recipe |
| 8 | The `.lnmpln` surfaces that must not change |
| 9 | Alternatives considered |
| 10 | Risks |

## Amendments

None yet. When reality contradicts a frozen section, edit that section in
place, keep its number, and add a row here: date, section, what changed, and
the command or capture that forced it.

---

## 1. The SimBrief API, as actually observed

Everything in this section was captured on **2026-09-13** with `curl` and is
saved raw under `.claude/runs/2026-09-13-simbrief-import/contracts/`. Provenance
table (URL, HTTP status, byte count per file) is in `contracts/README.md`.
Nothing here is quoted from documentation except where § 1.6 says so.

### 1.1 Endpoint, parameters, auth

    https://www.simbrief.com/api/xml.fetcher.php?userid=<pilot-id>&json=1

| Parameter | Value | Verified by |
|---|---|---|
| `userid` | SimBrief numeric pilot ID | `contracts/simbrief.userid.json`, HTTP 200, 333773 bytes |
| `username` | SimBrief username, alternative to `userid` | `contracts/simbrief.username.json`, HTTP 200, 333773 bytes |
| `json` | `1` for JSON. Omitted ⇒ XML | `contracts/simbrief.userid.xml`, `Content-Type: text/xml;charset=UTF-8` |

- **Response is JSON** when `json=1`: `Content-Type: application/json`.
  Confirmed on the wire, not assumed.
- **No authentication of any kind.** No key, token, cookie or `Authorization`
  header was sent on any of the seven captured requests and all seven were
  answered. The success response carried `access-control-allow-origin: *`.
  This app sends no credential to SimBrief and needs none. See § 10 for the
  consequence.
- **We use `userid`, not `username`** — see § 3.3 for why the setting is
  validated as a numeric ID.

`userid` and `username` address the same record. A structural diff of the two
success captures reports **exactly one** differing path — `$.fetch.time`
(`"0.0023"` vs `"0.0022"`), SimBrief's own server-timing figure. Everything
else is byte-identical. This single fact drives § 4.6.

### 1.2 The envelope, and the only reliable verdict

Both success and failure bodies carry a `fetch` object:

    "fetch":{"userid":"1099607","static_id":{},"status":"Success","time":"0.0023"}

`$.fetch.status` is the verdict. It is `"Success"` on success and a string
beginning `"Error: "` on failure. **Branch on `$.fetch.status`, not on the HTTP
status alone** — see § 5.3.

### 1.3 Literal field paths

Every path below is from `contracts/simbrief.userid.json` (route UHPP→UHSS,
OFP generated 2026-09-13T13:35:16Z), with its literal captured value.

| Datum | JSON path | Captured value |
|---|---|---|
| Departure ICAO | `$.origin.icao_code` | `"UHPP"` |
| Departure name | `$.origin.name` | `"YELIZOVO"` |
| Departure lat / lon | `$.origin.pos_lat` / `$.origin.pos_long` | `"53.169444"` / `"158.450556"` |
| Departure elevation ft | `$.origin.elevation` | `"128"` |
| Destination ICAO | `$.destination.icao_code` | `"UHSS"` |
| Destination name | `$.destination.name` | `"KHOMUTOVO"` |
| Destination lat / lon | `$.destination.pos_lat` / `$.destination.pos_long` | `"46.888611"` / `"142.717500"` |
| En-route waypoint list | `$.navlog.fix` | array of 17 (§ 1.4) |
| — ident | `$.navlog.fix[i].ident` | `"SAMIK"` |
| — name | `$.navlog.fix[i].name` | `"SAMIK"` |
| — lat / lon | `$.navlog.fix[i].pos_lat` / `.pos_long` | `"53.038889"` / `"157.607778"` |
| — altitude ft | `$.navlog.fix[i].altitude_feet` | `"25200"` |
| — airway | `$.navlog.fix[i].via_airway` | `"T577"`, or `"DCT"`, or a SID/STAR name |
| — type | `$.navlog.fix[i].type` | `"wpt"` \| `"apt"` \| `"ndb"` \| `"vor"` \| `"ltlg"` |
| — region | `$.navlog.fix[i].icao_region` | `"UH"` |
| Alternates | `$.alternate` | `{}` here — none filed (§ 1.5, § 4.3) |
| — alternate ICAO | `$.alternate.icao_code` | absent here; `"KSMF"` in the shape probe |
| — alternate cruise alt | `$.alternate.cruise_altitude` | `"13000"` in the shape probe |
| Cruise altitude | `$.general.initial_altitude` | `"28000"` |
| Aircraft type (ICAO) | `$.aircraft.icao_code` | `"BE20"` |
| Aircraft name | `$.aircraft.name` | `"KING AIR 200"` |
| Flight rules | `$.atc.flight_rules` | `"I"` (⇒ IFR) |
| OFP id | `$.params.request_id` | `"186182026"` |
| OFP sequence id | `$.params.sequence_id` | `"60bafd06304e"` |
| OFP generation time | `$.params.time_generated` | `"1789306516"` (epoch s ⇒ 2026-09-13T13:35:16Z) |
| Flight number | `$.general.flight_number` | `"SHG037"` |
| Filed route string | `$.general.route` | `"SAMI4L SAMIK T577 UB P176 NAMUL P175 ROMUK R810 BELNA DCT LEKPA LEKP4V"` |
| SID / STAR ident | `$.general.sid_ident` / `$.general.star_ident` | `"SAMI4L"` / `"LEKP4V"` |
| SID / STAR transition | `$.general.sid_trans` / `$.general.star_trans` | `{}` / `{}` (none) |
| Departure / arrival runway | `$.origin.plan_rwy` / `$.destination.plan_rwy` | `"34L"` / `"19"` |

**Every scalar is a string.** There is not a single JSON number in the
333 KB document. `"elevation":"128"`, `"altitude_feet":"7400"`,
`"pos_lat":"53.169444"`. Coerce explicitly; never trust `typeof x === 'number'`.

### 1.4 The navlog chain — and the origin asymmetry

`$.navlog.fix` is the route, ordered departure→destination. Its 17 entries in
the captured sample, verified by
`prototypes/map-navlog.js`:

    PP003 SAMIK TOC UB LEDRU NAMUL ROMUK NATUN RUDOS TOD AGITA BELNA LEKPA BAPMA FARAT CF19 UHSS

Three things this proves, none of which is guessable:

1. **The origin airport is NOT the first fix.** The first fix is `PP003`, a SID
   waypoint. The origin must be synthesized from `$.origin` (§ 4.2).
2. **The destination airport IS the last fix**, as `{"ident":"UHSS","type":"apt"}`.
   Appending `$.destination` unconditionally would duplicate it. § 4.2 dedupes.
3. **SID and STAR waypoints are present**, unlike `.lnmpln`. `PP003`/`SAMIK`
   carry `"via_airway":"SAMI4L"` and `"is_sid_star":"1"`; `BAPMA`/`FARAT`/`CF19`
   carry `"via_airway":"LEKP4V"`. This is why the SimBrief distance is
   accurate and the `.lnmpln` one is not — see § 4.5.

`TOC` and `TOD` are pseudo-waypoints of `"type":"ltlg"` (top of climb / top of
descent): computed lat-longs, not navaids. They are kept — see § 9.3.

### 1.5 Alternates: the single-element collapse

The operator's captured plan was filed `altn=NONE`, so `$.alternate` is the
empty object `{}`. To settle the shape when alternates *do* exist, two
unrelated pilot IDs whose latest OFP carries one alternate were probed **for
structure only** — their bodies are deliberately not saved, being other
people's flight plans. Both returned:

    $.alternate  ->  a 38-key OBJECT  (icao_code, name, pos_lat, pos_long, cruise_altitude, …)

**not** a one-element array. This is PHP's XML→JSON single-element collapse and
it is the single most likely thing to break this feature in the field. § 4.3
freezes the normalizer. The same hazard applies to `$.navlog.fix` (a
hypothetical one-fix plan) and to `$.alternate_navlog.fix`.

Related: **empty XML elements become `{}`**, not `""` and not `null` — 164 such
leaves in the success sample (`$.general.icao_airline`, `$.origin.faa_code`,
`$.general.sid_trans`, …). Inconsistently, in the *error* bodies the same
`static_id` field is `""`. § 4.1 freezes the coercion helpers that absorb both.

### 1.6 Failure signalling — quoted from real failing requests

All four bodies below are the complete, unedited response, captured 2026-09-13.

**Unknown / malformed user id** — `?userid=999999999&json=1`, **HTTP 400**
(`contracts/simbrief.error.baduserid.txt`):

    {"fetch":{"userid":"999999999","static_id":"","status":"Error: Unknown UserID","time":"0.0002"}}

**Valid-looking id that has never filed a plan** — `?userid=2&json=1`,
**HTTP 400** (`contracts/simbrief.error.noplan.txt`):

    {"fetch":{"userid":"2","static_id":"","status":"Error: No flight plan on file for the specified user","time":"0.0001"}}

**Unknown username** — `?username=zzznosuchpilotzzz&json=1`, **HTTP 400**
(`contracts/simbrief.error.badusername.txt`). Note `userid` comes back *empty*,
and the message is the *UserID* one — a bad username is indistinguishable from
a bad user id:

    {"fetch":{"userid":"","static_id":"","status":"Error: Unknown UserID","time":"0.0004"}}

**No identifier at all** — `?json=1`, **HTTP 400**
(`contracts/simbrief.error.noparams.txt`):

    {"fetch":{"userid":"","static_id":"","status":"Error: Unknown UserID","time":"0.0001"}}

Observed rules, frozen:

- A failure is **HTTP 400** with a JSON body containing **only** `fetch`. No
  `params`, no `general`, no `navlog`.
- Non-numeric input (`?userid=abc`, `?userid=1099607x`) is **`Error: Unknown
  UserID`**, not a distinct validation error.
- `"Error: Unknown UserID"` and `"Error: No flight plan on file for the
  specified user"` are the two literal strings observed. Match them by
  **substring, case-insensitively** (`unknown userid`, `no flight plan`) rather
  than by equality — see § 5.3 — and fall back to `BAD_STATUS` for any other
  `"Error: …"`.

Navigraph's own developer documentation
(`https://developers.navigraph.com/docs/simbrief/fetching-ofp-data`, read
2026-09-13) agrees on the shape at the level it addresses — 200 + XML/JSON on
success, 400 on error — and says nothing about the array-collapse or the
literal error strings. Those come from the captures above only.

---

## 2. The `app_setting` table

### 2.1 DDL

Goes inside the existing single `db.exec(\`…\`)` block of `CREATE TABLE IF NOT
EXISTS` statements in `src/db.ts`, **immediately after the `app_secret` table**
(currently ending at `src/db.ts:262`) and before the block's closing backtick.
It has no foreign keys and nothing references it, so its position within the
block is otherwise unconstrained.

```sql
-- Operator-editable settings, entered through the UI and read by the server.
-- Deliberately separate from app_secret, which is scoped by its own comment to
-- values the server generates and the operator never sees. Nothing here is a
-- credential: the only row today is the SimBrief pilot ID, a public identifier
-- that SimBrief's API accepts unauthenticated.
CREATE TABLE IF NOT EXISTS app_setting (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 2.2 Migration safety

- `CREATE TABLE IF NOT EXISTS` inside the existing boot block. It is **additive
  and idempotent**: re-running it on the operator's live database is a no-op.
- **No `ALTER TABLE`, no column drop, no column repurpose, nothing touching an
  existing table.** A database that predates this run gains one empty table and
  is otherwise bit-identical in behaviour.
- Rolling back is deleting the code; the orphan empty table harms nothing.
- Not in scope and not permitted: any change to `app_secret`.

### 2.3 Row contract

| `name` | `value` | Written by |
|---|---|---|
| `simbrief_user_id` | The digits of the pilot ID, e.g. `1099607`. Never empty — clearing deletes the row. | § 3 |

`value` is `NOT NULL`. "Unset" is the **absence of the row**, never an empty
string; this keeps `getSetting` total and single-valued.

### 2.4 Accessors

In `src/db.ts`, beside `getAppSecret` (currently `src/db.ts:1457`). `src/db.ts`
owns both signatures.

```ts
/** Returns null when the setting has never been set, or was cleared. */
export function getSetting(name: string): string | null;

/**
 * Upserts a setting. A null or empty value deletes the row, so "unset" has
 * exactly one representation (see § 2.3). updated_at is an ISO instant.
 */
export function setSetting(name: string, value: string | null): void;
```

Generic on `name` rather than `getSimbriefUserId()`, so the second setting this
app ever needs adds a row and not a pair of functions. The `simbrief_user_id`
key name is a string constant owned by `src/simbrief.ts` (§ 5.1).

### 2.5 Why not reuse `app_secret`

`app_secret`'s own doc comment (`src/db.ts:257-258`) scopes it to "server-side
secrets that the operator does not have to manage", holding base64 random
bytes. The SimBrief pilot ID is the opposite on both counts: the operator types
it in, and it is not a secret — § 1.1 establishes SimBrief serves it to anyone
unauthenticated. Putting operator input into the table the session secret lives
in would mean one `DELETE`-by-name bug away from logging every user out, and
would make any future "show me the settings" endpoint one `SELECT *` away from
leaking the session secret.

---

## 3. The settings endpoints

Both sit in `src/server.ts` under a new `// ── Settings ──` banner placed
**immediately before** the `// ── Planned legs ──` banner at `src/server.ts:519`,
so every literal route stays ahead of `app.get('*')`. Both are under `/api`, so
`requireAuth` and `requireSameOrigin` (`src/auth/middleware.ts`) already gate
them — no new auth wiring, and the write is already CSRF-defended.

### 3.1 Read

    GET /api/settings/simbrief

**200** always, when authenticated:

```json
{ "simbrief_user_id": "1099607" }
```

`"simbrief_user_id": null` when unset. There is no 404 for an unset
setting — absence is a value here, and a 404 would make the client branch on a
status to render an empty text box.

### 3.2 Write

    PUT /api/settings/simbrief
    Content-Type: application/json

Request:

```json
{ "simbrief_user_id": "1099607" }
```

`null` or `""` clears the setting (deletes the row, § 2.3). `PUT` and not
`POST`: the setting is a single named resource and writing it twice is
idempotent.

**200** — the stored value, post-trim, so the client renders what was actually
saved rather than what it typed:

```json
{ "simbrief_user_id": "1099607" }
```

### 3.3 Validation rule for a SimBrief pilot ID

Applied to `PUT` only. Frozen, in this order:

1. Reject with `400 INVALID_ID` if the field is present and is neither a string
   nor `null`.
2. **Trim** leading and trailing whitespace (`String.prototype.trim()`). Users
   paste from SimBrief's account page and bring a space with them.
3. If the result is the empty string, treat as a **clear**: delete the row,
   return `{"simbrief_user_id": null}` with **200**.
4. **Character set: ASCII digits only**, `/^[0-9]+$/`. § 1.6 proves SimBrief
   answers anything non-numeric with `Error: Unknown UserID`, so rejecting
   locally turns a confusing round-trip into an immediate, specific message.
5. **Length: 1 to 20 digits inclusive.** The operator's real ID is 7 digits
   (`1099607`); 20 is a generous ceiling that still bounds the column.
6. **Case: not applicable** — the value is digits. No case folding is
   performed, and none must be added, because trimming and case-folding a field
   that will later hold a username (§ 9.1) would be a silent behaviour change.

Leading zeros are **preserved**, never normalized away: the value is an opaque
identifier that happens to be spelled in digits, and it is sent to SimBrief as
a string. Do not parse it to a number at any point.

### 3.4 Rejections

| Condition | Status | Body |
|---|---|---|
| Not authenticated | 401 | existing `requireAuth` body — unchanged |
| Cross-origin write | 403 | `{"error":"Cross-origin request rejected"}` — existing `requireSameOrigin` body, unchanged |
| Body is not an object / unparseable JSON | 400 | `{"error":"Invalid request body","code":"INVALID_BODY"}` |
| `simbrief_user_id` present but not a string or null | 400 | `{"error":"SimBrief User ID must be text","code":"INVALID_ID"}` |
| Contains a non-digit after trimming | 400 | `{"error":"SimBrief User ID must be digits only — it is the numeric Pilot ID from your SimBrief account page, not your username","code":"INVALID_ID"}` |
| Longer than 20 digits | 400 | `{"error":"SimBrief User ID is too long","code":"INVALID_ID"}` |
| Database write fails | 500 | `{"error":"<String(err)>"}` — matches every other handler in `src/server.ts` |

The `code` field is additive: `.lnmpln`'s handlers return a bare `{ error }` and
keep doing so (§ 8). Nothing may make `code` required on an existing response.

---

## 4. `ParsedSimbriefPlan` and its mapping onto `CreatePlannedLegPlan`

The full interface is in `contracts/simbrief-plan.d.ts` as a reference artifact.
The shipped declaration lives in **`src/simbrief.ts`**, which owns
`ParsedSimbriefPlan`, `SimbriefWarning`, `SimbriefWaypoint`,
`SimbriefAlternate`, `SimbriefEndpoint` and `SimbriefParseError`. `src/db.ts`
must **not** import any of them — it keeps its own structurally-compatible
`CreatePlannedLegPlan` (`src/db.ts:824-851`), exactly as it does for
`src/lnmpln.ts`. `src/server.ts` is the only module that sees both types.

`parseSimbriefPlan(body: unknown): ParsedSimbriefPlan` is **pure**: no network,
no clock beyond what is in the payload, no database. It throws
`SimbriefParseError` for a body that cannot become a plan, and collects
everything it tolerated in `warnings[]` — the same contract `parseLnmpln` has.

### 4.1 Coercion helpers (frozen, and mandatory)

§ 1.3 and § 1.5 make these load-bearing, not stylistic. They are private to
`src/simbrief.ts`.

```ts
/** "" and {} and undefined all mean absent. Trims. Never returns "". */
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/** Every SimBrief scalar is a string (§ 1.3). Non-finite => null. */
const num = (v: unknown): number | null => {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Absorbs PHP's XML->JSON single-element collapse (§ 1.5). */
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v
  : v && typeof v === 'object' && Object.keys(v).length > 0 ? [v as Record<string, unknown>]
  : [];
```

Reading `$.navlog.fix` or `$.alternate` without `arr()` is a defect, not a
style question: it works on the operator's current plan and silently drops
every alternate the day they file one.

### 4.2 The waypoint chain

Built in exactly these steps. Implemented twice from this text, they produce
the same rows.

1. Start with the origin airport, synthesized from `$.origin` because § 1.4
   proves it is not in the navlog:
   `{ ident: origin.icao_code, name: origin.name, type: 'AIRPORT',
   airway: null, lat: origin.pos_lat, lon: origin.pos_long,
   altFt: origin.elevation }`.
   If the first navlog fix's ident already equals `$.origin.icao_code`, **do
   not** prepend; emit warning `ORIGIN_IN_NAVLOG` instead and use the navlog
   entry. (Not observed, but the destination behaves this way, so the origin
   plausibly can.)
2. Append every `arr($.navlog.fix)` entry, in document order, unchanged.
3. If the last entry's ident is not `$.destination.icao_code`, append the
   destination synthesized from `$.destination` the same way as step 1. In the
   captured sample this step **does nothing**, because the last fix is already
   `UHSS`.
4. Number `seq` 1-based over the final list.
5. Drop any fix whose `pos_lat` or `pos_long` coerces to `null`, and emit
   `FIX_MISSING_POSITION` naming its ident. `planned_waypoints.lat/lon` are
   `NOT NULL` (`src/db.ts:213-214`), so a positionless fix cannot be stored;
   dropping one waypoint is better than failing the whole import.

Per-waypoint field mapping:

| `CreatePlannedLegWaypoint` | Source | Notes |
|---|---|---|
| `ident` | `str(fix.ident)` | Required. A fix with no ident is dropped with `FIX_MISSING_POSITION`. |
| `name` | `str(fix.name)` | Often equals `ident`; stored as-is. |
| `region` | `str(fix.icao_region)` | e.g. `"UH"`. |
| `airway` | `str(fix.via_airway)` | `"DCT"` is passed through verbatim, not nulled — it is what SimBrief filed. |
| `track` | `null` | SimBrief has `track_true`/`track_mag`, but `planned_waypoints.track` is the `.lnmpln` NAT-track column, a different concept. Do not conflate them. |
| `type` | mapped, § 4.4 | |
| `comment` | `str(fix.stage)` | `"CLB"`/`"CRZ"`/`"DSC"` — the only per-fix free text worth keeping. |
| `lat` / `lon` | `num(fix.pos_lat)` / `num(fix.pos_long)` | |
| `altFt` | `num(fix.altitude_feet)` | SimBrief's **computed profile** altitude, exactly like `.lnmpln`'s `Pos/@Alt`. Never present it as a planned constraint. |

### 4.3 Alternates

`arr($.alternate)` — § 1.5. Empty in the captured sample, which emits warning
`NO_ALTERNATES`.

| `CreatePlannedLegAlternate` | Source |
|---|---|
| `seq` | 1-based over `arr($.alternate)` |
| `ident` | `str(a.icao_code)`; an entry without one is skipped |
| `name` | `str(a.name)` |
| `type` | `'AIRPORT'` — every SimBrief alternate is an airport |
| `lat` / `lon` | `num(a.pos_lat)` / `num(a.pos_long)`; nullable, matching the column |
| `altFt` | `num(a.cruise_altitude)` |

### 4.4 Fix-type mapping

`planned_waypoints.type` is `NOT NULL` and only `AIRPORT` is behaviourally
significant (`src/db.ts:206-207`). SimBrief's `$.navlog.fix[i].type`:

| SimBrief | Stored | Seen in sample |
|---|---|---|
| `apt` | `AIRPORT` | yes (`UHSS`) |
| `wpt` | `WAYPOINT` | yes |
| `vor` | `VOR` | — |
| `ndb` | `NDB` | yes (`UB`) |
| `ltlg` | `USER` | yes (`TOC`, `TOD`) |
| anything else | the raw value **uppercased**, plus a `UNKNOWN_FIX_TYPE` warning naming the ident and the raw type | — |

`ltlg`→`USER` because a top-of-climb point is a computed lat-long, which is
precisely what `.lnmpln` calls a `USER` waypoint. Never map it to `WAYPOINT`:
that would claim a navaid exists there.

### 4.5 Plan-level mapping onto `CreatePlannedLegPlan`

| `CreatePlannedLegPlan` field | SimBrief source | Value in the captured sample |
|---|---|---|
| `departure.ident` | `$.origin.icao_code` | `"UHPP"` |
| `departure.name` | `$.origin.name` | `"YELIZOVO"` |
| `departure.lat` / `.lon` | `$.origin.pos_lat` / `.pos_long` | `53.169444` / `158.450556` |
| `departure.isAirport` | **`true`**, always | `true` |
| `destination.*` | `$.destination.*`, same rules | `"UHSS"`, `46.888611` / `142.7175`, `true` |
| `isSnippet` | **`false`**, always | `false` |
| `cruiseAltFt` | `num($.general.initial_altitude)`; `null` ⇒ warning `NO_CRUISE_ALTITUDE` | `28000` |
| `flightplanType` | `$.atc.flight_rules`: `"I"`→`"IFR"`, `"V"`→`"VFR"`, anything else → the raw value uppercased | `"IFR"` |
| `aircraftType` | `str($.aircraft.icao_code)` | `"BE20"` |
| `remarks` | `"SimBrief OFP <flight_number> · <general.route>"`, omitting either part when absent; `null` if both absent | `"SimBrief OFP SHG037 · SAMI4L SAMIK T577 …"` |
| `createdAt` | `new Date(Number($.params.time_generated) * 1000).toISOString()` | `"2026-09-13T13:35:16.000Z"` |
| `sourceProgram` | **`"SimBrief"`**, literal | `"SimBrief"` |
| `departureStart.pos` | **`null`** — SimBrief has no gate/parking concept | `null` |
| `departureStart.start` / `.startType` | **`null`** | `null` |
| `procedures.sidName` | `str($.general.sid_ident)` | `"SAMI4L"` |
| `procedures.sidRunway` | `str($.origin.plan_rwy)` | `"34L"` |
| `procedures.sidTransition` | `str($.general.sid_trans)` (`{}`⇒null) | `null` |
| `procedures.starName` | `str($.general.star_ident)` | `"LEKP4V"` |
| `procedures.starRunway` | `str($.destination.plan_rwy)` | `"19"` |
| `procedures.starTransition` | `str($.general.star_trans)` | `null` |
| `procedures.sidType`, `sidCustomDistanceNm`, and **all nine `approach*` fields** | **`null`** — SimBrief's OFP carries no approach procedure; `plan_rwy` is already spent on `starRunway` | `null` |
| `waypoints` | § 4.2 | 18 entries |
| `alternates` | § 4.3 | `[]` |
| `approxDistanceNm` | haversine sum over the § 4.2 chain, using `haversineNm` from **`src/geo.ts`** | `755.3` |

**On `approxDistanceNm`:** the prototype's haversine sum over the § 4.2 chain is
**755.3 nm** against SimBrief's own `$.general.route_distance` of **754** — 0.2%
apart. Unlike `.lnmpln`, this is *not* an underestimate, because § 1.4 proves
SID and STAR waypoints are in the navlog. **Compute it ourselves anyway, with
`haversineNm`, and do not substitute `route_distance`**: the column's meaning is
"great-circle sum over the stored waypoint chain", and every existing reader —
the map, the journey view, `arrival_deviation_nm` — assumes the number and the
stored rows agree. Substituting SimBrief's figure would make a leg whose
distance does not match its own waypoints.

The column is still named `approx_distance_nm` and the UI still says "approx.".
**Neither is changed by this run** (§ 8). The label being conservative for a
SimBrief leg is correct behaviour, not a bug to fix here.

### 4.6 `source_filename`, `source_sha256`, and duplicate detection

`planned_legs.source_filename` and `source_sha256` are both `NOT NULL`
(`src/db.ts:187-188`). A SimBrief import has no file, so both are synthesized.

**`source_filename`** — a human-readable pseudo-filename, so the existing UI,
which renders this string in import results and leg provenance, shows something
meaningful without a code change:

    simbrief-<request_id>.json          e.g. "simbrief-186182026.json"

and `simbrief-unknown.json` when `$.params.request_id` is absent.

**`source_sha256`** — **not** a hash of the response body. § 1.1 proves two
fetches of the same OFP differ in `$.fetch.time`, so the raw body's hash is
unstable and `findPlannedLegBySource` would never match. Instead, hash a
canonical identity string built only from fields that identify the OFP itself:

    sha256("simbrief\n" + requestId + "\n" + sequenceId + "\n" + timeGenerated)

with each component the `str()` of `$.params.request_id`,
`$.params.sequence_id`, `$.params.time_generated`, and the literal `""` where
absent. For the captured sample this is
`sha256("simbrief\n186182026\n60bafd06304e\n1789306516")`.

**Is re-importing the same OFP detectable?** *Yes*, and this is the point of the
canonical hash. `findPlannedLegBySource(tripId, sha256)` (`src/db.ts:970-975`)
keys on `(trip_id, source_sha256)`, and the canonical string is stable across
fetches — verified: the only field that differed between two independent fetches
was `$.fetch.time`, which is excluded. So:

- Fetching the same OFP twice into the same trip ⇒ **detected as a duplicate**,
  even though the two response bodies were not byte-identical.
- The operator generating a *new* OFP in SimBrief ⇒ new `request_id` and new
  `time_generated` ⇒ a different hash ⇒ imports as a new leg. Correct: it is a
  different plan, even for the same city pair.
- The same OFP into a *different* trip ⇒ imports, because the key is
  `(trip_id, …)`. Unchanged from `.lnmpln` behaviour.

This is a **different hash input** from the `.lnmpln` path, which hashes file
bytes (`src/server.ts:578`). The two never collide in practice and, more
importantly, nothing compares a hash across the two sources — the column is only
ever looked up with a hash computed the same way it was written.

---

## 5. The fetch client and the error taxonomy

Lives in **`src/simbrief.ts`**, alongside the parser (§ 4). It performs no
database access and imports nothing from `src/db.ts`.

### 5.1 Exported signature

```ts
/** The app_setting key (§ 2.3). Owned here so the string exists once. */
export const SIMBRIEF_USER_ID_SETTING = 'simbrief_user_id';

export interface FetchLatestOfpOptions {
  /** Injected in tests. Defaults to globalThis.fetch — Node 20 built-in. */
  fetchImpl?: typeof fetch;
  /** Defaults to SIMBRIEF_TIMEOUT_MS. */
  timeoutMs?: number;
}

/**
 * Fetches the pilot's most recent OFP. Resolves with the parsed JSON body
 * (an `unknown` for parseSimbriefPlan to validate), or rejects with a
 * SimbriefFetchError. Never throws anything else.
 */
export async function fetchLatestOfp(
  userId: string,
  opts: FetchLatestOfpOptions = {},
): Promise<unknown>;
```

`fetchImpl` is the seam the intake called for: nothing in this repo mocks
`fetch` today, and the route logic must be testable without a network call. It
is a parameter with a default, **not** a module-level mutable global — two
tests running concurrently must not be able to see each other's stub.

### 5.2 Base URL, timeout, request

```ts
const SIMBRIEF_DEFAULT_BASE_URL = 'https://www.simbrief.com/api/xml.fetcher.php';
const SIMBRIEF_TIMEOUT_MS = 20_000;

/**
 * Overridable so a scratch server can point at a local stub instead of the
 * real SimBrief. Read here rather than in src/config.ts: ENV_VARS is scoped by
 * its own comment to security-relevant configuration, and this is a test seam.
 * Follows the EXPORT_BASE_URL precedent in src/pdfExport.ts.
 */
function baseUrl(): string {
  return process.env.SIMBRIEF_API_BASE_URL ?? SIMBRIEF_DEFAULT_BASE_URL;
}
```

- Read `process.env` **inside the function, per call** — not captured at module
  load — so § 7.5's recipe works without reordering imports.
- **`SIMBRIEF_API_BASE_URL` must not be added to `src/config.ts`'s `ENV_VARS`**
  (`src/config.ts:50`), whose own comment scopes it to configuration this app's
  security depends on. This keeps DevOps out of this run.
- The URL is built with `new URL()` and `searchParams.set('userid', userId)` /
  `set('json', '1')` — never string concatenation, so a hostile setting value
  cannot inject a parameter.
- Timeout is **20 000 ms**, enforced with `AbortSignal.timeout(timeoutMs)`
  passed as `signal`. Generous: SimBrief regenerates wind data on some fetches.
- Request headers: `Accept: application/json` only. **No credential is sent**
  (§ 1.1) and none may be added.
- Redirects: default (`follow`). No cookie jar exists, so this is inert.
- The response body is read with `res.text()` then `JSON.parse`, not
  `res.json()`, so an unparseable body yields `BAD_BODY` with the first 200
  characters of what actually arrived instead of a bare `SyntaxError`.

### 5.3 Verdict order

Applied in exactly this order. The upstream `fetch.status` is checked **before**
the HTTP status, because § 1.6 shows both failure modes share HTTP 400 and only
the body distinguishes them.

1. `fetchImpl` rejects with an `AbortError` / the signal is aborted ⇒ `TIMEOUT`.
2. `fetchImpl` rejects for any other reason (DNS, TLS, connection refused) ⇒
   `NETWORK`.
3. The body is not parseable JSON, or is not an object ⇒ `BAD_BODY`.
4. `$.fetch.status` is a string starting `Error:` (case-insensitive):
   - contains `unknown userid` ⇒ `UNKNOWN_USER`
   - contains `no flight plan` ⇒ `NO_PLAN`
   - otherwise ⇒ `BAD_STATUS`, carrying the upstream string verbatim.
5. HTTP status is not 200 and rule 4 did not fire ⇒ `BAD_STATUS`.
6. `$.fetch.status` is absent, or is not `"Success"` ⇒ `BAD_BODY`.
7. Otherwise resolve with the parsed body.

### 5.4 Error taxonomy

`SimbriefFetchError extends Error`, carrying `code`, `userMessage`,
`upstreamStatus?`, `httpStatus?`. `message` is for the log; `userMessage` is the
sentence the user sees, and **never contains a URL, a stack, or the pilot ID**.

| `code` | Trigger (§ 5.3) | Log line | `userMessage` |
|---|---|---|---|
| `UNKNOWN_USER` | rule 4, `unknown userid` | `[SIMBRIEF] import failed: UNKNOWN_USER (http 400, upstream "Error: Unknown UserID")` | `SimBrief does not recognise that Pilot ID. Check the SimBrief User ID in the field above — it is the numeric Pilot ID from your SimBrief account page.` |
| `NO_PLAN` | rule 4, `no flight plan` | `[SIMBRIEF] import failed: NO_PLAN (http 400, upstream "Error: No flight plan on file for the specified user")` | `That SimBrief account has no flight plan on file. Generate a flight plan on simbrief.com first, then import it here.` |
| `NETWORK` | rule 2 | `[SIMBRIEF] import failed: NETWORK (<err.message>)` | `Could not reach SimBrief. Check your internet connection and try again.` |
| `TIMEOUT` | rule 1 | `[SIMBRIEF] import failed: TIMEOUT (20000ms)` | `SimBrief did not respond within 20 seconds. Try again in a moment.` |
| `BAD_STATUS` | rules 4-other, 5 | `[SIMBRIEF] import failed: BAD_STATUS (http <n>, upstream "<status>")` | `SimBrief returned an error: <upstream status, or "HTTP <n>">. Try again in a moment.` |
| `BAD_BODY` | rules 3, 6 | `[SIMBRIEF] import failed: BAD_BODY (http <n>, first 200 chars: <…>)` | `SimBrief returned a response this app could not read. This usually means SimBrief is having trouble — try again in a moment.` |

`SimbriefParseError` (§ 4) is separate: the fetch succeeded and SimBrief said
`Success`, but the payload had no usable route. The route maps it to code
`BAD_BODY` with `userMessage`: `SimBrief returned a plan with no usable route.`

Every outcome, success included, is logged — the user story asks for it:

    [SIMBRIEF] import ok: trip <id> leg <legId> UHPP->UHSS 18 wpts 755.3nm ofp 186182026

Log lines use the `[SIMBRIEF]` prefix, matching `[LNMPLN]`
(`src/server.ts:601`) and `[PDF]`.

> **Amendment (post-T-005, approved at the phase-2 gate, T-008):** this
> section's opening line and `FetchLatestOfpOptions` name were written before
> implementation. `src/simbrief.ts`'s own acceptance criteria (frozen in
> `plan.json` T-005) required it to import no network/fs/db — unsatisfiable if
> the fetch client lived in the same file. As built: the function is
> `fetchSimbriefPlan`, in **`src/simbriefClient.ts`**, a sibling to
> `src/simbrief.ts` (which keeps only the pure parser and validator). The
> signature, timeout, error taxonomy, log-line format and every `userMessage`
> string above are implemented verbatim — only the file/function name split
> differs from this section's literal text. T-008 measured the behavior
> against this table and approved; treat `src/simbrief.ts` above as
> `src/simbriefClient.ts` wherever this section names a file.

---

## 6. The import endpoint

### 6.1 Method and path

    POST /api/trips/:id/planned-legs/simbrief

A **sibling route**. `POST /api/trips/:id/planned-legs`
(`src/server.ts:523-643`) is **not modified** — it keeps its multer middleware,
its multi-file batch semantics, and its response shape (§ 8). Registered in the
`// ── Planned legs ──` block immediately after the existing `POST`, before the
`GET` at `src/server.ts:645`, so the literal path stays ahead of `app.get('*')`.

Express matches `/api/trips/1/planned-legs/simbrief` against the existing
`POST /api/trips/:id/planned-legs` only for an exact path; the extra segment
means no overlap. Order within the block is belt and braces.

### 6.2 Request

```
POST /api/trips/7/planned-legs/simbrief
Content-Type: application/json

{ "allow_duplicates": false }
```

Body is optional; `{}` and an absent body behave as `allow_duplicates: false`.
**No user ID in the request** — the server reads it from `app_setting` (§ 2),
which is the whole point of storing it server-side. A client-supplied pilot ID
would let an authenticated page fetch arbitrary third-party OFPs (§ 10).

`allow_duplicates` is a **JSON boolean** here. The `.lnmpln` route's
`allow_duplicates === '1'` string check (`src/server.ts:534`) is a multipart
form-field artifact and stays exactly as it is (§ 8).

### 6.3 Success — 201

```json
{
  "imported": [ { "...": "the full PlannedLegWithChildren, as getPlannedLegById returns" } ],
  "result": {
    "status": "imported",
    "planned_leg_id": 42,
    "label": "UHPP → UHSS (SHG037)",
    "warnings": [ { "code": "NO_ALTERNATES", "message": "…" } ]
  }
}
```

`imported` is an array of exactly one leg so the client can reuse the existing
rendering path. `result` is a single object, **not** the `.lnmpln` route's
`results` array: one fetch is one plan, and a singular field name stops a
client from assuming it can be empty.

### 6.4 Duplicate — 200

When § 4.6's canonical hash already exists on this trip and `allow_duplicates`
is false:

```json
{
  "imported": [],
  "result": {
    "status": "duplicate",
    "planned_leg_id": 42,
    "label": "UHPP → UHSS (SHG037)",
    "warnings": [],
    "error": "This SimBrief plan is already imported into this trip as leg 3. Generate a new OFP on simbrief.com, or re-import to add it again."
  }
}
```

**200, not 4xx**: nothing failed and nothing changed. The client renders
`result.error` as a notice, not an error (§ 7.4).

### 6.5 Failures

Every failure returns `{ "error": <userMessage>, "code": <code> }`. The `error`
string is `SimbriefFetchError.userMessage` verbatim (§ 5.4), so the client
renders it without a lookup table of its own.

| Condition | Status | `code` |
|---|---|---|
| `:id` is not a number | 400 | `INVALID_TRIP` |
| Trip does not exist | 404 | `NOT_FOUND` |
| No `simbrief_user_id` setting | 400 | `NO_USER_ID` — `error`: `No SimBrief User ID is saved. Enter your SimBrief Pilot ID above and save it, then try again.` |
| `UNKNOWN_USER` | **400** | `UNKNOWN_USER` |
| `NO_PLAN` | **404** | `NO_PLAN` |
| `TIMEOUT` | **504** | `TIMEOUT` |
| `NETWORK`, `BAD_STATUS`, `BAD_BODY` | **502** | as-is |
| `SimbriefParseError` | **502** | `BAD_BODY` |
| Database insert throws | 500 | `DB_ERROR` |

502/504 and not 500: the failure is upstream, and the distinction is what makes
the log usable when the operator reports "import is broken".

### 6.6 A failed import writes nothing at all — guaranteed

The handler is ordered so that **no database write of any kind is reachable
before every fallible read has succeeded**:

1. Parse and validate `:id`; look up the trip. *(read only)*
2. `getSetting(SIMBRIEF_USER_ID_SETTING)`; 400 if null. *(read only)*
3. `await fetchLatestOfp(userId)`. *(network only — no db handle in scope)*
4. `parseSimbriefPlan(body)`. *(pure)*
5. Compute the canonical hash (§ 4.6); `findPlannedLegBySource`. *(read only)*
6. **`createPlannedLeg(...)`** — the first and only write.

Steps 1-5 contain no `INSERT`, `UPDATE` or `DELETE`. Step 6 is
`createPlannedLeg` (`src/db.ts:871`), which is already wrapped in
`db.transaction(...)`, so the leg and its waypoints and alternates commit
together or not at all. There is no second write to sequence with it and
therefore no partial-import state to reason about.

Concretely: an invalid ID, a network failure, a timeout, no recent plan, an
unparseable body, and a route-less plan **all return before step 6**. Existing
planned legs are untouched in every one of those cases, which is the user
story's acceptance criterion 5.

`seq` for the new leg is assigned the same way the `.lnmpln` path assigns it,
by `createPlannedLeg` itself. `chainOrderForBatch` is **not** called: it orders
a *batch*, and this route imports exactly one leg. The new leg lands at the end
of the trip, and the operator reorders with the existing ↑/↓ controls.

---

## 7. Client contract and the end-to-end verification recipe

### 7.1 Types

Added to **`client/src/types.ts`**, which owns every client-side wire type.
Nothing is removed from it and no existing interface is edited (§ 8).

```ts
export interface SimbriefSettings {
  simbrief_user_id: string | null;
}

export interface SimbriefWarning {
  code: string;
  message: string;
}

export interface SimbriefImportResult {
  status: 'imported' | 'duplicate';
  planned_leg_id: number;
  label: string;
  warnings: SimbriefWarning[];
  error?: string;
}

export interface SimbriefImportResponse {
  imported: PlannedLegWithChildren[];
  result: SimbriefImportResult;
}
```

`SimbriefWarning.code` is a plain `string`, not a union: the server may add a
warning code without the client failing to compile, and the client only ever
renders `message`.

The existing `LnmplnWarning` (`client/src/types.ts:213`) is **not** reused and
**not** renamed — two sources, two vocabularies, and renaming it would be a
breaking edit to a type the `.lnmpln` UI depends on.

### 7.2 Placement

All of it in **`client/src/pages/TripDetail.tsx`**, in a **new sibling `<div
className="simbrief-import-section">` placed immediately after** the existing
`<div className="planned-legs-import-section">` block, which currently spans
lines 567-600 and is not edited.

    ┌ Import Planned Route (.lnmpln)     ← existing, untouched
    └ …file input…

    ┌ Import from SimBrief              ← new
    │  SimBrief User ID  [ 1099607     ] [Save]
    └  [ Import from SimBrief ]

New state, added beside the existing `import*` state at
`client/src/pages/TripDetail.tsx:40-44` without renaming any of it:
`simbriefUserId`, `simbriefSaved`, `simbriefSaving`, `simbriefSettingsError`,
`simbriefImporting`, `simbriefError`, `simbriefResult`.

Load: a `GET /api/settings/simbrief` in the page's existing effect, prefilling
the input — the user story's acceptance criterion 2. A failure to load settings
sets `simbriefSettingsError` and **must not** block the rest of the page or the
`.lnmpln` import.

Save: `PUT /api/settings/simbrief` on the Save button. Import: `POST
/api/trips/:id/planned-legs/simbrief`, then re-fetch the trip with the existing
`apiFetch<Trip>(\`/api/trips/${id}\`)` call so the legs list refreshes exactly
as the `.lnmpln` import does.

### 7.3 Rendered states — all of them

| State | Rendered |
|---|---|
| Settings loading | input disabled, placeholder `Loading…` |
| No ID saved | empty input, Import button **disabled**, hint `Enter your SimBrief Pilot ID to enable import.` |
| ID saved, idle | input prefilled, Save disabled while unmodified, Import enabled |
| Editing, unsaved | Save enabled; Import **disabled** with hint `Save your SimBrief User ID first.` — so a click cannot use a stale server-side value |
| Saving | Save shows `Saving…`, both buttons disabled |
| Save rejected (§ 3.4) | `{error}` under the input in `className="edit-error"` |
| Importing | `Importing from SimBrief…` in `className="flight-plan-status"`, Import disabled |
| Import succeeded | `className="import-notice"`: `Imported UHPP → UHSS (SHG037) as a new planned leg.` plus any warnings, and the legs list has refreshed |
| Import succeeded with warnings | the same notice plus each `warnings[].message`, in `className="import-result-warning"` — success, not failure |
| Duplicate (§ 6.4) | `result.error` in `className="import-notice"`, **not** `edit-error` — nothing went wrong |
| Import failed (§ 6.5) | `body.error` verbatim in `className="edit-error"`; the legs list is **not** re-fetched |
| Settings load failed | `simbriefSettingsError` in `className="edit-error"`; the `.lnmpln` section still works |

Reuse the existing class names above. **No CSS class is renamed or removed**, and
new markup reuses existing classes rather than introducing a parallel set.

### 7.4 Failure must leave the page as it was

On any non-2xx, the handler sets `simbriefError` and returns **without** calling
`setTrip`. `trip.planned_legs` is therefore still the array the page already
rendered, so acceptance criterion 5 holds visibly and not just in the database.

### 7.5 End-to-end verification recipe

This exercises a **successful** import on `PORT=3100` against a scratch
database, with **no SimBrief account and no network**. The captured real
response (§ 1) is the upstream.

Never touch port 3000 or `flights.db`. Record the live file's md5 before and
after.

**Step 1 — scratch database.**

```bash
cd /home/guilherme/msfslogger
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
SCRATCH=$(mktemp -d)
md5sum flights.db                      # record: before
cp flights.db flights.db-wal flights.db-shm "$SCRATCH/" 2>/dev/null
```

**Step 2 — a stub SimBrief, serving the captured real response.**

```bash
node -e '
const http=require("http"), fs=require("fs");
const body=fs.readFileSync(".claude/runs/2026-09-13-simbrief-import/contracts/simbrief.userid.json");
http.createServer((req,res)=>{
  const u=new URL(req.url,"http://x");
  console.log("stub hit:", u.search);
  if (u.searchParams.get("userid")!=="1099607") {
    res.writeHead(400,{"content-type":"application/json"});
    res.end(JSON.stringify({fetch:{userid:u.searchParams.get("userid")||"",static_id:"",status:"Error: Unknown UserID",time:"0.0001"}}));
    return;
  }
  res.writeHead(200,{"content-type":"application/json"});
  res.end(body);
}).listen(3101,()=>console.log("stub on 3101"));
' &
```

The stub's success body is the byte-for-byte real capture, and its failure body
is the byte-for-byte real 400 from § 1.6 — so this exercises the § 5.3 verdict
ladder against real shapes, not invented ones.

**Step 3 — the app on 3100, pointed at the stub.**

```bash
npm run build
PORT=3100 DB_PATH="$SCRATCH/flights.db" \
  SIMBRIEF_API_BASE_URL='http://127.0.0.1:3101/api/xml.fetcher.php' \
  node dist/index.js &
```

`SIMBRIEF_API_BASE_URL` is read inside `src/simbrief.ts` (§ 5.2) and is
**not** in `src/config.ts`'s `ENV_VARS`.

**Step 4 — authenticate, save the ID, import.** `/api` is behind `requireAuth`,
so log in first and keep the cookie jar:

```bash
J=$SCRATCH/jar
curl -sS -c $J -X POST http://127.0.0.1:3100/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"…","password":"…"}'

curl -sS -b $J -X PUT http://127.0.0.1:3100/api/settings/simbrief \
  -H 'content-type: application/json' -d '{"simbrief_user_id":"1099607"}'
# expect: {"simbrief_user_id":"1099607"}

curl -sS -b $J http://127.0.0.1:3100/api/settings/simbrief
# expect the same — proves persistence (acceptance criterion 2)

curl -sS -b $J -X POST http://127.0.0.1:3100/api/trips/1/planned-legs/simbrief \
  -H 'content-type: application/json' -d '{}' | head -c 600
# expect: HTTP 201, result.status "imported", label "UHPP → UHSS (SHG037)"
```

**Step 5 — assert what actually landed.**

```bash
node -e '
const D=require("better-sqlite3"); const db=new D(process.env.SCRATCH+"/flights.db",{readonly:true});
const leg=db.prepare("SELECT * FROM planned_legs ORDER BY id DESC LIMIT 1").get();
console.log(leg.departure_ident, leg.destination_ident, leg.cruise_alt_ft, leg.flightplan_type,
            leg.aircraft_type, leg.source_filename, leg.approx_distance_nm, leg.waypoint_count);
console.table(db.prepare("SELECT seq,ident,type,airway,alt_ft FROM planned_waypoints WHERE planned_leg_id=? ORDER BY seq").all(leg.id));
'
```

Expected, from the real capture: `UHPP UHSS 28000 IFR BE20
simbrief-186182026.json 755.3 18`, and a waypoint table beginning
`1 UHPP AIRPORT` and ending `18 UHSS AIRPORT`, with `TOC`/`TOD` as `USER`.

**Step 6 — the failure and duplicate paths.**

```bash
# duplicate: same OFP again -> 200, result.status "duplicate", no new leg
curl -sS -b $J -X POST http://127.0.0.1:3100/api/trips/1/planned-legs/simbrief \
  -H 'content-type: application/json' -d '{}'

# unknown user: change the setting, re-import -> 400 UNKNOWN_USER
curl -sS -b $J -X PUT http://127.0.0.1:3100/api/settings/simbrief \
  -H 'content-type: application/json' -d '{"simbrief_user_id":"999999999"}'
curl -sS -b $J -X POST http://127.0.0.1:3100/api/trips/1/planned-legs/simbrief \
  -H 'content-type: application/json' -d '{}'

# network failure: kill the stub, re-import -> 502 NETWORK
# validation: -d '{"simbrief_user_id":"oshogun"}' -> 400 INVALID_ID
```

After each failure, re-run step 5's leg count and confirm it is unchanged.

**Step 7 — tear down.** Kill both background processes, `rm -rf "$SCRATCH"`,
and `md5sum flights.db` again: it must equal step 1's.

**Unit tests** (`tests/simbrief.test.ts`, mirroring `tests/lnmpln.test.ts`)
read `contracts/simbrief.userid.json` read-only as a fixture and call
`parseSimbriefPlan` directly — pure, no network. The fetch client is tested by
passing `fetchImpl` (§ 5.1) a stub returning the captured error bodies, one per
row of § 5.4.

---

## 8. The `.lnmpln` surfaces that must not change

The user story's acceptance criterion 6 is "Little Navmap integration continues
to work as before". Each row is checkable with `git diff` on the named range.
**Any diff in these ranges is a review failure unless this section is amended
first.**

| File | Range | What it is |
|---|---|---|
| `src/lnmpln.ts` | **1-980 (entire file)** | The `.lnmpln` parser, `ParsedFlightPlan`, `LnmplnParseError`, `chainOrderForBatch`. This run adds `src/simbrief.ts`; it does not touch this file. `git diff --stat -- src/lnmpln.ts` must be empty. |
| `src/server.ts` | **45-67** | `MAX_LNMPLN_FILES`, the `uploadLnmpln` multer config |
| `src/server.ts` | **68-~75** | `looksLikeXml` |
| `src/server.ts` | **523-643** | `POST /api/trips/:id/planned-legs` — the whole multi-file handler, including the `allow_duplicates === '1'` string check at 534, the in-batch dedupe at 546-552, the `[LNMPLN]` warning log at 601, and the `{ imported, batch, results }` response at 641 |
| `src/server.ts` | **645-654** | `GET /api/trips/:id/planned-legs` |
| `src/server.ts` | **656-718** | `PATCH /planned-legs/order`, `DELETE /api/planned-legs/:legId`, `PATCH /api/planned-legs/:legId` |
| `src/db.ts` | **90-192** | The `planned_legs` DDL. **No column added, dropped, renamed or repurposed.** § 4.6 exists precisely so `source_filename`/`source_sha256` stay as they are. |
| `src/db.ts` | **193-226** | `planned_waypoints`, `planned_alternates`, and the three indexes |
| `src/db.ts` | **767-851** | `CreatePlannedLeg*` interfaces. § 4 maps *onto* these; it does not widen them. |
| `src/db.ts` | **871-945** | `createPlannedLeg`. The SimBrief route calls it unchanged. |
| `src/db.ts` | **970-975** | `findPlannedLegBySource` |
| `src/db.ts` | **~256-262** | `app_secret` DDL. § 2 adds a sibling table; this one is not touched (§ 2.5). |
| `src/config.ts` | **~50-…** | `ENV_VARS`. `SIMBRIEF_API_BASE_URL` is **not** added (§ 5.2). |
| `src/geo.ts` | **23-33** | `haversineNm`. § 4.5 calls it; it is not modified. |
| `client/src/pages/TripDetail.tsx` | **189-233** | `handleImportPlannedLegs` |
| `client/src/pages/TripDetail.tsx` | **567-600** | The `.lnmpln` import section markup |
| `client/src/types.ts` | **206-258** | `PlannedLegWithChildren`, `LnmplnWarning`, `BatchChainReason`, `PlannedLegImportResult`, `PlannedLegImportResponse` — additive only; nothing renamed |
| `tests/lnmpln.test.ts` | entire file | Must still pass untouched. `npm test` green is the evidence. |
| `samples/lnmpln/` | entire directory | Fixtures. Not edited, not moved. |

Line numbers are as of the freeze; if an earlier task in this run shifts them,
the *named construct* is what is protected, not the integer.

Behavioural guarantees, checkable without reading a diff:

1. Uploading a `.lnmpln` file still returns `{ imported, batch, results }` with
   `results` an **array**, and the multi-file batch chain ordering still works.
2. `.lnmpln` duplicate detection still keys on the **sha256 of the file bytes**.
   § 4.6's canonical hash is computed only on the SimBrief path.
3. `npm test` passes with no test modified or skipped.
4. `npx tsc` is clean.

---

## 9. Alternatives considered

### 9.1 Store a username instead of a pilot ID

§ 1.1 shows `username=` works and returns the identical document. Rejected:
§ 1.6 shows an unknown *username* is reported as `Error: Unknown UserID` with
an **empty** `fetch.userid`, so the two cases are indistinguishable and the
error message could not be made specific. The numeric ID also validates
locally (§ 3.3), turning a network round-trip into an instant rejection. The
setting is a `TEXT` column and § 3.3's rule is one regex, so adding username
support later is additive.

### 9.2 Hash the raw response body for `source_sha256`

The obvious mirror of the `.lnmpln` path, and wrong. Two fetches of the same
unchanged OFP differ in `$.fetch.time` (§ 1.1, measured — the *only* differing
path out of a 333 KB document). Body hashing would make
`findPlannedLegBySource` never match and every re-import a new duplicate leg.
The canonical-identity hash (§ 4.6) was chosen because it is stable across
fetches and still changes when the operator generates a genuinely new OFP.
Rejected alternative within that: hashing `request_id` alone — `sequence_id`
and `time_generated` cost nothing and protect against ID reuse.

### 9.3 Drop the `TOC`/`TOD` pseudo-waypoints

`type: "ltlg"` points are computed, not navaids, so there is a case for
omitting them. Rejected: they carry real route geometry, and the prototype
shows the chain including them sums to 755.3 nm against SimBrief's own
`route_distance` of 754 (§ 4.5). Dropping them would make the stored distance
disagree with SimBrief's for no gain, and the operator would see a route on the
map that skips the cruise-profile corners. They are mapped to `USER` (§ 4.4),
which is exactly what `.lnmpln` calls a computed lat-long, so no existing
consumer needs to learn a new type.

### 9.4 Extend `POST /api/trips/:id/planned-legs` instead of a sibling route

Rejected. That handler is multer-wrapped and multi-file throughout; a JSON
body would have to thread past the upload middleware, and its `results` array
and `batch` ordering are meaningless for a single fetched plan. A sibling route
(§ 6.1) leaves 120 lines of working, reviewed code literally untouched, which
is also what makes § 8 checkable with `git diff`.

### 9.5 Store the pilot ID in browser `localStorage`

Rejected in intake and confirmed here: the **server** makes the outbound call
(§ 5), so the server must hold the value. A client-supplied ID per request is
worse still — see § 10.

### 9.6 Add `SIMBRIEF_API_BASE_URL` to `src/config.ts`

Rejected, and the task forbids it. `ENV_VARS` is scoped by its own comment to
security-relevant configuration; a test seam there would mean a DevOps task to
document and validate a variable that exists only so a test can point at
localhost. `src/pdfExport.ts:28` already set the precedent of reading such an
override locally.

### 9.7 A global settings page

Rejected in intake. There is no settings page in this client today, and
building one to hold a single field is out of proportion to the story. The
field lives where the user already goes to populate planned legs (§ 7.2). The
endpoints (§ 3) are generic enough that a settings page could later adopt them
unchanged.

---

## 10. Risks

1. **SimBrief's API is unversioned and undocumented at field level.** § 1's
   paths come from one real capture. If SimBrief renames `navlog.fix` or moves
   `general.initial_altitude`, the import breaks at parse time — loudly, as a
   `SimbriefParseError` → 502, not silently. *Falsified by:* a future capture
   whose paths differ from § 1.3. Mitigation: the captured response is committed,
   so a regression is diffable.

2. **The single-element collapse is only half-verified.** § 1.5 proves one
   alternate is an object. It is *inferred*, not observed, that **two**
   alternates give an array — that is how PHP's serializer behaves and how
   `navlog.fix` (17 entries) and `files.file` behave, but no captured document
   has two alternates. `arr()` (§ 4.1) handles both, so the code is correct
   either way; what is unverified is only that arrays ever appear here.
   *Falsified by:* a two-alternate OFP that returns something other than an array.

3. **No success capture contains alternates, a VFR plan, or an oceanic track.**
   `$.alternate`, `$.tracks` and `$.alternate_navlog` were all `{}` in the
   operator's plan. § 4.3's alternate mapping is built from the *shape probe*
   (field names verified, values from other pilots' plans, bodies not retained)
   rather than from a committed sample. `atc.flight_rules == "V"` was never
   observed. These paths will first execute in production.

4. **SimBrief's API is entirely unauthenticated (§ 1.1).** Any pilot ID
   fetches that pilot's latest OFP. This is why § 6.2 takes the ID from
   server-side settings and **not** from the request body: otherwise any
   authenticated page in this app becomes an open proxy for reading strangers'
   flight plans. If a future change adds a per-request ID, this risk returns.

5. **Only the *most recent* OFP is reachable.** There is no "list my plans"
   endpoint in scope. An operator who generates a new OFP before importing the
   old one has lost the old one. The duplicate message (§ 6.4) says so.

6. **`request_id` reuse would silently suppress an import.** If SimBrief ever
   reuses a `request_id` for a different plan, § 4.6's hash collides and the
   second plan reports as a duplicate. `sequence_id` and `time_generated` are in
   the hash specifically to make this implausible, and `allow_duplicates` is the
   escape hatch.

7. **A 333 KB response for ~18 useful waypoints.** Parsed fully into memory on
   every import. Acceptable for a single-operator app with a manual trigger;
   it would not be if this were ever polled.

8. **`approx_distance_nm` is now conservatively named for SimBrief legs**
   (§ 4.5) — the number is accurate but the UI still says "approx.". Deliberate:
   changing the label is a `.lnmpln`-visible change (§ 8) and out of scope.
