# SayIntentions.AI integration — frozen design

Run: `2026-09-17-sayintentions-integration` · Task: T-001 · Designer, 2026-09-17

Read this in slices, not whole: `.claude/tools/ctx.sh design
2026-09-17-sayintentions-integration <section>…`, where `<section>` is a number
(`9`, `11.2`) or a keyword from a heading (`settings`, `link`, `migration`,
`client`, `pull`, `push`, `condensed`, `failure`, `trigger`, `ingest`,
`frontend`, `contracts`). Section numbers are an interface: they are cited by
task envelopes and must never be renumbered. Amendments edit in place and keep
the number — see §1.

Companion artifacts in this run directory:

- `contracts/types.additions.ts` — the exact block to append to `src/types.ts`.
- `contracts/sayIntentionsClient.stub.ts` — the HTTP client's declared surface.
- `contracts/sayIntentionsLinks.stub.ts` — the new db module's declared surface.
- `contracts/schema.sql` — the one DDL statement, with placement instructions.
- `contracts/routes.md` — the route table and its reachability argument.
- `contracts/samples/*.json` — every request and response body, exact.
- `prototypes/condense.js`, `prototypes/stamp.js` — run, with output quoted in
  §11.3 and §9.6. Prototypes, not implementation; nothing in `src/` imports them.

---

## 1. Amendments

None yet. When reality contradicts a frozen section after this point, edit that
section in place, keep its number, and add a row here naming the evidence that
forced the change.

| # | Date | Section | Change | Evidence |
|---|------|---------|--------|----------|
| 1 | 2026-09-17 | §9.4, `sayIntentionsLinks.stub.ts` | Added a `COALESCE`-style backfill of `upstream_flight_id` from `null` on any import that observes one, via a new `upstreamFlightId` argument on `advanceSayIntentionsCursor`. | T-002 review (`reviews/phase-1.md`): a link made while `flight_id` was omitted left the session-changed guard permanently disabled for that flight, not just for its first import. |
| 2 | 2026-09-17 | §8.1, §15 | Removed R5 from the F1 table row; added a standalone note that `DELETE …/link` never consults F1–F16, the saved key, or `sayIntentionsClient` — it is always 200, `unlinked: true\|false` on row existence alone. Reworded §15's R5 line, which conflated "no key" with "no link." | T-002 review: §8.1 stated R5 returns 409 under F1 while §15 stated 200 `{unlinked:false}` for the same condition — an implementer following §8.1 literally would send the wrong status. |
| 4 | 2026-09-17 | §4.3 | `maskApiKey` no longer reveals any real characters of the key. Changed from `key.slice(0,4) + '…' + key.slice(-4)` to a fixed `'••••••••'` placeholder for any set key. | The operator, looking at the running Prefiles page ("Saved: gDkt…Xv2G"), flagged that showing part of the real key is a real leak, not acceptable masking — 8 real characters is meaningful entropy for a credential, however partial it looks. |
| 3 | 2026-09-17 | §13, §18 items 8 & 16 | Reversed the ingest-token-scope decision: R1, R3, R4, R5, R6, R7 now go on `INGEST_SCOPED_ROUTES`; R2 stays off, unchanged. `INGEST_SCOPED_ROUTES`'s `method` type must widen to include `DELETE` for R5. §18's must-not-change items 8 (claimed the allow-list was untouched) and 16 (claimed no MCDU change was implied) updated to match — implemented as T-012, reviewed and approved (`reviews/phase5-mcdu-scope.md`). | The operator, coordinating with the MCDU session after this run's original ship, stated the intended architecture explicitly: the server is the only thing that talks to SayIntentions directly, and the MCDU is meant to be a full interface to this feature through the server — the same trust level already extended to every comparable existing ACARS route the MCDU already drives. The original "MCDU coordination is out of scope for this run" premise no longer holds once that coordination is actually happening in this run. |

Two more sections were already expected to need one, and are written so the
amendment is a one-line change rather than a redesign — see §19.1 and §19.2.

---

## 2. What this freezes, and what it deliberately does not

Two independent, optional, default-off integrations with SayIntentions.AI's
pilot-key SAPI:

- **Pull** — import a SayIntentions session's ATC/CPDLC transcript
  (`getCommsHistory`) into one msfslogger flight's existing ACARS thread (§9).
- **Push** — deliver a leg's already-generated PDC into the pilot's live
  SayIntentions session as a real in-sim message (`sayAs`,
  `channel=ACARS_IN`), condensed to fit 128 characters (§10, §11).

Neither half depends on the other. An operator may use one, both or neither.
Nothing about the app changes for an operator who never saves a key (§15).

Frozen upstream of this document, and not relitigated here:

1. Pilot API key only. `importVAData` and every partner-key endpoint are out of
   scope, as are `setFreq`/`setVar`/`setPause`/`getAirport`/`assignGate`/
   `getParking` and `getWX`/`getVATSIM`/`getTFRs`.
2. A manual per-flight linking step is the accepted answer to "the two systems
   share no session id." §5 designs that step; it does not try to avoid it.
3. Both features optional and default-off.
4. `acars_messages` is reused for both directions. §3.2 records that it holds
   both without a single column change.

What this design does **not** settle, on purpose: anything in the MCDU client
repository (`msfslogger_mcdu`). No route here is reachable by an ingest token
(§13), so no MCDU change is implied, required, or blocked.

### 2.1 The two facts this design rests on that were not verifiable here

No SayIntentions API key exists in this environment, so no call was made to the
real service. Two things are therefore taken from
`sayintentions-api-notes.md`'s reading of the docs rather than from a capture:
the exact field polarity of `comm_history[]` (§9.5) and the shape of a `sayAs`
confirmation (§7.4). Both are isolated behind a single constant or a single
mapping table, and T-003's inspector (§16.1) is the step that settles them. See
§19.1, §19.2.

Everything that *could* be verified locally was: the condensed-message
algorithm was run against 7 worked cases plus a 1 802-input boundary sweep
(§11.3), the timestamp rule against 17 inputs under two timezones (§9.6), and
every claim about this repository's existing code in §18 was read out of the
file it names.

---

## 3. Data model and type ownership

### 3.1 Where each type lives

| Type | File | Added by |
|---|---|---|
| `SayIntentionsSettings` | `src/types.ts` | T-003 |
| `SayIntentionsLink`, `SayIntentionsLinkStatus`, `SayIntentionsLinkResponse`, `SayIntentionsImportResponse`, `SayIntentionsCommPayload` | `src/types.ts` | T-006 |
| `SayIntentionsPushResponse`, `SayIntentionsPushPayload` | `src/types.ts` | T-009 |
| `SayIntentionsErrorCode`, `SayIntentionsFetchError`, `SayIntentionsClientOptions`, `CommHistoryEntry`, `CommsHistoryResult`, `SayAsParams`, `SayAsResult` | `src/sayIntentionsClient.ts` | T-003 |
| `SayIntentionsLinkRow` | `src/db/sayIntentionsLinks.ts` | T-003 |
| `SayIntentionsSettings` (mirror) | `client/src/types.ts` | T-004 |
| `SayIntentionsLink*`, `SayIntentionsImportResponse` (mirrors) | `client/src/types.ts` | T-007 |
| `SayIntentionsPushResponse` (mirror) | `client/src/types.ts` | T-010 |

Full declarations with comments: `contracts/types.additions.ts`. They go under
one new `// ── SayIntentions ──` banner in `src/types.ts`, placed after the
ACARS block, each task appending to the same banner. Three tasks write this
file in three different phases, never concurrently, and none of them edits a
line another wrote.

`client/src/types.ts` is hand-mirrored, as it already is for every other wire
type in this app. The mirror drops nothing and renames nothing.

### 3.2 `acars_messages` holds both directions unchanged

Both halves reuse `acars_messages` with **no column added, widened or
repurposed**. The table already carries everything either direction needs:

| Need | Column that answers it |
|---|---|
| Whose thread a comm belongs to | `flight_id` (pull), `planned_leg_id` (push) |
| Who spoke | `direction` — `uplink` for a station, `downlink` for the cockpit |
| What kind of message | `category` — validated by shape, not membership (`isValidAcarsCategory`, `src/acars.ts`), so `'atc'` needs no migration |
| Heading | `label` |
| The text | `body` |
| The upstream record, losslessly | `payload_json` — "owned entirely by the writing feature" per the column's own comment |
| "Never file this twice" | `dedup_key` + the partial unique index, via `insertAcarsMessageOnce` |
| When | `sent_at` — ISO 8601 UTC |

No concrete reason was found to deviate. The one property worth stating
explicitly: `listAcarsMessagesForFlight` already returns a flight's own rows
**plus** the rows of the planned leg it is linked to, so a push recorded on the
leg (§10.4) shows up in the flight's thread automatically once the flight is
linked to that leg, with no code in this design doing anything for it.

### 3.3 The new table's row type

One new table, `sayintentions_links`, one row per linked flight. Columns, DDL
and placement in §6; the TypeScript row type is `SayIntentionsLinkRow` in
`src/db/sayIntentionsLinks.ts` (`contracts/sayIntentionsLinks.stub.ts`).

| Field | Type | Null? | Owner | Meaning |
|---|---|---|---|---|
| `flight_id` | `number` | no (PK) | this table | The msfslogger flight |
| `upstream_flight_id` | `string \| null` | yes | SayIntentions | Their session id at link time |
| `since_id` | `number \| null` | yes | this table | Cursor: highest `comm_history[].id` imported. `null` = none yet |
| `baseline_comm_id` | `number` | no, default 0 | SayIntentions | Highest id that existed at link time |
| `linked_at` | `string` | no | this table | ISO 8601 UTC |
| `last_import_at` | `string \| null` | yes | this table | ISO 8601 UTC |
| `imported_count` | `number` | no, default 0 | this table | Rows written by this link, cumulative |

---

## 4. Settings — storing the pilot API key

### 4.1 The key name and the storage mechanism

The pilot API key is stored in the existing `app_setting` table through the
existing `getSetting`/`setSetting` (`src/db/settings.ts`), used verbatim. **No
new table, no new column.**

```ts
// src/sayIntentions.ts — owner T-003; mirrors SIMBRIEF_USER_ID_SETTING's
// placement in src/simbrief.ts
export const SAYINTENTIONS_API_KEY_SETTING = 'sayintentions_api_key';
```

One caveat has to be recorded rather than glossed. `app_setting`'s DDL comment
in `src/db/schema.ts` currently ends: *"Nothing here is a credential — the only
row today is the SimBrief pilot ID, a public identifier SimBrief's API accepts
unauthenticated."* A SayIntentions key **is** a credential, so that sentence
stops being true the moment this ships. T-003 updates that comment as part of
its schema work — the only edit this design makes to an existing line of
`src/db/schema.ts`, and it is a comment:

> Operator-editable settings, entered through the UI and read by the server.
> Deliberately separate from `app_secret`, which holds values the server
> generates and the operator never sees: a DELETE-by-name bug here must not be
> able to log everyone out, and a future "show me the settings" endpoint must
> not be one `SELECT *` away from the session secret. One row here **is** a
> credential — `sayintentions_api_key`, the operator's own SayIntentions pilot
> key — so no route may return an `app_setting` value without knowing which
> name it is reading (see `/api/settings/sayintentions`, which returns only a
> masked form).

