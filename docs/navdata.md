# Navdata

Navdata puts MSFS navigation data — airports, VORs/NDBs, fixes, airways,
runways, and the SID/STAR/approach legs a filed plan refers to — under the
flown track on the maps. The **MCDU/CDU Windows client** (its own repository,
`msfslogger_mcdu`) extracts it from the simulator over SimConnect and is the
source of truth; this server keeps a **replica** and answers map queries from
it. With no replica, everything else works exactly as before.

## What you see

- **Navdata panel** on the flight, trip, live and journey maps (five
  checkboxes: airports, navaids, waypoints, airways, runways). The panel only
  appears once the server has a replica, and every checkbox starts off — nothing
  is fetched until you turn one on. Layers draw *beneath* the flown track.
- **Zoom gates.** A layer below its zoom is greyed with the reason and is not
  fetched: airports 6, airways 7, navaids 8, waypoints 9, runways 12.
- **Coverage notes.** Airports are complete worldwide. Navaids and fixes are
  only known where the simulator has been asked, so the panel says *"Not fetched
  here yet"* (never looked) versus *"None here"* (looked, found nothing), and
  *"Partly fetched here (n%)"* in between. Too many results say *"zoom in for
  more"*.
- **Fetch detail.** An airport known only by position shows a *Fetch detail*
  button; it asks the sidecar to fetch runways and procedures the next time it
  polls. Only offered for real airport idents.
- **Expanded planned routes.** For a plan with a SID/STAR/approach or airways,
  the planned line is replaced by the expanded chains when the replica can
  resolve them. Whatever cannot be resolved is explained in the route tooltip;
  an empty answer renders exactly as before (the planned line and the existing
  "planned route excludes SID/STAR/approach legs" note).
- **Computed procedures.** A Little Navmap *custom* departure or approach is not
  a simulator procedure, so it is drawn from the runway instead: a dashed line
  labelled *computed departure* / *computed straight-in*, from the runway's
  landing threshold outward (or back) by the plan's custom distance. Without
  runway detail for that airport the note says so and offers *Fetch detail*.

## Data provenance and licensing

The data is whatever the simulator's facility database serves. On an install
with Navigraph's navdata in the Community folder, that is Navigraph-derived.
The user supplied it themselves; this project does not distribute or fetch
Navigraph data. Consequently:

- `navdata.db` must **never** be committed, baked into a Docker image, or used
  as a test fixture. It is git-ignored and docker-ignored, and lives in a
  mounted directory.
- Tests use synthetic idents and coordinates only.

## Architecture

```
MSFS ──SimConnect──▶ MCDU sidecar (source of truth, own SQLite)
                         │  x-ingest-token
                         ├─ POST /api/navdata/snapshot   whole store, gzipped NDJSON
                         ├─ POST /api/navdata/rows       incremental JSON batches
                         ├─ GET  /api/navdata/demand     what the server wants fetched
                         └─ POST /api/navdata/state      sidecar health, fire-and-forget
                                       ▼
                             navdata.db (replica)  ◀── session-gated queries ── web client
```

- **Replica, not a database of record.** `navdata.db` can be deleted at any time;
  the next snapshot from the sidecar rebuilds it. It is a separate SQLite file
  and is never opened by `flights.db` code paths.
- **Epochs.** Every bulk extraction has an opaque `snapshotId`. A snapshot always
  wins and replaces the replica wholesale, regardless of revision numbers; a
  revision counter is only meaningful *within* one epoch. An incremental batch
  carrying a different epoch is refused (`NAVDATA_SNAPSHOT_MISMATCH`), which is
  the sidecar's signal to send a snapshot. A snapshot re-sent with the epoch the
  server already holds is a normal replace.
- **Schema.** 13 STRICT tables, `NAVDATA_SCHEMA_VERSION = 2` (v2 added
  `primary_threshold_m`/`secondary_threshold_m` on `nav_runway`). The schema is
  duplicated between the two repositories and shipped here as a TypeScript
  string (`src/navdata/schema.ts`). A peer or a batch with a different schema
  version is refused (`NAVDATA_SCHEMA_UNSUPPORTED`); a replica *file* of another
  version is treated as absent and replaced by the next snapshot.
- **Merge rules (all tables).** A row is found by its key only. An incoming NULL
  or missing column keeps the stored value; an incoming value — including `0` —
  replaces it. An identical merged row writes nothing and does not advance the
  revision. `first_seen_at` on `nav_absent` never moves forward. `NULL` means "this
  fetch carried no value"; `0` means "the simulator reported zero" — never
  substitute one for the other. Writes are `INSERT … ON CONFLICT DO UPDATE`, never
  `INSERT OR REPLACE` (whose delete would cascade away an airport's runways and
  procedures).
- **Absence.** "The simulator does not have this facility" arrives as an
  `absent` row in the normal stream and stops the server asking for it again
  (within the same epoch).

## Sidecar endpoints (ingest token)

