#!/usr/bin/env node
/*
 * deviation-recompute.js — run 2026-09-07-manual-mark-flown, T-001.
 *
 * The load-bearing assumption of design.md §1 is that a leg closed by
 * FlightManager.endFlight() can be reopened by hand WITHOUT losing anything,
 * because its arrival_deviation_nm is recomputable from columns already on the
 * flight row. This script tests that against the real logbook.
 *
 * For every flight with a planned_leg_id it recomputes
 *
 *     Math.round(haversineNm(flights.arrival_lat, flights.arrival_lon,
 *                            planned_legs.destination_lat,
 *                            planned_legs.destination_lon) * 10) / 10
 *
 * — the expression at src/flightManager.ts:458+463, character-identical — and
 * compares it against the stored planned_legs.arrival_deviation_nm.
 *
 * Exits 1 if any leg whose stored deviation is non-NULL disagrees with the
 * recompute. Legs with a NULL stored deviation are informational (never yet
 * closed) and do not fail the run.
 *
 * The database is opened { readonly: true }. This script never writes.
 *
 *   export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
 *   node .claude/runs/2026-09-07-manual-mark-flown/prototypes/deviation-recompute.js flights.db
 */
const Database = require('better-sqlite3');

// Copied verbatim from src/geo.ts (which is itself byte-identical to the
// private copy at src/flightManager.ts:19). A divergence here would invalidate
// the whole comparison, so it is pasted rather than paraphrased.
function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const path = process.argv[2] || 'flights.db';
const db = new Database(path, { readonly: true });

const rows = db.prepare(`
  SELECT f.id                       AS flight_id,
         f.planned_leg_id           AS leg_id,
         f.planned_leg_link_source  AS link_source,
         f.end_time                 AS end_time,
         f.arrival_lat              AS arrival_lat,
         f.arrival_lon              AS arrival_lon,
         f.arrival_icao             AS arrival_icao,
         l.status                   AS leg_status,
         l.destination_ident        AS dest_ident,
         l.destination_lat          AS dest_lat,
         l.destination_lon          AS dest_lon,
         l.arrival_deviation_nm     AS stored_dev
    FROM flights f
    JOIN planned_legs l ON l.id = f.planned_leg_id
   WHERE f.planned_leg_id IS NOT NULL
   ORDER BY f.id
`).all();

let mismatches = 0;
const out = rows.map(r => {
  let recomputed = null;
  if (r.arrival_lat != null && r.arrival_lon != null) {
    recomputed = Math.round(haversineNm(r.arrival_lat, r.arrival_lon, r.dest_lat, r.dest_lon) * 10) / 10;
  }
  let verdict;
  if (r.stored_dev == null) {
    verdict = recomputed == null ? 'no stored, unmeasurable' : `no stored dev (would be ${recomputed})`;
  } else if (recomputed == null) {
    verdict = 'MISMATCH: stored but no arrival position';
    mismatches++;
  } else if (recomputed === r.stored_dev) {
    verdict = 'match';
  } else {
    verdict = `MISMATCH: stored ${r.stored_dev} vs recomputed ${recomputed}`;
    mismatches++;
  }
  return {
    flight: r.flight_id,
    leg: r.leg_id,
    link_source: r.link_source,
    ended: r.end_time != null,
    leg_status: r.leg_status,
    dest: r.dest_ident,
    arrived: r.arrival_icao,
    stored_dev: r.stored_dev,
    recomputed_dev: recomputed,
    verdict,
  };
});

console.table(out);
console.log(`${out.length} linked pair(s); ${mismatches} mismatch(es).`);
db.close();
process.exit(mismatches === 0 ? 0 : 1);