The separation the original comment was protecting is untouched: the session
secret still lives in `app_secret`, and nothing in this app does `SELECT * FROM
app_setting`. §17.1 records the alternatives.

### 4.2 Validating a key

SayIntentions publishes no key format, so the rule is a shape guard against
paste errors, not a format check. In `src/sayIntentions.ts`, mirroring
`validateSimbriefUserId`'s result shape exactly:

```ts
export const MIN_SAYINTENTIONS_API_KEY_LENGTH = 8;
export const MAX_SAYINTENTIONS_API_KEY_LENGTH = 200;

export type SayIntentionsApiKeyResult =
  | { ok: true; apiKey: string | null }         // null means "clear it"
  | { ok: false; code: 'INVALID_API_KEY'; error: string };

export function validateSayIntentionsApiKey(raw: unknown): SayIntentionsApiKeyResult;
```

Rules, in order:

1. Not a string and not `null`/`undefined` → `{ ok: false }`, error *"A
   SayIntentions API key must be text"*.
2. Trim. Empty → `{ ok: true, apiKey: null }` — clearing the setting, exactly
   as an empty SimBrief ID does.
3. Length outside 8…200, or any character outside `/^[\x21-\x7E]+$/` (printable
   ASCII, no space) → `{ ok: false, code: 'INVALID_API_KEY' }`, error *"A
   SayIntentions API key must be 8 to 200 characters with no spaces — copy it
   from your SayIntentions account page."*
4. Otherwise `{ ok: true, apiKey: <trimmed> }`.

No regex beyond "printable, no whitespace": guessing at a prefix or a length
would reject a valid key the day SayIntentions changes its format, and the
first real call is a better validator than we are.

### 4.3 The key goes in and does not come back out

`GET /api/settings/sayintentions` returns whether a key is stored and a masked
form of it — **never the key**. This is a deliberate, named deviation from
"mirror `/api/settings/simbrief` exactly": a SimBrief pilot ID is a public
identifier, a SayIntentions key is a credential, and there is no reason to put
it back on the wire, into the DOM, or into a screenshot.

```ts
// src/sayIntentions.ts — owner T-003
/** A fixed placeholder for any set key, revealing no characters and no
 *  length. null in, null out. */
export function maskApiKey(key: string | null): string | null;
```

