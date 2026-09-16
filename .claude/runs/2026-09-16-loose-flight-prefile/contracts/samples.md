# Sample payloads — loose planned legs

Reference artifact for run `2026-09-16-loose-flight-prefile`. Field values are
illustrative; the SHAPES are frozen. See `design.md` §5 for status codes and
`§7.1` for the client mirror.

Every leg object below is the existing `PlannedLegWithChildren` — abbreviated
here with `…` for the 40-odd fields this run does not touch. The only new key
anywhere is `trip_name`, and it appears only on `GET /api/planned-legs`.

## GET /api/planned-legs → 200

```json
[
  {
    "id": 40,
    "trip_id": null,
    "trip_name": null,
    "seq": 1,
    "status": "flown",
    "departure_ident": "KSBA",
    "destination_ident": "KMRY",
    "linked_flight_id": 93,
    "waypoints": [],
    "alternates": [],
    "…": "every other PlannedLeg column, unchanged"
  },
  {
    "id": 41,
    "trip_id": null,
    "trip_name": null,
    "seq": 2,
    "status": "planned",
    "departure_ident": "EGLL",
    "destination_ident": "LFPG",
    "linked_flight_id": null,
    "waypoints": [],
    "alternates": [],
    "…": "…"
  },
  {
    "id": 4,
    "trip_id": 1,
    "trip_name": "Pacific hop",
    "seq": 1,
    "status": "flown",
    "departure_ident": "KLAX",
    "destination_ident": "KSFO",
    "linked_flight_id": 61,
    "waypoints": [],
    "alternates": [],
    "…": "…"
  }
]
```

Order: the loose block first, by `(seq ASC, id ASC)`, then the trip blocks by
`(trip_id ASC, seq ASC, id ASC)`. `design.md` §8.3 is authoritative.

## POST /api/planned-legs (multipart `lnmpln`) → 201

Byte-identical in shape to `POST /api/trips/:id/planned-legs`.

```json
{
  "imported": [ { "id": 42, "trip_id": null, "seq": 3, "…": "…" } ],
  "batch": { "ordering": "chain", "reason": "CHAIN_RESOLVED" },
  "results": [
    { "filename": "EGLL-LFPG.lnmpln", "status": "imported", "planned_leg_id": 42, "warnings": [] }
  ]
}
```

400 with the same body shape when nothing imported; `results[].error` carries
the reason. The duplicate outcome for a loose leg:

```json
{
  "filename": "EGLL-LFPG.lnmpln",
  "status": "duplicate",
  "planned_leg_id": 41,
  "error": "Already imported without a trip as leg 2"
}
```

Plain `{ "error": "..." }` (no `results` key) for: no files uploaded (400) and
a multer limit (413/400 via the app-level handler) — exactly as today.

## POST /api/planned-legs/simbrief (JSON) → 201

```json
{
  "imported": [ { "id": 43, "trip_id": null, "seq": 4, "…": "…" } ],
  "result": {
    "status": "imported",
    "planned_leg_id": 43,
    "label": "EGLL → LFPG (BA306)",
    "warnings": []
  }
}
```

Duplicate → 200, nothing written:

```json
{
  "imported": [],
  "result": {
    "status": "duplicate",
    "planned_leg_id": 41,
    "label": "EGLL → LFPG (BA306)",
    "warnings": [],
    "error": "This SimBrief plan is already imported without a trip as leg 2. Generate a new OFP on simbrief.com, or re-import to add it again."
  }
}
```

Failure bodies are the trip-nested route's, unchanged, minus `NOT_FOUND`:
`{ "error": "...", "code": "NO_USER_ID" }` (400),
`UNKNOWN_USER` (400), `NO_PLAN` (404), `TIMEOUT` (504),
`NETWORK` / `BAD_STATUS` / `BAD_BODY` (502), `DB_ERROR` (500).

## GET /api/status while flying a loose leg

```json
{
  "plannedLeg": {
    "plannedLegId": 41,
    "tripId": null,
    "tripName": null,
    "destinationIdent": "LFPG",
    "nextWaypointIdent": "DVR",
    "remainingDistanceNm": 84.3,
    "distanceIsApproximate": true
  }
}
```

## GET /api/status while parked with a loose leg matched by hand

```json
{
  "groundSession": {
    "groundSessionId": 7,
    "source": "manual",
    "airportIcao": "EGLL",
    "plannedLegId": 41,
    "plannedLegLinkSource": "manual",
    "tripId": null,
    "tripName": null,
    "departureIdent": "EGLL",
    "destinationIdent": "LFPG",
    "…": "…"
  }
}
```

`GroundSessionLiveStatus.tripId`/`tripName` were already `number | null` /
`string | null` — this payload is new only in that the nulls are now reachable
with `plannedLegId` non-null.