Authenticated by the `x-ingest-token` header only, checked per route. They are
mounted above the session middleware, so a request never touches the session
store, and a browser session cookie is rejected here. They are **not** in
`INGEST_SCOPED_ROUTES`: an ingest token still cannot reach any session route.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/navdata/snapshot` | Multipart upload, one part named `navdataSnapshot`: a gzipped NDJSON file (header line, `{"t":"<table>","r":{…}}` row lines in parent-before-child order, footer line with row counts). Max 64 MiB compressed. Streamed into a temporary file beside `navdata.db`, verified (schema version, per-table counts against the footer, column check), then swapped in atomically. Answers a `SnapshotAck` with the per-table counts actually written. |
| POST | `/api/navdata/rows` | JSON `IncrementalBatch` (`snapshotId`, `fromRev`, `toRev`, `rows`, `more`). At most 2000 rows and 4 MiB per batch. This one path is exempt from the global 100 kB JSON limit (a path-scoped `express.json({ limit: '4mb' })` sits above the global parser; every other path still rejects at 100 kB). The whole batch is one transaction. |
| GET | `/api/navdata/demand` | What the sidecar should fetch: `airports` (idents wanted in full detail) and `waypoints` (fixes wanted with their airway routes), at most 50 entries per poll (`cap`, echoed), `more: true` when truncated. Derived from manual requests, then active-trip legs, then planned legs, minus what the replica already holds. `USER`-type waypoints are never demanded. |
| POST | `/api/navdata/state` | Sidecar health (`nav.off`/`nav.unavailable`/`nav.bulk`/`nav.ready`/`nav.error`). Always `204`. Kept in memory only; `/status` reports it as `sidecar: null` when the newest report is older than 15 minutes. |

Error bodies are `{ "ok": false, "code", "message" }`:

| HTTP | Code | Meaning |
|---|---|---|
| 409 | `NAVDATA_SNAPSHOT_MISMATCH` | Batch epoch differs from the replica's (or no replica). Carries `serverSnapshotId` (null if none) and `serverRev`. Send a snapshot. |
| 409 | `NAVDATA_SCHEMA_UNSUPPORTED` | Schema version differs. Carries `serverSchemaVersion`. Also used for a replica whose columns do not match the schema. Retrying cannot help. |
| 400 | `NAVDATA_BAD_BATCH` | Malformed input, unknown row type/column, or a row that violates a constraint (for example a runway whose airport row does not exist). The whole batch is rolled back. |
| 413 | `NAVDATA_TOO_LARGE` | Over the row, byte, or upload limit. |
| 503 | `NAVDATA_BUSY` | The replica is being replaced (a snapshot is uploading or being swapped). `Retry-After` is set; `/rows` is refused for the whole import so a batch can never land in the epoch that is about to be replaced. |

## Query endpoints (session)

All under the normal session login (`requireAuth`); the ingest token is rejected.
With no replica they answer with empty results and `200` (never a `500`).

| Method | Path | Returns |
|---|---|---|
| GET | `/api/navdata/status` | `present` (false hides the map toggles), schema/epoch/revision, counts, `snapshotAppliedAt` (the sidecar's snapshot creation time), `lastRowsAt`, and `sidecar` state. During a swap it answers `present: false`. |
| GET | `/api/navdata/features?bbox=w,s,e,n&zoom=&kinds=&limit=` | Airports, navaids, waypoints, airways, runways inside the box; `gated` (kinds suppressed by zoom), `truncated`, and `coverage` (per-kind harvested-cell counts on a 0.5° global grid). `bbox`/`zoom` required, `limit` default 2000, max 5000. A box with `w > e` crosses the antimeridian and is split into two ranges. Longitudes are always in [-180, 180]; the client does the unwrapping. |
| GET | `/api/navdata/airports/:ident` | Position, `detailState` (`index` = position only, the normal case), runways, frequencies, procedure summaries. `404` only when the ident is not in the index. |
| POST | `/api/navdata/request` | `{ kind: 'A'\|'W', ident, region?, force? }` — ask the sidecar to fetch detail. Also requires a same-origin request. Answers `queued`, `already-present` or `known-absent`; idempotent. |
| GET | `/api/planned-legs/:legId/route-geometry` | The plan expanded into `sid`, `enroute`, `star`, `approach` chains (points and arcs), `skippedLegs` (coordinate-less procedure legs, counted and never invented), and `unresolved` names with reasons. Every chain empty is a legal answer. |

Manual "Fetch detail" requests are remembered in the `navdata_requests` table in
`flights.db` (not in `navdata.db`, so a snapshot swap cannot wipe them). Rows
expire after 7 days and are deleted once the replica answers them. See
[data-model.md](data-model.md#navdata_requests).

## Route geometry rules

- A planned waypoint's own coordinates are always drawn; the replica only
  enriches and validates them (more than 1 km disagreement is reported).
- A planned waypoint's `airway` names the airway used to reach *that* waypoint
  from the previous one. `DCT`, the plan's own SID/STAR (or transition) name, and
  any value at an airport endpoint are not airways: those segments are drawn
  direct. Only an unknown airway name is reported as unresolved.
- Procedures are matched by exact, case-insensitive name plus runway and suffix;
  the plan's approach type is ignored for matching.
- Custom procedures are computed from `nav_runway`: the runway is matched on its
  primary end first, then the secondary end (never by which number is lower),
  the runway heading is a **true** bearing (measured), and the landing threshold
  is the pavement end moved inboard by the displaced threshold, if any.
  *Provisional:* the primary/secondary pairing of the displaced-threshold
  columns rests on one sample; the departure starting datum and the offset sign
  are assumptions.

## Operating it

- Location: `NAVDATA_DB_PATH`, default `./navdata.db`. Docker Compose mounts the
  **directory** `./navdata` at `/app/navdata` (a single-file bind mount cannot be
  swapped by rename) and sets `NAVDATA_DB_PATH=/app/navdata/navdata.db`.
- No backup is needed: the sidecar can always re-send its whole store. To reset,
  stop the server and delete `navdata.db` (and its `-wal`/`-shm`).
- A `navdata.db` that is corrupt or of another schema version is logged and
  treated as absent; the server still starts.
- Snapshot uploads are staged in a per-process private temporary directory and
  removed after import.
- Ingest cost: a 41,871-row airport snapshot imports in a few seconds on a
  desktop machine.

See also [api.md](api.md), [configuration.md](configuration.md),
[data-model.md](data-model.md), [security.md](security.md) and
[troubleshooting.md](troubleshooting.md#navdata).