**Amended (see §1, amendment #4): the rule is now `null` → `null`; any set
key → the fixed string `'••••••••'`, regardless of its real length.** The
original rule (`length < 12` → `'••••'`; otherwise `key.slice(0, 4) + '…' +
key.slice(-4)`) revealed 8 real characters of the saved key on the Prefiles
page — real entropy, not a cosmetic partial-reveal. A fixed placeholder is
the only value that carries zero information about the key, including its
length.

Consequences frozen here so nothing re-decides them:

- The key is readable only by the server process and by anyone with the
  database file. It is not encrypted at rest. The database already holds
  password hashes and the session secret and is already the trust boundary;
  encrypting one column against an attacker who has the file would be theatre.
- **The key is never logged, never interpolated into an error message, and
  never appears in a thrown error's `message`, `userMessage` or stack.** SAPI
  takes it as a query parameter, so this specifically bans logging the request
  URL (§7.5).
- The key never appears in `payload_json`, in an `acars_messages.body`, or in
  any response body other than the masked form.

### 4.4 Routes R1 and R2

Both in `src/routes/settings.ts`, next to the SimBrief pair, same router, same
mount, same `requireAuth`/`requireSameOrigin` gating.

**`GET /api/settings/sayintentions` → always 200**, never 404 — an unset
setting is a value, not an absence, the same rule the SimBrief route states:

```json
{ "sayintentions_api_key_set": false, "sayintentions_api_key_masked": null }
```

**`PUT /api/settings/sayintentions`**, body `{ "sayintentions_api_key": string
| null }`:

- Body not an object → `400 { error: 'Invalid request body', code: 'INVALID_BODY' }`.
- `validateSayIntentionsApiKey` fails → `400 { error, code: 'INVALID_API_KEY' }`.
- Otherwise `setSetting(SAYINTENTIONS_API_KEY_SETTING, result.apiKey)` — a
  `null` deletes the row, which is how "clear my key" works with no second
  route — then `200` with the same shape `GET` returns.
- Unexpected throw → `500 { error: String(err) }`, identical to the SimBrief
  handler.

`src/server.ts`'s malformed-JSON handler already covers these: it keys on
`req.path.startsWith('/api/settings/')`. No change there.

---

## 5. Link storage — binding a flight to a SayIntentions session

### 5.1 What is linkable, and why it is the flight

**A flight. Not a planned leg, and not a trip.** One `flights.id` ↔ one
SayIntentions session.

The existing scoping split is the precedent: WX is available on both a flight
and a planned leg because a weather request is about *right now* and makes
sense in either context; the load sheet and the clearance are planned-leg-only
because both are derived from the leg's on-file dispatch release, which exists
before a `flights` row does (`src/routes/acars.ts`). A comms transcript is
neither. It is a record of radio calls that *happened*, which is the flight's
domain, and four things follow from that:

1. Every flight has an id. A planned leg is optional — most flights in this
   logbook have `planned_leg_id` null — so leg-scoped linking would make the
   feature unavailable for the majority of flights.
2. A leg-scoped import would land in the thread of whichever flight later links
   to that leg, which is a correlation the operator never made.
3. Rows filed against the flight already appear on the flight's ACARS page,
   which is where the operator is standing when they press the button.
4. One scope keeps the dedup key unambiguous (§9.7). Two scopes would let the
   same upstream message be claimed by two different rows.

A trip is the wrong grain for the same reason a trip has many legs: one
SayIntentions session is one flight, and `getCommsHistory` is scoped to the
session the key currently holds.

**Consequence, stated so the UI does not have to guess:** on the planned-leg
scope of `AcarsMessages.tsx` there is no link control and no import button
(§14.2). The push button *is* available there, because push is leg-scoped
(§10.2).

### 5.2 What one link row holds

The seven fields in §3.3, in the `sayintentions_links` table (§6). In prose:
which SayIntentions session this flight was pointed at, how far the import has
read, when the link was made, when it last ran, and how much it has written.

`since_id` is the cursor the pull direction needs between imports, and it is
the reason this is a row rather than a boolean.

### 5.3 What linking actually does

`POST /api/flights/:id/sayintentions/link` (R4). It calls
`getCommsHistory(apiKey)` **once**, at that instant, and records what came
back. That call is the entire correlation mechanism: there is no shared id
between the two systems, so "which session" can only mean "the one this key
answered with when the operator pressed the button."

From the response it records:

- `upstream_flight_id` = the response's `flight_id`, as a string, or `null`.
- `baseline_comm_id` = `max(comm_history[].id)`, or `0` for an empty list.
- `since_id` = `null` with the default `?from=session_start`, or
  `baseline_comm_id` with `?from=now`.
- `linked_at` = now.

`?from=session_start` (the default) imports everything `getCommsHistory`
returns. `?from=now` imports only what happens after the link — the escape
hatch for the case in §19.1, where the endpoint turns out to return more
history than the current session.

`pending_messages` in the response is the count of entries the first import
would file (`comm_history.length` for `session_start`, `0` for `now`), so the
operator sees the size of what they just armed.

Re-linking an already-linked flight is allowed and returns `200` with
`created: false`. It overwrites the session id, the baseline and the cursor —
that is the point of re-linking — but preserves `imported_count`, since the
rows it counts are still in the thread. `DELETE` (R5) removes the row; it never
deletes any `acars_messages` row, because a transcript already read is history,
not state.

### 5.4 Why the link is not derived, inferred, or automatic

There is nothing to derive it from. `getCommsHistory` answers for "whoever
holds this key" and reports a `flight_id` that is SayIntentions' own. There is
no msfslogger identifier anywhere in their API surface and no callsign
guaranteed to match. Matching on aircraft type, departure ICAO or timestamps
was considered and rejected in §17.4: a wrong automatic link files another
flight's radio calls into this flight's logbook, silently, and the operator has
no way to tell. The user has already accepted the manual step; this design
spends it on an explicit, visible, reversible action instead.

---

## 6. Migration — the one schema change

**Yes, one new table. No column is added to, dropped from, or repurposed in any
existing table.**

Full DDL with comments: `contracts/schema.sql`. Condensed:

```sql
CREATE TABLE IF NOT EXISTS sayintentions_links (
  flight_id          INTEGER PRIMARY KEY REFERENCES flights(id) ON DELETE CASCADE,
  upstream_flight_id TEXT,
  since_id           INTEGER,
  baseline_comm_id   INTEGER NOT NULL DEFAULT 0,
  linked_at          TEXT    NOT NULL,
  last_import_at     TEXT,
  imported_count     INTEGER NOT NULL DEFAULT 0
);
```

### 6.1 Placement and idempotency

It goes inside `applySchema()`'s single `db.exec(\`…\`)` template in
`src/db/schema.ts`, immediately **after** the `app_setting` `CREATE TABLE` and
before the closing backtick. Not in the `PRAGMA table_info` block below it —
there is no column to add — and not after `migratePlannedLegsTripIdNullable()`.

It is `CREATE TABLE IF NOT EXISTS`, the idiom every other table in that file
uses, so:

- running it against a database that already has the table is a no-op;
- running it against the user's live `flights.db` creates an empty table and
  touches no existing row;
- starting the server twice in a row produces no error;
- there is nothing to roll back, and no state a downgrade would corrupt —
  an older build simply ignores the table.

`PRAGMA foreign_keys = ON` is active, so the `REFERENCES flights(id) ON DELETE
CASCADE` is enforced: deleting a flight deletes its link row along with its
`acars_messages` rows, which already cascade the same way. No orphan cursor
survives a flight deletion.

The `planned_legs` table-rebuild migration at the top of `src/db/schema.ts`
runs with `foreign_keys` OFF and fires every `ON DELETE` action referencing
`planned_legs`. This table references `flights` only, so that rebuild cannot
reach it.

### 6.2 Why a table and not more `app_setting` rows

A composite key such as `sayintentions_link:flight:42` holding a JSON blob was
the cheaper option and was rejected:

- `app_setting` has no foreign key, so deleting a flight would strand its link
  row forever. `flights.id` is `AUTOINCREMENT`, so a stale row would not
  silently attach to a new flight — but it would still accumulate, and nothing
  would ever clean it up.
- The cursor is read-modify-written on every import. In a JSON blob that is
  parse-mutate-serialise with no way to make it one statement;
  `advanceSayIntentionsCursor` is a single `UPDATE`.
- `app_setting.value` is `TEXT NOT NULL` with no shape. A typed row with a
  `NOT NULL` on `linked_at` and `baseline_comm_id` is checked by the database.
- §4.1's credential note gets harder to hold if `app_setting` also becomes the
  place per-flight state lives: the rule "no route returns an `app_setting`
  value without knowing which name it reads" is easier to keep with three known
  names than with an open namespace.

The counter-argument — a table is a migration, and migrations are risk — is
real and is why this one is a single additive `CREATE TABLE IF NOT EXISTS` with
no data movement.

### 6.3 The db module

`src/db/sayIntentionsLinks.ts`, mirroring `src/db/acarsMessages.ts`: one
module, one table, no express, no HTTP, reads that name their columns rather
than `SELECT *`. Declared surface in `contracts/sayIntentionsLinks.stub.ts`:
`getSayIntentionsLink`, `upsertSayIntentionsLink`,
`advanceSayIntentionsCursor`, `deleteSayIntentionsLink`.

It is imported directly as `'../db/sayIntentionsLinks'` and is **not**
re-exported from `src/db.ts` — that barrel is in no implementer task's
`allowed_paths`, and `src/db/groundSessions.ts` already sets the precedent of a
module imported by path (see the import at the top of
`src/routes/groundSessions.ts`).

---

## 7. Client — `src/sayIntentionsClient.ts`

Full declared surface with comments: `contracts/sayIntentionsClient.stub.ts`.

### 7.1 Shape and isolation

Mirrors `src/weatherClient.ts` exactly in posture: it is the only module in the
tree that talks to SayIntentions, it owns the network and nothing else, and it
imports neither `./db` nor `express`. It hands back a plain result or rejects
with a `SayIntentionsFetchError` and never anything else. A `grep` for a `db`
or `express` import in that file must find none.

Base URL: `https://apipri.sayintentions.ai/sapi`, overridable per call by
`process.env.SAYINTENTIONS_API_BASE_URL` read at call time, not captured at
module load — the same test-seam idiom as `WEATHER_API_BASE_URL`, and
deliberately not part of `src/config.ts`'s `ENV_VARS`.

Timeout: `SAYINTENTIONS_TIMEOUT_MS = 10_000`, per call, via
`AbortSignal.timeout`, overridable through `opts.timeoutMs`.

**No cache.** `weatherClient` caches because a METAR is slow-moving and shared;
a comms transcript changes with every radio call and `sayAs` is a side effect
that must happen when asked. There is no `clearSayIntentionsCache()` to mirror
and no cache-hit path in the tests.

### 7.2 Signatures

```ts
export function getCommsHistory(
  apiKey: string,
  sinceId?: number | null,
  opts?: SayIntentionsClientOptions,
): Promise<CommsHistoryResult>;

export function sayAs(
  apiKey: string,
  params: SayAsParams,
  opts?: SayIntentionsClientOptions,
): Promise<SayAsResult>;

export type SayIntentionsErrorCode =
  | 'NO_KEY' | 'BAD_KEY' | 'NETWORK' | 'TIMEOUT'
  | 'BAD_STATUS' | 'BAD_BODY' | 'NO_ACTIVE_SESSION';

export class SayIntentionsFetchError extends Error {
  readonly code: SayIntentionsErrorCode;
  readonly userMessage: string;
  readonly httpStatus?: number;
  constructor(code, detail, userMessage, extra?: { httpStatus?: number });
}
```

`SayIntentionsFetchError`'s constructor and field set are
`WeatherFetchError`'s, field for field, including `super(\`${code}
(${detail})\`)` and `this.name`. `BAD_KEY` is the one code with no
`WeatherFetchError` counterpart, and it exists because aviationweather.gov has
no authentication at all while this service does: a rejected key needs a
different sentence from "the service returned an error."

Request construction:

- `getCommsHistory`: `GET {base}/getCommsHistory` with `api_key`, plus
  `since_id` when `sinceId` is a finite number `> 0`. A non-finite, negative or
  null `sinceId` is omitted, never sent as `since_id=null`.
- `sayAs`: `GET {base}/sayAs` with `api_key`, `channel`, `message`, and
  `from`/`message_type`/`response_code`/`rephrase` when given. Every value goes
  through `URLSearchParams`, never string concatenation.
- `Accept: application/json` on both, same as `weatherClient`.
- `apiKey` empty or whitespace-only → throws `NO_KEY` **before** any fetch, so
  a caller that forgot to check cannot send `api_key=` upstream.
- `sayAs` with `params.message.length > 128` → throws `BAD_BODY` rather than
  truncating. A silently truncated clearance is worse than none; the caller
  (§11) is responsible for fitting it, and this is the assertion that the
  caller did.

### 7.3 Reading a `getCommsHistory` response

1. Transport rejection → `TIMEOUT` if it is an abort (same recursive
   `isAbort(err)` helper `weatherClient` uses, including `err.cause`),
   otherwise `NETWORK`.
2. HTTP 401 or 403 → `BAD_KEY`.
3. Any other non-200 → `BAD_STATUS` with `httpStatus`.
4. Body not parseable as JSON, or not a JSON object → `BAD_BODY`.
5. `comm_history` absent or not an array → **`[]`, not an error.** A key whose
   session has said nothing yet is a normal state.
6. Each entry that is not a plain object, or whose `id` is not a finite number,
   is dropped by the caller (§9.5), not by the client. The client passes
   entries through as it received them.
7. `flight_id`: `String(v)` when it is a non-empty string or a finite number;
   `null` otherwise.
8. Entries are sorted ascending by `id` before returning, so the importer never
   depends on upstream ordering.

### 7.4 Detecting "no active session" on `sayAs`

SayIntentions documents that `sayAs` requires an active flight session and does
not document what it answers when there is none. This is the heuristic, frozen,
with an explicit fallback for anything it does not recognise:

```ts
export const NO_ACTIVE_SESSION_HINTS: readonly string[] = [
  'no active', 'not active', 'inactive',
  'no flight', 'not in flight', 'no session',
  'not connected', 'no aircraft',
];
```

Classification of a `sayAs` response, in order — the first rule that matches wins:

1. Transport rejection → `TIMEOUT` / `NETWORK`, as in §7.3.
2. HTTP 401 or 403 → `BAD_KEY`.
3. **HTTP 404 or 409 → `NO_ACTIVE_SESSION`.** These are the two statuses a
   session-scoped endpoint plausibly uses for "there is no session," and
   neither has another meaning on a route whose path is fixed by us.
4. Any other non-2xx → `BAD_STATUS`.
5. 2xx, body not parseable as JSON → `BAD_BODY`.
6. 2xx JSON carrying an explicit failure marker — `success === false`, or
   `status`/`result` equal (case-insensitively) to `'error'`/`'fail'`/
   `'failed'`, or a non-empty string `error`/`message` field on an object with
   no success marker — then: if the whole body's text, lowercased, contains any
   `NO_ACTIVE_SESSION_HINTS` entry → `NO_ACTIVE_SESSION`; otherwise →
   `BAD_STATUS` with the upstream text as `detail`.
7. 2xx JSON with no failure marker, but whose text contains a hint substring →
   `NO_ACTIVE_SESSION`. (Covers a service that reports the condition in a
   200 body with no status field at all.)
8. **Fallback — anything else 2xx → success.** The docs promise only "a
   confirmation of transmission," so an unrecognised 2xx body must not be
   turned into an error. The raw text is returned in `SayAsResult.rawText`
   (truncated to 500 characters) and stored in the recording row's
   `payload_json` (§10.4), which is how the first real confirmation gets on
   record without anyone having to reproduce it.

`getCommsHistory` never returns `NO_ACTIVE_SESSION`: that endpoint does not
require a session, and a key with nothing to report returns an empty list.

Sample bodies for each branch: `contracts/samples/upstream.sayAs.json`.

### 7.5 What the client must never do

- Never log. Not the URL, not the key, not the response. `weatherClient` logs
  nothing either; errors carry their own detail and the route decides.
- Never put the key, or a URL containing it, into `Error.message`,
  `userMessage`, `detail`, or anything that reaches a response body. The
  `detail` string for a `BAD_STATUS` is `http <status>`; for `BAD_BODY` it is
  `http <status>, first 200 chars: <body excerpt>` — the excerpt is of the
  *response*, which never contains the key.
- Never retry. One call, one outcome. A retry on `sayAs` could put two
  clearances in the pilot's sim.

### 7.6 User messages

One per code, the `USER_MESSAGES` record idiom from `weatherClient.ts`. These
strings are what the routes put in the `error` field, so they are the sentences
the operator actually reads (§8.2):

| Code | `userMessage` |
|---|---|
| `NO_KEY` | No SayIntentions API key is saved. Add one under Prefiles → SayIntentions first. |
| `BAD_KEY` | SayIntentions rejected the saved API key. Check it under Prefiles → SayIntentions. |
| `NETWORK` | Could not reach SayIntentions. Check your internet connection and try again. |
| `TIMEOUT` | SayIntentions did not respond within 10 seconds. Try again in a moment. |
| `BAD_STATUS` | SayIntentions returned an error (HTTP {status}). Try again in a moment. |
| `BAD_BODY` | SayIntentions returned a response this app could not read. |
| `NO_ACTIVE_SESSION` | SayIntentions has no active flight session for this key right now, so the message was not sent. Start the sim with SayIntentions connected and try again. |

---

## 8. Failure modes — the full table

### 8.1 The table

Every row is a non-crashing outcome. `500` appears nowhere in it: it stays
reserved for a genuinely unexpected throw, caught by each route's outer
`try/catch` as `{ error: String(err) }`, exactly as the existing ACARS routes
do.

| # | Condition | Routes | HTTP | Body |
|---|---|---|---|---|
| F1 | No API key saved | R4, R6, R7 | 409 | `{ error: <NO_KEY text>, code: 'NO_API_KEY' }` |
| F2 | Key saved but upstream rejects it (401/403) | R4, R6, R7 | 409 | `{ error: <BAD_KEY text>, code: 'BAD_API_KEY' }` |
| F3 | No session link for this flight | R6 | 409 | `{ error: …, code: 'NOT_LINKED' }` |
| F4 | Link exists, upstream is now a different session | R6 | 409 | `{ error: …, code: 'SESSION_CHANGED' }` |
| F5 | Nothing upstream to link to (no `flight_id` and no comms) | R4 | 409 | `{ error: …, code: 'NO_COMMS_TO_LINK' }` |
| F6 | No active SayIntentions session | R7 | 409 | `{ error: …, code: 'NO_ACTIVE_SESSION' }` |
| F7 | No clearance on file for this leg | R7 | 409 | `{ error: …, code: 'NO_CLEARANCE' }` |
| F8 | Upstream unreachable (`NETWORK`) | R4, R6, R7 | 502 | `{ error: …, code: 'UPSTREAM_UNREACHABLE' }` |
| F9 | Upstream timed out (`TIMEOUT`) | R4, R6, R7 | 504 | `{ error: …, code: 'UPSTREAM_TIMEOUT' }` |
| F10 | Upstream non-2xx (`BAD_STATUS`, incl. 429) | R4, R6, R7 | 502 | `{ error: …, code: 'UPSTREAM_ERROR' }` |
| F11 | Upstream body unreadable (`BAD_BODY`) | R4, R6, R7 | 502 | `{ error: …, code: 'UPSTREAM_BAD_BODY' }` |
| F12 | `:id` not a number | R3–R6 | 400 | `{ error: 'Invalid id', code: 'INVALID_ID' }` |
| F13 | Flight does not exist | R3–R6 | 404 | `{ error: 'Flight {id} not found', code: 'FLIGHT_NOT_FOUND' }` |
| F14 | Planned leg does not exist | R7 | 404 | `{ error: 'Planned leg {legId} not found', code: 'PLANNED_LEG_NOT_FOUND' }` |
| F15 | Malformed key on save | R2 | 400 | `{ error: …, code: 'INVALID_API_KEY' }` |
| F16 | Malformed JSON body | R2 | 400 | `{ error: 'Invalid request body', code: 'INVALID_BODY' }` |

**R5 (`DELETE …/link`) never appears in this table.** Unlinking is a plain
delete, not an operation on SayIntentions — it does not read the saved key,
call `sayIntentionsClient`, or care whether one is set. It always returns 200
`{ unlinked: true }` when a link row existed or `{ unlinked: false }` when it
didn't (§15), independent of F1–F16 entirely.

Exact strings for every one: `contracts/samples/msfslogger.responses.json`.

The `SayIntentionsErrorCode` → HTTP mapping is one shared helper so no route
can disagree with another:

```ts
// src/sayIntentions.ts — owner T-003
export function httpStatusForSayIntentionsError(code: SayIntentionsErrorCode): number;
export function responseCodeForSayIntentionsError(code: SayIntentionsErrorCode): string;
```

`NO_KEY`→409/`NO_API_KEY`, `BAD_KEY`→409/`BAD_API_KEY`,
`NO_ACTIVE_SESSION`→409/`NO_ACTIVE_SESSION`, `NETWORK`→502/`UPSTREAM_UNREACHABLE`,
`TIMEOUT`→504/`UPSTREAM_TIMEOUT`, `BAD_STATUS`→502/`UPSTREAM_ERROR`,
`BAD_BODY`→502/`UPSTREAM_BAD_BODY`.

### 8.2 Why `error` carries the sentence and `code` carries nothing for the UI

`client/src/utils/api.ts`'s `apiFetch` throws `new Error(body.error)` and
**discards `code` entirely**. Every existing page therefore renders the
server's `error` string verbatim (`setSendError((err as Error).message)`).

So: on every route in this design, `error` is a complete, operator-readable
sentence that is safe to render as-is, and `code` exists for logs, tests and
any non-browser client. This is what satisfies "a `NO_ACTIVE_SESSION` response
shows a clear, specific message, not a generic error" (T-010) with no
client-side branching on status codes and no change to `apiFetch`.

`409` rather than `400` for F1–F7 follows the existing ACARS convention:
`src/routes/acars.ts` answers "the stored state does not support what you
asked" with `409 NO_DISPATCH_DATA` / `409 NO_FLIGHT_PLAN`. None of F1–F7 is a
malformed request.

### 8.3 Partial failure during an import

`getCommsHistory` either returns a list or throws; there is no partially-read
response. Row insertion is one `insertAcarsMessageOnce` per row, each in its
own transaction, ordered by ascending upstream id. If an insert throws
mid-list, the route returns `500` and the cursor is **not** advanced (§9.8), so
the next import re-reads the same window and the already-written rows dedup
away. No import can lose a message or write one twice.

---

## 9. Pull — importing comms into the ACARS thread

### 9.1 Routes

All flight-scoped, in a new `src/routes/sayIntentions.ts` mounted at `/api` by
`src/server.ts` immediately after `createAcarsRouter()` and before
`createGroundSessionsRouter()` — before the SPA catch-all, like every other
`/api` router. None takes a request body.

| # | Method | Path | Success |
|---|---|---|---|
| R3 | GET | `/api/flights/:id/sayintentions/link` | 200 `SayIntentionsLinkStatus` |
| R4 | POST | `/api/flights/:id/sayintentions/link[?from=now\|session_start]` | 201 new / 200 re-link, `SayIntentionsLinkResponse` |
| R5 | DELETE | `/api/flights/:id/sayintentions/link` | 200 `{ flight_id, unlinked }` |
| R6 | POST | `/api/flights/:id/sayintentions/import` | 201 when `imported > 0`, else 200, `SayIntentionsImportResponse` |

`from` is read as `typeof req.query.from === 'string' ? req.query.from : ''`;
the literal `'now'` selects that mode and **every other value, including a
missing one, means `session_start`** — an unknown value must not be an error on
a route whose default is the safe one.

R3 is total for an existing flight: it never calls upstream, never 409s, and
answers `{ linked: false, link: null, api_key_set: false }` when no key is
saved. That is what lets the UI decide whether to render the section at all
with one request (§14.2).

### 9.2 What R4 does, step by step

1. Parse `:id`; `NaN` → F12. `getFlightById` → not found → F13.
2. `getSetting(SAYINTENTIONS_API_KEY_SETTING)` → `null` → F1.
3. `await getCommsHistory(apiKey)` — no `since_id`. A `SayIntentionsFetchError`
   maps through §8.1 (F2, F8–F11).
4. If `result.flight_id === null` **and** `result.comm_history.length === 0` →
   F5. There is nothing to bind to and nothing to import; linking would record
   a cursor against a session that does not exist.
5. `baseline = max(comm_history[].id)` or `0`.
6. `upsertSayIntentionsLink({ flight_id, upstream_flight_id: result.flight_id,
   since_id: from === 'now' ? baseline : null, baseline_comm_id: baseline,
   linked_at: now })`.
7. Respond `201` when no row existed before, `200` when one did, with
   `pending_messages = from === 'now' ? 0 : comm_history.length`.

### 9.3 What R6 does, step by step

1. `:id` / flight existence → F12, F13.
2. Key → F1.
3. `getSayIntentionsLink(id)` → `null` → F3.
4. `await getCommsHistory(apiKey, link.since_id)` → F2, F8–F11 on throw.
5. Session-changed guard (§9.4) → possibly F4.
6. Map and insert (§9.5–§9.7).
7. Advance the cursor (§9.8).
8. Respond with `SayIntentionsImportResponse`; `201` when `imported > 0`, `200`
   otherwise. **`imported: 0` is a success**, not an error — "no new messages"
   is the normal outcome of pressing the button twice.

### 9.4 The session-changed guard

If `link.upstream_flight_id !== null` and the response's `flight_id !== null`
and the two differ → **F4, and nothing is imported.**

This is the one check that makes a manual link trustworthy. Without it, an
operator who links a flight on Monday and presses import on Tuesday files
Tuesday's radio calls into Monday's logbook entry, silently. The remedy is in
the error sentence: unlink and link again.

The guard is skipped — import proceeds — when either side is `null`, because a
response that names no session gives nothing to compare and refusing would
block the feature on an undocumented field.

**Backfill, so a `null` at link time doesn't disable the guard forever.** If
`link.upstream_flight_id` is `null` and this import's response carries a
non-null `flight_id`, R6 writes that id into `sayintentions_links` before
returning — `advanceSayIntentionsCursor` takes an `upstreamFlightId: string |
null` argument and applies it as `COALESCE(upstream_flight_id, ?)`, so it only
ever fills an empty slot and never overwrites an id already pinned by an
earlier import. Without this, a link made while `getCommsHistory` happened to
omit `flight_id` (§2.1 already flags this field as unverified) would silently
skip the guard on every import for that flight's lifetime, not just the first
one. Once any import observes a `flight_id`, that becomes the pinned session
for every import after it.

### 9.5 Mapping one `comm_history[]` entry to rows

An entry is a radio *exchange*: it may carry what the station said, what the
cockpit said, or both. So **one entry produces zero, one or two rows**.

Drop the entry entirely (counted in `skipped`) when it is not a plain object,
or `typeof entry.id !== 'number'` / not finite. The id is the dedup key and the
cursor; an entry without one cannot be filed safely.

For each of the two legs:

| Leg | Condition | `direction` | `label` | `body` |
|---|---|---|---|---|
| `out` (cockpit) | `pickText(outgoing_message_english, outgoing_message)` is non-empty | `downlink` | `ident` normalised, else `'CREW'` | that text |
| `in` (station) | `pickText(incoming_message_english, incoming_message)` is non-empty | `uplink` | `station_name` normalised, else `'ATC'` | that text |

- `pickText(a, b)`: the first of `a`, `b` that is a string whose `trim()` is
  non-empty, trimmed; else `null`. The English rendering is preferred because
  the operator reading the logbook is the one who typed the key, and nothing is
  lost — the original text is in `payload_json` either way (§9.6).
- Label normalisation: `trim()`, `toUpperCase()`, collapse whitespace runs to
  one space, `slice(0, 40)`. Empty after that → the fallback.
- Body: clamped to `MAX_ACARS_BODY_LENGTH` (4096, `src/acars.ts`) with a
  trailing `...` if it somehow exceeds it. Newlines are preserved; the column
  never collapses them.
- Both rows of one entry get the same `sent_at` (§9.6). The `out` row is
  inserted first, so the cockpit's transmission reads above the reply under the
  thread's `sent_at ASC, id ASC` ordering.
- An entry where both legs are empty produces no row and counts as `skipped`.

`category` is **`'atc'`** on every imported row — a new category, which needs
no migration (`acars_messages.category` is deliberately not a `CHECK`
constraint, and `isValidAcarsCategory` validates by shape; `'atc'` passes).
`correlation_id` is `null`: the two legs of an exchange are peers, not a
request and its reply, and inventing a correlation would misrepresent what
`correlation_id` means everywhere else in the table.

> **Polarity assumption.** That `incoming_message` is what the station said and
> `outgoing_message` is what the cockpit said is taken from the docs, not from
> a capture (§2.1). It is confined to the table above, which the implementer
> writes as one constant mapping so a reversal is a two-line amendment to this
> section — not a redesign. §19.1.

### 9.6 `payload_json` and `sent_at`

`payload_json` is `JSON.stringify` of `SayIntentionsCommPayload`: `{ v: 1,
source: 'sayintentions', comm_id, leg, entry }`, where `entry` is the upstream
object **verbatim** — every field, including ones this design has never heard
of, and including the non-preferred language variant. That is what makes an
amendment to §9.5 cheap: the data is already on file.

`sent_at` is `comm_history[].stamp_zulu` normalised to an ISO 8601 UTC instant,
by this total rule (prototype: `prototypes/stamp.js`, output below):

1. A finite `number` → epoch; `< 1e12` is seconds and is multiplied by 1000.
2. A `string`: trim. Empty → fallback. If it matches
   `/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(:(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/`,
   replace the separating space with `T` and append `Z` when it carries no zone
   — "zulu" in the field name is the only statement of intent there is, so an
   unzoned stamp is read as UTC. Then `new Date(...)`.
3. Anything else → `new Date(raw)` as-is.
4. An invalid date at any step → the **fallback**, which is the import's own
   `new Date().toISOString()`, passed in by the route so every row of one
   import shares it.

Verified output (`node prototypes/stamp.js`, fallback `2026-09-17T12:00:00.000Z`):

```
"2026-09-17 14:33:12"        ->  2026-09-17T14:33:12.000Z
"2026-09-17T14:33:12"        ->  2026-09-17T14:33:12.000Z
"2026-09-17T14:33:12Z"       ->  2026-09-17T14:33:12.000Z
"2026-09-17T14:33:12.482Z"   ->  2026-09-17T14:33:12.482Z
"2026-09-17 14:33"           ->  2026-09-17T14:33:00.000Z
"2026-09-17T14:33:12+02:00"  ->  2026-09-17T12:33:12.000Z
"17 Sep 2026 14:33:12 GMT"   ->  2026-09-17T14:33:12.000Z
1789654392                   ->  2026-09-17T14:13:12.000Z
1789654392000                ->  2026-09-17T14:13:12.000Z
""  "   "  "not a date"  null  undefined  {…}  NaN   ->  fallback
```

One caveat found by running it under `TZ=America/New_York`: every branch above
is timezone-independent **except** step 3, the unstructured fallthrough —
`'2026/09/17 14:33:12'` resolves to `…T14:33:12Z` under `TZ=UTC` and
`…T18:33:12Z` under New York, because `new Date()` reads an unzoned non-ISO
string as local time. A unit test covering step 3 must pin `TZ` or use a zoned
input. The host running the live server is `TZ=UTC` (checked with `date +%Z`).

### 9.7 The dedup key

```
sayintentions:comm:<flight_id>:<comm_id>:<in|out>
```

e.g. `sayintentions:comm:42:51221:out`.

- It **incorporates SayIntentions' own `comm_history[].id`**, which is what
  makes a repeat import a no-op: `insertAcarsMessageOnce` finds the existing
  row, returns `created: false`, and writes nothing. The partial unique index
  `idx_acars_messages_dedup` is the enforcement, not the convention.
- The `in`/`out` suffix is required because one upstream id can produce two
  rows.
- The flight id is included so the key is scoped to the flight that imported
  it. A global key was considered (§17.5): it would make a mis-link
  unrecoverable, because the correct flight's import would silently find the
  wrong flight's rows already on file and report `already_seen`. With the
  flight id in the key, the remedy for a mis-link is "link the right flight and
  import again," and the operator can delete the wrong rows by deleting nothing
  — they remain, visibly, on the flight they were filed against.

### 9.8 Cursor advance

After the insert loop, and only if it completed:

```
newSince = max(link.since_id ?? 0, max(comm_history[].id seen this call))
```

— computed over **every** entry in the response, including ones that were
skipped or produced no row, so a skipped entry can never make the next import
re-fetch the same window forever. When `comm_history` was empty, the cursor is
left exactly as it was.

`advanceSayIntentionsCursor(flightId, newSince, importedDelta, now)` does the
cursor, `last_import_at` and `imported_count` in one `UPDATE`.

### 9.9 What the thread looks like afterward

Imported rows are ordinary `acars_messages` rows. `GET
/api/flights/:id/acars-messages` returns them inside the existing `AcarsThread`
envelope with **no new top-level field**, interleaved with the flight's WX,
PDC, OOOI and canned messages in `sent_at` order. Nothing about that route
changes.

---

## 10. Push — sending the PDC into the live session

### 10.1 The route

| # | Method | Path | Success |
|---|---|---|---|
| R7 | POST | `/api/planned-legs/:legId/sayintentions/clearance` | 201 `SayIntentionsPushResponse` |

No request body. Lives in the same `src/routes/sayIntentions.ts` as R3–R6.

### 10.2 Why leg-scoped, and why it needs no link

**Leg-scoped**, matching `POST /api/planned-legs/:legId/acars-messages/clearance`
exactly. The clearance being pushed *is* that route's output: it is keyed to the
leg by `clearanceDedupKey(legId)` and derived from the leg's on-file dispatch
release. A flight-scoped twin would have to find the flight's leg first and
would answer differently for a flight with no leg — which is precisely the
flight that has no clearance to push.

This does not cost the flight scope anything: `AcarsMessages.tsx` already
derives `plannedLegId` in the flight scope from the thread envelope, and the
existing REQUEST CLEARANCE button already uses it to call the leg-scoped route.
The push button follows the same rule (§14.3).

**A SayIntentions link is not required.** `sayAs` addresses "whatever session
this key currently holds" and needs no cursor and no correlation; requiring a
link would block the common case of an operator who pushes but never pulls.
Only a saved key is required. (T-010: the button is gated on the key, not on
the link.)

### 10.3 What the route does, step by step

1. Parse `:legId`; `NaN` → F12. `getPlannedLegById` → not found → F14.
2. Key → F1.
3. `findAcarsMessageByDedupKey(clearanceDedupKey(legId))` → the stored PDC
   uplink row. Absent → F7.
4. Parse its `payload_json` into a `ClearanceDetails` with a total,
   never-throwing parser in the shape of `parseDispatchPayload`:
   `parseClearancePayload(raw: string | null): ClearanceDetails | null` —
   requires `v === 1`, takes `departure_icao`/`destination_icao`/`route` as
   `string | null`, `initial_altitude_ft` as a number (non-number → the
   `DEFAULT_INITIAL_ALTITUDE_FT` 5000 already exported by `src/acars.ts`), and
   `squawk` as a string (non-string → `'0000'`). Returns `null` for anything
   else. `null` → F7, same as an absent row: an unreadable clearance is not a
   clearance.
5. `text = buildCondensedClearanceMessage(details)` (§11). By construction
   `text.length <= 128`.
6. `await sayAs(apiKey, { channel: 'ACARS_IN', message: text, from:
   details.departure_icao ?? 'DISPATCH', messageType: 'cpdlc', rephrase: 0 })`.
   A `SayIntentionsFetchError` maps through §8.1 — F2, F6, F8–F11. **Nothing is
   written to `acars_messages` on any of those paths**, so a failed send never
   leaves a row claiming a clearance was delivered.
7. On success, record the send (§10.4) and answer `201`.

`rephrase: 0` is load-bearing and not a default to be left implicit: an AI
rewording of a clearance could change a squawk or an altitude, and this message
exists precisely to carry exact numbers.

### 10.4 Recording the send

A **new `acars_messages` row**, not an update to the existing PDC row.

| Column | Value |
|---|---|
| `planned_leg_id` | `legId` (`flight_id` null) |
| `direction` | `'uplink'` — the content is dispatch speaking to the aircraft |
| `category` | `'pdc'` — same category as the clearance it delivers, so it keeps the existing badge and needs no CSS |
| `label` | `'PDC SENT'` |
| `body` | the exact condensed text that was sent |
| `payload_json` | `SayIntentionsPushPayload` (§3.1) including `upstream_excerpt` |
| `correlation_id` | the stored PDC uplink row's `id` |
| `dedup_key` | `null` |
| `sent_at` | now |

Why a new row rather than mutating the PDC row's `payload_json`:

- The PDC row is the clearance. This row is the event of delivering it. They
  have different timestamps, and the thread is a chronological record.
- `acars_messages` is append-only everywhere else in this app. Nothing in
  `src/db/acarsMessages.ts` updates a row, and this design does not add the
  first `UPDATE`.
- The operator's question is "what exactly did I send into the sim?" — `body`
  answers it directly, in the thread, without opening a payload.

`dedup_key` is `null` deliberately: **a repeat send is allowed and files a
second row**, the same choice the WX route makes ("a request about *right now*,
so repeating it is meaningful"). A pilot whose first uplink was missed in the
sim must be able to press it again, and two rows is the honest record of two
sends.

---

## 11. Condensed ACARS_IN message — the algorithm

### 11.1 Why not `buildClearanceBody`

`buildClearanceBody` (`src/acars.ts`) emits six lines including `CLEARED VIA
<route>` with the route clamped at `MAX_ROUTE_BODY_CHARS = 900`, plus the
`SIMULATED CLEARANCE - NOT FOR REAL WORLD USE` line — well over 128 characters
for any real route, and multi-line where `ACARS_IN` takes one. It is also
already stored and already read by the UI; it must not change (§18).

So: a **new, additive** pure function beside it, in the same file, with the
same no-clock/no-database discipline:

```ts
// src/acars.ts — owner T-009
export const MAX_ACARS_IN_CHARS = 128;
export function buildCondensedClearanceMessage(details: ClearanceDetails): string;
```

The disclaimer line is dropped, and that is a decision, not an oversight: the
recipient is a flight-simulator ATC service inside a flight simulator, where
every message is simulated by construction, and 128 characters spent on a
disclaimer is 128 characters not spent on the route. §17.6.

### 11.2 The algorithm

```
head  = `PDC ${dep} ${dst} CLRD `        dep/dst = ICAO trimmed+uppercased, or '????'
tail  = ` CLB ${levelText(initial_altitude_ft)} SQ ${squawk}`
budget = 128 - head.length - tail.length
```

`levelText` is the existing exported helper in `src/acars.ts`, reused
unchanged, so the condensed message and the full body cannot disagree about how
an altitude reads (`FL280` at or above 18 000 ft, `5000FT` below).

Route text:

1. Normalise: replace every character outside `\x20-\x7E` with a space,
   uppercase, collapse whitespace runs to one space, trim. Empty result → `null`.
2. `null`, or the literal `'NIL'` that `clampRoute` already produces for a
   route-less leg → `routeText = 'NIL'`.
3. `budget < 5` → `routeText = 'NIL'` (defensive; unreachable with 4-character
   ICAOs).
4. Otherwise `clipRouteToBudget(routeText.split(' '), budget)`:
   a. The whole route fits the budget → use it.
   b. Otherwise, if the first token plus `' .. ' + lastToken` fits: keep adding
      whole tokens from the front while `head-so-far + ' .. ' + lastToken`
      stays within budget, then append `' .. ' + lastToken`. **The first fixes
      and the last fix survive** — the departure transition and the arrival
      transition are the two parts of a route a clearance readback is actually
      about.
   c. Otherwise (one enormous token, or a last token too long to preserve):
      hard character clip — `whole.slice(0, budget - 2).trimEnd() + '..'`.
5. `message = head + routeText + tail`; as a final invariant, if it is somehow
   longer than 128 it is sliced to 128. That last line is what makes "never
   returns more than 128 characters for any input" true by construction rather
   than by argument.

### 11.3 Worked examples — real output

Produced by `node .claude/runs/2026-09-17-sayintentions-integration/prototypes/condense.js`.
`buildCondensedClearanceMessage` must reproduce these byte for byte; they are
T-009's test vectors.

**A — short route, fits whole** (`KSFO`→`KLAX`, `SSTIK3 BSR Q13 RZS KWANG2`,
5000 ft, squawk 2451) — **63 chars**:

```
PDC KSFO KLAX CLRD SSTIK3 BSR Q13 RZS KWANG2 CLB 5000FT SQ 2451
```

**B — long route, clipped** (`EGLL`→`LFPG`, a 142-character Eurocontrol-shaped
route, 5000 ft, squawk 5123) — **127 chars**:

```
PDC EGLL LFPG CLRD DET2F DET L6 DVR UL9 KONAN UL607 SPI UZ739 PIGOS UN872 LUMEN UM605 TANGO UP600 .. RANUX6A CLB 5000FT SQ 5123
```

Input route:
`DET2F DET L6 DVR UL9 KONAN UL607 SPI UZ739 PIGOS UN872 LUMEN UM605 TANGO UP600 REVTU UL610 SITET UN862 BIBAX UM728 OKRIX UY111 LORKU RANUX6A`

**C — `route === null`** (`SBGR`→`SBRJ`, 4000 ft, squawk 0361) — **41 chars**:

```
PDC SBGR SBRJ CLRD NIL CLB 4000FT SQ 0361
```

Three more boundary cases, same run:

| Case | Output | Len |
|---|---|---|
| D — route is the literal `'NIL'` `clampRoute` emits | `PDC SBGR SBRJ CLRD NIL CLB 4000FT SQ 0361` | 41 |
| E — both ICAOs null, 18 000 ft | `PDC ???? ???? CLRD DCT CLB FL180 SQ 7401` | 40 |
| F — one 400-character token, no spaces | `PDC KJFK EGLL CLRD XXXX…XXXX.. CLB 5000FT SQ 1234` | 128 |
| G — a 900-character route at `clampRoute`'s own ceiling | `PDC KJFK EGLL CLRD WAYPT ABCDE FIXES UN123 WAYPT ABCDE FIXES UN123 WAYPT ABCDE FIXES UN123 WAYPT .. UN123... CLB 5000FT SQ 1234` | 127 |

And the boundary sweep in the same script — 1 802 generated routes from 0 to
900 tokens, with and without separators, at a fixed head/tail:

```
boundary sweep: 1802 routes, longest output 128 chars, cap 128
```

Never over. Case F shows the cap is reachable exactly, which is why step 5's
final slice is written as `<=`, not `<`.

---

## 12. Trigger — why both halves are buttons and neither is a poll

**Pull: operator-initiated button.** Three reasons, in order of weight. First,
the link is already a manual act the user has accepted; a poll would still need
the operator to press LINK first, so polling buys a fraction of the
interaction, not the whole of it. Second, this codebase has exactly one
background timer — the six-hourly `sessionSweep` in `src/index.ts` — and there
is no scheduler; adding a poll means adding a timer to `src/index.ts`, which is
in **no** implementer task's `allowed_paths` in this plan, and means deciding
what happens when it fires for a flight whose link points at a stale session,
with no operator present to read the error. Third, and decisively: every poll
tick spends the operator's API key against a preview-status third-party service
with no documented rate limits (`sayintentions-api-notes.md` §4). A button
spends it when the operator asks and never otherwise.

Import is incremental (§9.8), so pressing it repeatedly is cheap and safe:
`since_id` means the second press transfers only what is new, and the dedup key
means even a re-read window writes nothing.

**Push: operator-initiated button.** A push has a side effect *inside the
pilot's simulator*. Nothing should put a message on a pilot's ACARS screen
except the pilot asking for it — an automatic push on clearance generation
would fire while they are still on the ground planning, possibly with
SayIntentions not running, and `sayAs` cannot be undone.

Neither decision forecloses a poll later: R6 is idempotent and cursor-driven,
which is exactly the shape a future scheduler would call.

---

## 13. Ingest-token scope — per route

**Superseded — see the amendment in §1.** The original freeze said no route
here would be token-scoped, since MCDU coordination was out of scope for
this run. That premise changed: the operator confirmed the intended
architecture explicitly while coordinating with the MCDU session — the
server is the only thing that ever talks to SayIntentions directly (already
true), and the MCDU is meant to be a full interface to this feature through
the server, the same way it already fully drives the existing ACARS thread
(`flight-acars-read/post/wx` and the planned-leg twins, plus
`planned-leg-acars-loadsheet`/`clearance`, are all already token-scoped).

**Current freeze: R1, R3, R4, R5, R6, R7 are added to
`INGEST_SCOPED_ROUTES`. R2 is not, and stays not.** One line survives
unchanged: *"the allow-list contains no route that writes a credential and
must not start."* Entering/changing the key stays Prefiles-only, mirroring
the existing precedent that `settings-simbrief-read` is scoped while its
`PUT` is not.

The original per-route reasoning below explains why the default was
conservative; it is no longer the freeze for R1/R3–R7. Updated per-route
reasoning:

- **R1** — yes: the MCDU needs to know a key is set before rendering any
  SayIntentions control, same reason `settings-simbrief-read` is scoped.
- **R2** — no, unchanged: writing the credential is Prefiles-only.
- **R3–R5 (link status/link/unlink)** — yes: the MCDU is the interface: show
  link state, let the operator establish or clear it, same trust level
  already extended to `flight-acars-post` and `planned-leg-acars-clearance`.
- **R6 (import)** — yes: spends the key on an upstream call, but that is the
  authority the operator granted by saving the key — `planned-leg-acars-wx`/
  `clearance` already establish a token client may trigger a spend on the
  operator's behalf.
- **R7 (push)** — yes: its sibling `planned-leg-acars-clearance` is scoped,
  and "press it in the cockpit" is exactly the confirmed workflow.

Original per-route "no" reasoning, kept for the record:

- **R1 `GET /api/settings/sayintentions`** — no. The precedent points the other
  way (`settings-simbrief-read` *is* scoped), but that entry exists because the
  MCDU client imports SimBrief plans and needs the ID. Nothing in the MCDU
  consumes a SayIntentions key state today, and every entry on that list widens
  what a leaked ingest token reaches.
- **R2 `PUT /api/settings/sayintentions`** — no, categorically. The allow-list
  contains no route that writes a credential and must not start.
- **R3–R5 (link status, link, unlink)** — no. Linking is a deliberate operator
  decision made while looking at a specific flight; the MCDU has no UI for it
  and no way to show the operator which session they just bound.
- **R6 `POST …/import`** — no. It spends the operator's SayIntentions key on an
  upstream call. The existing scoped write routes (`…/acars-messages/wx`,
  `…/clearance`) spend nothing but local computation and a keyless public
  weather API; this is a different class of authority to hand a shared secret
  held on a Windows box.
- **R7 `POST …/sayintentions/clearance`** — no, and this is the closest call.
  Its sibling `planned-leg-acars-clearance` *is* scoped, and "press it on the
  MCDU in the cockpit" is a real workflow. It is still no for this run: MCDU
  coordination is explicitly out of scope (intake.md), shipping token-reachable
  surface that no client calls is dead surface with a security cost, and a
  replayed token here would both spend the key and inject text into the
  operator's live sim session.

**Current freeze — the exact entries to add**, in the same order as R1–R7
above, following `INGEST_SCOPED_ROUTES`'s existing naming convention exactly
(`<resource>-<action>`, hyphenated, no `sayintentions-` prefix stutter since
the existing list doesn't prefix `acars-` entries with their router name
either):

```ts
{ method: 'GET', pattern: /^\/api\/settings\/sayintentions$/, name: 'settings-sayintentions-read' },
{ method: 'GET', pattern: /^\/api\/flights\/[^/]+\/sayintentions\/link$/, name: 'flight-sayintentions-link-read' },
{ method: 'POST', pattern: /^\/api\/flights\/[^/]+\/sayintentions\/link$/, name: 'flight-sayintentions-link' },
{ method: 'DELETE', pattern: /^\/api\/flights\/[^/]+\/sayintentions\/link$/, name: 'flight-sayintentions-unlink' },
{ method: 'POST', pattern: /^\/api\/flights\/[^/]+\/sayintentions\/import$/, name: 'flight-sayintentions-import' },
{ method: 'POST', pattern: /^\/api\/planned-legs\/[^/]+\/sayintentions\/clearance$/, name: 'planned-leg-sayintentions-push' },
```

**One structural change beyond adding rows: `INGEST_SCOPED_ROUTES`'s own
type must widen.** Its `method` field is currently typed
`'GET' | 'POST'` (`src/auth/ingestScope.ts`) — nothing existing needs
`DELETE`, but R5 does. Widen the union to `'GET' | 'POST' | 'DELETE'` on the
exported `INGEST_SCOPED_ROUTES` array's type annotation; `isIngestScopedRoute`
and `ingestScopeOf` take no other change, since they already compare
`route.method === method` generically rather than switching on specific
values.

`tests/ingestScope.test.ts` gains one table-driven case per new entry
(6 routes × in-scope/off-list-neighbor, following the file's existing
pattern exactly) plus one case proving a `DELETE` to an *unlisted* path still
returns `false` — the widened union must not accidentally make every
`DELETE` route method-eligible.

---

## 14. Frontend — what each page does

Shared rules for all three client tasks:

- No new CSS. `client/src/index.css` is in no task's `allowed_paths`, so every
  element reuses an existing class: `notes-section`, `section-title`,
  `acars-send`, `btn btn-ghost`, `btn btn-primary`, `flight-plan-upload`,
  `flight-plan-status`, `edit-error`, `simbrief-id-label`,
  `simbrief-id-input`, `simbrief-import-section`. Reusing a `simbrief-`
  prefixed class for a SayIntentions block is mildly ugly and is the right
  trade against a CSS change no reviewer can see rendered.
- Every SayIntentions fetch failure is **swallowed into "section not
  available"**, never a page error — the same posture as the canned-messages
  fetch in `AcarsMessages.tsx` today. This matters concretely: an unmatched
  `/api` path falls through to the SPA catch-all and returns `index.html` with
  status 200, so a client running against an older server gets an HTML body and
  `res.json()` throws. A swallowed failure keeps the rest of the page working.
- `UnauthorizedError` is always re-thrown / returned early, never rendered, so
  the session bounce still happens.

### 14.1 Prefiles page — the key field (T-004)

A new block in `client/src/pages/Prefiles.tsx`, directly after the existing
`simbrief-import-section` div, titled **SayIntentions**.

State, copying the `simbriefUserId` quartet name for name:
`sayintentionsApiKey` (string), `sayintentionsSaved`
(`SayIntentionsSettings | undefined`, `undefined` = still loading),
`sayintentionsSaving` (boolean), `sayintentionsSettingsError` (string).

- On mount: `apiFetch<SayIntentionsSettings>('/api/settings/sayintentions')` →
  set `sayintentionsSaved`. Failure → `sayintentionsSettingsError`.
- Input: `<input type="password">`, `id="prefiles-sayintentions-api-key"`,
  label *"SayIntentions API Key"*. `type="password"` is the masking: **the
  stored key is never put into the input's value**, because the server never
  sends it (§4.3). The input starts empty even when a key is saved.
- Next to it, the saved state as text: *"Saved: si_1…9f2c"* from
  `sayintentions_api_key_masked`, or *"No key saved"*.
- **Save** button — enabled when the input is non-empty and not saving. `PUT`
  with `{ sayintentions_api_key: value.trim() }`; on success set
  `sayintentionsSaved` from the response and clear the input; on failure set
  the error and leave the input alone so the operator can fix it.
- **Clear** button — rendered only when `sayintentions_api_key_set`. `PUT` with
  `{ sayintentions_api_key: null }`.
- A one-line hint: *"Optional. Enables importing SayIntentions comms into a
  flight's ACARS thread and sending a PDC into your live session."*

Nothing else on the page changes. The SimBrief block's markup, state and
behaviour are untouched.

### 14.2 ACARS page — link and import (T-007)

A new `notes-section` in `client/src/pages/AcarsMessages.tsx`, between **Send**
and **Thread**, titled **SayIntentions**.

Visibility:

- **`scope === 'planned-leg'`** → the link/import controls are not rendered at
  all (§5.1). The push button (§14.3) is, subject to its own gate.
- **`scope === 'flight'`** → on mount, alongside the existing thread and
  canned-message fetches, `apiFetch<SayIntentionsLinkStatus>(
  '/api/flights/' + id + '/sayintentions/link')`, failure swallowed to `null`.
  `api_key_set === false` or the fetch failed → render nothing but a single
  muted line: *"SayIntentions: no API key saved (Prefiles → SayIntentions)."*
  Never a broken control.

Controls, all using the existing `sendingId` sentinel pattern — new constants
beside `LOADSHEET_SENDING_ID`/`CLEARANCE_SENDING_ID`/`WX_SENDING_ID`:

```ts
const SI_LINK_SENDING_ID = 'si-link';
const SI_UNLINK_SENDING_ID = 'si-unlink';
const SI_IMPORT_SENDING_ID = 'si-import';
const SI_PUSH_SENDING_ID = 'si-push';   // T-010
```

- **LINK SAYINTENTIONS** — `POST …/sayintentions/link`. Shown when not linked.
  On success, store the returned link and show *"Linked to SayIntentions
  session {upstream_flight_id ?? 'current'} — {pending_messages} messages
  waiting."*
- **RELINK** / **UNLINK** — shown when linked. `POST` again / `DELETE`.
- **IMPORT SAYINTENTIONS COMMS** — enabled only when linked. `POST
  …/sayintentions/import`. On success merge `response.messages` into the thread
  **by id**, then re-sort by `(sent_at, id)` — the load sheet's merge idiom, not
  a plain append, so a future overlapping window cannot collide on React keys.
  Status line: *"Imported {imported} message(s)."*, or, when `imported === 0`,
  *"No new messages."* — **an outcome, not an error**.
- Linked state line, always visible when linked: *"Linked · last import
  {last_import_at formatted, or 'never'} · {imported_count} imported."*

Errors from any of the three go to the existing `sendError` state and render in
the existing `edit-error` paragraph, verbatim from the server (§8.2).

`KNOWN_CATEGORIES` is **not** extended with `'atc'`. That array exists to pick
a badge class, and `badge-acars-atc` has no rule in `client/src/index.css`,
which this task may not edit; the documented fallback (`categoryClass` →
`'other'`, `.badge-acars-other` exists) renders imported rows correctly in the
neutral badge. Adding the colour is a one-line CSS follow-up, not this task's
job. Imported rows otherwise render through the unchanged `AcarsRow`.

### 14.3 ACARS page — the push button (T-010)

**SEND TO SAYINTENTIONS**, rendered in the Send block next to REQUEST
CLEARANCE, in **both** scopes.

Enabled when all of: a SayIntentions key is saved; `plannedLegId !== null`; a
PDC uplink row already exists in the loaded thread (`messages.some(m =>
m.category === 'pdc' && m.direction === 'uplink' && m.label === 'PDC')`);
`sendingId === null`. Otherwise disabled with a `title` saying which of those is
missing — the same affordance REQUEST CLEARANCE already uses for "No planned leg
linked to this flight".

"A key is saved" in the planned-leg scope, where there is no link-status fetch,
comes from a `GET /api/settings/sayintentions` the page issues on mount in both
scopes (cheap, local, no upstream call, failure swallowed to "no key").

`POST /api/planned-legs/{plannedLegId}/sayintentions/clearance`, no body. On
success: append `response.message` to the thread (a brand-new row every time,
so a plain append is correct — the WX idiom, not the load sheet's merge) and
show *"Sent to SayIntentions: {sent_text}"* in the status line, so the operator
sees the exact 128-character text that went into the sim.

On failure, render `(err as Error).message` in `sendError` — which for a
`409 NO_ACTIVE_SESSION` is already the specific sentence *"SayIntentions has no
active flight session for this key right now, so the message was not sent.
Start the sim with SayIntentions connected and try again."*, distinguishable
from a real failure without the client branching on a status (§8.2).

---

## 15. Default-off guarantee

`getSetting(SAYINTENTIONS_API_KEY_SETTING) === null` is the whole switch. With
no key ever saved:

| Surface | Behaviour |
|---|---|
| R1 `GET /api/settings/sayintentions` | 200 `{ set: false, masked: null }`. No upstream call. |
| R3 `GET …/sayintentions/link` | 200 `{ linked: false, link: null, api_key_set: false }`. No upstream call. |
| R4, R6, R7 | 409 `NO_API_KEY` **before** any upstream call, any database write, or any use of `sayIntentionsClient` |
| R5 `DELETE …/link` | 200 `{ unlinked: false }` — no key was ever saved, so no link was ever created for this flight either; deleting a link that doesn't exist is not an error (§8.1's note on R5) |
| Prefiles page | One extra section with an empty password box |
| ACARS page | One muted line; no buttons, no upstream calls, no errors |
| `sayintentions_links` table | Exists, empty, referenced by nothing |
| Everything else | Unchanged — see §18 |

No route outside `src/routes/settings.ts` and `src/routes/sayIntentions.ts`
reads the setting; `grep` for `SAYINTENTIONS_API_KEY_SETTING` must find it in
those two files, `src/sayIntentions.ts`, `src/inspect-sayintentions.ts` and the
tests, and nowhere else. `src/flightManager.ts`, `src/ingest.ts`,
`src/acarsEvents.ts` and every existing router are untouched by the feature
flag because none of them knows it exists.

---

## 16. Per-task frozen contracts

Each block below is everything that task implements, verbatim. A task that
needs something not in its block should stop and ask, not invent.

### 16.1 T-003 — settings, link storage, HTTP client (backend_sr)

Files: `src/sayIntentions.ts` (new), `src/sayIntentionsClient.ts` (new),
`src/inspect-sayintentions.ts` (new), `src/db/sayIntentionsLinks.ts` (new),
`src/db/schema.ts`, `src/routes/settings.ts`, `src/types.ts`,
`tests/sayIntentionsClient.test.ts`, `tests/sayIntentions.test.ts`.

Implement, exactly:

- §4.1 `SAYINTENTIONS_API_KEY_SETTING = 'sayintentions_api_key'` in
  `src/sayIntentions.ts`, and the `app_setting` DDL comment replacement quoted
  in §4.1 — the only edit to an existing line of `src/db/schema.ts` besides the
  new table.
- §4.2 `validateSayIntentionsApiKey`, §4.3 `maskApiKey`.
- §4.4 routes R1 and R2 in `src/routes/settings.ts`.
- §6 the `CREATE TABLE IF NOT EXISTS sayintentions_links` from
  `contracts/schema.sql`, at the placement that file names.
- §6.3 `src/db/sayIntentionsLinks.ts` per
  `contracts/sayIntentionsLinks.stub.ts`. Imported by path; `src/db.ts` is not
  touched.
- §7 all of `src/sayIntentionsClient.ts` per
  `contracts/sayIntentionsClient.stub.ts`, including the §7.4 classifier and
  `NO_ACTIVE_SESSION_HINTS`.
- §8.1 `httpStatusForSayIntentionsError` / `responseCodeForSayIntentionsError`
  in `src/sayIntentions.ts` (the routes in T-006/T-009 import them).
- `src/types.ts`: `SayIntentionsSettings` only (§3.1 row 1).

`src/inspect-sayintentions.ts`, following `src/inspect-weather.ts`: reads the
key from `process.env.SAYINTENTIONS_API_KEY` (**never** from the database, so
the inspector cannot touch the live file), `--comms [sinceId]` prints the
parsed `CommsHistoryResult` plus the first entry **raw**, `--say "<text>"`
sends a test message. One-line, non-stack-trace errors. Its raw-entry dump is
how §9.5's polarity assumption and §7.4's confirmation shape get verified —
that output belongs in T-003's report and, if it disagrees with this document,
in §1 as an amendment.

Tests: hermetic, `fetchImpl` injected per call exactly as
`tests/weatherClient.test.ts` does; no real network. Cover a successful
`getCommsHistory`, a successful `sayAs`, and every `SayIntentionsErrorCode`
from its stubbed trigger — including all four `NO_ACTIVE_SESSION` paths in §7.4
(404, 409, body hint with a failure marker, body hint without one) and the §7.4
step-8 fallback resolving as success.

Must not: change any existing route's response, import `./db` or `express` into
`src/sayIntentionsClient.ts`, add a cache, or reference the new setting from
any file not listed above.

### 16.2 T-004 — the key field on Prefiles (frontend_jr)

Files: `client/src/pages/Prefiles.tsx`, `client/src/pages/Prefiles.test.tsx`
(new), `client/src/types.ts`.

Implement §14.1 exactly, and add to `client/src/types.ts`:

```ts
/** GET and PUT /api/settings/sayintentions. The key itself is never returned. */
export interface SayIntentionsSettings {
  sayintentions_api_key_set: boolean;
  sayintentions_api_key_masked: string | null;
}
```

Request/response bodies: `contracts/samples/msfslogger.responses.json`, the
four `…/settings/sayintentions` entries. Tests per
`client/src/pages/TripDetail.test.tsx`'s `mockFetchRoutes`/`renderWithProviders`
pattern: empty when `set: false`; masked value shown when `set: true`; saving
shows a saving state then the echoed masked value; a `PUT` 400 renders the
error without crashing.

Note the deviation from T-004's acceptance criterion as written: it assumes the
GET returns the key and asks the *client* to mask it. Per §4.3 the server never
returns the key, so the client has nothing to mask — `type="password"` plus the
server's masked string is the whole of it.

### 16.3 T-006 — the pull routes (backend_sr)

Files: `src/routes/sayIntentions.ts` (new), `src/sayIntentions.ts`,
`src/server.ts`, `src/types.ts`, `tests/sayIntentions.test.ts`.

Implement §9 in full: routes R3–R6 at the exact paths in §9.1, the step
sequences in §9.2–§9.3, the guard in §9.4, the mapping in §9.5, the payload and
timestamp rules in §9.6, the dedup key in §9.7, the cursor rule in §9.8, and
every applicable row of §8.1.

`src/server.ts` gains exactly one line —
`app.use('/api', createSayIntentionsRouter());` — after
`app.use('/api', createAcarsRouter());` and before the ground-sessions mount,
plus its import. No other change to that file; in particular the SyntaxError
handler needs no new path, because no route here takes a body.

`src/types.ts` gains the §3.1 T-006 row of types.

`src/auth/ingestScope.ts` and `tests/ingestScope.test.ts`: **not touched**
(§13).

Pure helpers — `commHistoryDedupKey(flightId, commId, leg)`,
`normaliseStampZulu(raw, fallbackIso)`, `mapCommEntryToRows(entry, flightId,
fallbackIso)`, `pickText` — live in `src/sayIntentions.ts` with no database and
no network, so `tests/sayIntentions.test.ts` can test them directly the way
`tests/acars.test.ts` tests `src/acars.ts`.

Route tests stub `sayIntentionsClient`; no test makes a real call.

### 16.4 T-007 — link and import UI (frontend_sr)

Files: `client/src/pages/AcarsMessages.tsx`,
`client/src/pages/AcarsMessages.test.tsx` (new), `client/src/types.ts`.

Implement §14.2 exactly. Add the §3.1 T-007 mirror types. Response bodies:
`contracts/samples/msfslogger.responses.json`, the `…/sayintentions/link` and
`…/sayintentions/import` entries.

`KNOWN_CATEGORIES` is **not** extended — §14.2 says why, and that overrides
T-007's conditional acceptance criterion about extending it.

### 16.5 T-009 — the push route (backend_sr)

Files: `src/acars.ts`, `src/sayIntentions.ts`, `src/routes/sayIntentions.ts`,
`src/types.ts`, `tests/acars.test.ts`, `tests/sayIntentions.test.ts`.

Implement §11's `MAX_ACARS_IN_CHARS` and `buildCondensedClearanceMessage` in
`src/acars.ts` (purely additive — `buildClearanceBody`, `buildClearanceDetails`
and `clampRoute` are not touched), §10's route R7, and `parseClearancePayload`
per §10.3 step 4.

`tests/acars.test.ts` asserts all seven vectors in §11.3 byte for byte, plus a
boundary test proving no input produces more than 128 characters (the sweep in
`prototypes/condense.js` is the model).

`src/types.ts` gains the §3.1 T-009 row.

### 16.6 T-010 — the push button (frontend_jr)

Files: `client/src/pages/AcarsMessages.tsx`,
`client/src/pages/AcarsMessages.test.tsx`, `client/src/types.ts`.

Implement §14.3 exactly. The button is gated on a saved key and an existing PDC
row, **not** on a SayIntentions link (§10.2). Add the §3.1 T-010 mirror type.

---

## 17. Alternatives considered

### 17.1 Where the API key lives

- **`app_setting` via `getSetting`/`setSetting` — chosen.** Zero new
  mechanism, the operator already manages settings there, and clearing is
  `setSetting(name, null)`.
- *A new `sayintentions_config` table* — rejected: one row, one column, and a
  second settings mechanism to keep in sync with the first.
- *`app_secret`* — rejected: that table is explicitly for values the server
  generates and the operator never sees. This is the opposite.
- *An environment variable* — rejected: `src/config.ts`'s `ENV_VARS` is scoped
  to configuration the app's security depends on, and a key the operator must
  be able to change from the UI does not belong to a restart-required surface.

Cost of the choice: `app_setting`'s "nothing here is a credential" comment
becomes false and must be rewritten (§4.1). That is a comment edit, and the
masked-read rule in §4.3 is what keeps the underlying concern addressed.

### 17.2 Where the link lives

Covered in §6.2 — a table over composite `app_setting` keys, for the foreign
key, the single-statement cursor update and the typed columns.

### 17.3 What is linkable

- **Flight — chosen** (§5.1).
- *Planned leg* — rejected: optional on most flights, and it would file one
  session's comms into whatever flight later linked to that leg.
- *Trip* — rejected: a trip is many flights; a SayIntentions session is one.
- *Both flight and leg, like WX* — rejected: two scopes make the dedup key
  ambiguous (§9.7) and let one upstream message be claimed twice.

### 17.4 Automatic correlation instead of a manual link

Matching on callsign, aircraft type, departure ICAO or a time window was
considered and rejected. None of them is reliable — SayIntentions' `ident` is
free text the pilot sets, and a msfslogger flight may have no leg, no flight
number and no filed route — and the failure mode is silent and permanent:
another flight's radio calls, filed into this flight's logbook, with nothing to
show they do not belong. The user has already accepted an explicit step; this
design spends it on something visible and reversible.

### 17.5 Dedup key with or without the flight id

- **`sayintentions:comm:<flight_id>:<comm_id>:<in|out>` — chosen.** Idempotent
  per flight, which is the actual requirement, and a mis-link is recoverable by
  linking the right flight and importing again.
- *Global `sayintentions:comm:<comm_id>`* — rejected: it makes "this message
  exists exactly once in the database" true, which sounds stronger, but it
  makes a mis-link unrecoverable — the correct flight's import would find the
  rows already on file, report `already_seen`, and write nothing, with no
  obvious explanation for the operator.

### 17.6 What goes in the 128 characters

- **`PDC DEP DST CLRD <route> CLB <level> SQ <squawk>` — chosen.** Every field
  of `ClearanceDetails` survives; the route absorbs all the pressure.
- *Keep the `SIMULATED CLEARANCE` disclaimer* — rejected: the recipient is a
  simulator's ATC client, where nothing is real by construction, and the
  disclaimer would cost about a third of the budget.
- *Drop the route when it does not fit, rather than clip* — rejected: a
  clearance with no route is much less useful than one with its first and last
  fixes.
- *Clip the route's head instead of its tail* — rejected: the departure
  transition is the part that matters on the ground, which is when a PDC is
  read.
- *Multiple chained `sayAs` calls to carry a long route* — rejected: two
  messages arriving out of order in the sim is worse than one clipped one, and
  retry semantics on a fire-and-forget API make partial delivery unrecoverable.

### 17.7 Recording the push

- **A new `acars_messages` row — chosen** (§10.4).
- *Update the existing PDC row's `payload_json`* — rejected: `acars_messages`
  is append-only everywhere else in this app, and the send is a different event
  at a different time from the clearance.
- *Record nothing* — rejected: the operator's first question after pressing the
  button is "what exactly did it send?"

### 17.8 Import trigger

Covered in §12 — button over poll, mainly because a poll would need a timer in
`src/index.ts` (in no task's `allowed_paths`), would spend the key
unattended against a preview-status API, and would still need the manual link
first.

---

## 18. Must-not-change list

Each line is a claim the Reviewer can check against the named file.

1. **`acars_messages`' twelve columns, their types and their DDL** — no
   addition, no widening, no `CHECK`. Only new *rows*, with a new `category`
   value the column already permits.
2. **`insertAcarsMessage` / `insertAcarsMessageOnce` signatures and behaviour**
   (`src/db/acarsMessages.ts`) — both are called as they are; neither is
   edited.
3. **`GET /api/flights/:id/acars-messages` and `GET
   /api/planned-legs/:legId/acars-messages`** — same `AcarsThread` /
   `PlannedLegAcarsThread` envelope, same fields, no new top-level key.
   Imported and push rows arrive inside `messages[]`, nowhere else.
4. **`buildClearanceBody`, `buildClearanceDetails`, `clampRoute`,
   `deriveInitialAltitudeFt`, `squawkForLeg`, `levelText`, `MAX_ROUTE_BODY_CHARS`,
   `MAX_ACARS_BODY_LENGTH`** (`src/acars.ts`) — read and reused, never edited.
   §11 adds a function beside them.
5. **`POST /api/planned-legs/:legId/acars-messages/clearance`** — its
   idempotency, its `201`/`200` split, its `ClearanceRequestResponse` shape and
   its stored rows are untouched. The push route reads what it wrote.
6. **`/api/settings/simbrief` (GET and PUT)** and `SIMBRIEF_USER_ID_SETTING` —
   byte-identical behaviour. A `curl` diff against a pre-change scratch server
   must show no difference.
7. **`src/weatherClient.ts`** — not edited. The new client copies its shape; it
   does not refactor a shared base out of it.
8. ~~`src/auth/ingestScope.ts`'s `INGEST_SCOPED_ROUTES` — unchanged, entry
   for entry.~~ **Superseded by amendment #3 (§1, §13).** R1, R3–R7 are now
   on the list (R2 stays off — that half of this guarantee still holds).
   What's still true, unamended: no *existing* entry (the original 13) was
   reordered, edited or removed — only appended to, and the `method` type
   widened to add `DELETE`.
9. **`src/server.ts`** — exactly one router mount and its import added.
   Middleware order, the session config, `requireAuth`/`requireSameOrigin`
   placement, the `/api/status` body and the SyntaxError handler's path list
   are all unchanged.
10. **`src/index.ts`** — not edited. No new timer, no new startup step.
11. **`src/db.ts`** — not edited. The new db module is imported by path.
12. **`flights`, `planned_legs`, `trips`, `app_setting`, `app_secret`,
    `auth_*`, `ground_sessions`, `flight_points`** — no DDL change of any kind.
    The only edit to `src/db/schema.ts` beyond the new `CREATE TABLE` is the
    comment in §4.1.
13. **Every existing page in `client/src/pages/`** other than `Prefiles.tsx`
    and `AcarsMessages.tsx` — untouched. Within those two, every existing
    control keeps its behaviour: REQUEST CLEARANCE, REQUEST LOADSHEET, REQUEST
    WX, the canned buttons, the SimBrief field and the SimBrief import.
14. **`client/src/index.css`** — not edited (§14).
15. **`client/src/utils/api.ts`'s `apiFetch`** — not edited; §8.2 is designed
    around its existing behaviour of discarding `code`.
16. ~~The Windows agent (`agent/`) and the MCDU client repository — no change
    required by anything here, and none implied.~~ **Superseded by amendment
    #3.** `agent/` still needs nothing. The MCDU client repository is now
    the intended second consumer of R1/R3–R7 via its ingest token — a change
    there is expected, not merely "not implied," though it happens in
    `msfslogger_mcdu`, not this repo.
17. **`npm test` stays hermetic** — no test in this design performs a real
    network call or opens the live `flights.db`.

---

## 19. Risks

### 19.1 `comm_history[]`'s real shape (highest)

Every field name in §9.5 comes from documentation, not a capture (§2.1).
Wrong-polarity `incoming`/`outgoing` would file every station transmission as a
cockpit one and vice versa. **Falsified by:** T-003's inspector printing one raw
entry from a real key. **Contained by:** the whole entry is stored in
`payload_json` (§9.6), the mapping is one table, and `direction` is the only
column affected — a reversal is an amendment to §9.5 plus a one-line swap, and
already-imported rows can be corrected by an `UPDATE` on
`dedup_key LIKE 'sayintentions:comm:%'`.

### 19.2 `sayAs`'s failure signalling

§7.4 is a heuristic over an undocumented response. The dangerous direction is
the fallback in step 8: an unrecognised *failure* body counts as success, so a
row is written saying a clearance was sent when it was not. **Falsified by:**
one real `sayAs` call with the sim closed. **Contained by:** `upstream_excerpt`
in the stored payload holds the real body, so the operator and the next
implementer can both see what actually came back; widening
`NO_ACTIVE_SESSION_HINTS` is a one-line amendment. The opposite failure — an
unrecognised success counted as an error — was judged worse (it would make the
feature look broken while working), which is why the fallback points the way it
does.

### 19.3 `getCommsHistory`'s scope

If the endpoint returns more than the current session's comms — a rolling
account-wide history, say — then a `from=session_start` link imports another
flight's radio calls. **Falsified by:** the inspector's `--comms` output
against a key with two flights behind it. **Contained by:** `?from=now` (§5.3)
is the escape hatch, `pending_messages` warns before the first import, and the
session-changed guard (§9.4) stops the next one. If it turns out to be
account-wide, the default flips to `from=now` — an amendment to §5.3, not a
redesign.

### 19.4 A preview-status API with no rate limits and no versioning

SAPI is "in PREVIEW and Free." Fields may be renamed, the base URL may move,
limits may appear. **Contained by:** the client is one file that returns typed
errors and never crashes a route; every failure mode ends in a sentence the
operator reads (§8.1); nothing else in the app depends on SayIntentions being
reachable.

### 19.5 The key in a query string

SAPI takes `api_key` as a GET parameter, so it appears in SayIntentions' own
access logs and in any proxy between here and there. Nothing in this design can
fix that. **Contained on our side by** §4.3 and §7.5: never logged, never in an
error, never in a response body, never in the DOM.

### 19.6 A mis-linked flight

An operator can link the wrong flight and import a transcript into it. The
imported rows are ordinary `acars_messages` rows and this design ships no
delete-a-message route, so the remedy is unlinking (which removes the cursor,
not the rows) and linking the right flight. **Contained by:** the flight-scoped
dedup key (§9.7), which keeps the correct flight's import working, and by
`pending_messages` (§5.3), which shows the size of the import before it runs.
Deleting the whole flight still removes its rows and its link together
(`ON DELETE CASCADE`, §6.1).

### 19.7 Thread volume

A talkative session can produce hundreds of comm rows in one flight's thread,
where every other writer produces a handful. `AcarsMessages.tsx` renders the
whole thread with no pagination. **Falsified by:** a real import from a long
flight. **Contained by:** the `AcarsThread` envelope was built "so a cursor can
be added later without changing the response type" (`src/routes/acars.ts`), and
`idx_acars_messages_flight` already covers the read and its ordering. If it
bites, it is a UI follow-up, not a data-model problem.
