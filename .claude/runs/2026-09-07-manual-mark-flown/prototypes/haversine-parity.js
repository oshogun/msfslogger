#!/usr/bin/env node
/*
 * haversine-parity.js — run 2026-09-07-manual-mark-flown, T-001.
 *
 * design.md §3 claims the hand path may import haversineNm from src/geo.ts and
 * still produce the value src/flightManager.ts:458 produces from its own
 * private copy. The two function BODIES are byte-identical (verified by
 * `diff` on lines src/geo.ts:23-30 vs src/flightManager.ts:19-26 — only the
 * `export` keyword and a trailing comment differ), but "identical source" and
 * "identical double" are different claims in floating point, so this measures
 * it: both copies are evaluated on the live logbook's eight linked pairs plus
 * eight adversarial pairs, and Object.is() is required on the raw double AND
 * on the rounded value.
 *
 *   export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
 *   node .claude/runs/2026-09-07-manual-mark-flown/prototypes/haversine-parity.js flights.db
 *
 * Exits non-zero on any divergence. Opens the database { readonly: true }.
 */
const Database = require('better-sqlite3');

// src/geo.ts:23-30, verbatim (TypeScript annotations stripped).
function geoHaversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// src/flightManager.ts:19-26, verbatim (TypeScript annotations stripped).
function fmHaversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // nautical miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const pairs = [];

const db = new Database(process.argv[2] || 'flights.db', { readonly: true });
for (const r of db.prepare(`
  SELECT f.id AS flight_id, f.arrival_lat, f.arrival_lon,
         l.destination_lat, l.destination_lon, l.destination_ident
    FROM flights f JOIN planned_legs l ON l.id = f.planned_leg_id
   WHERE f.arrival_lat IS NOT NULL AND f.arrival_lon IS NOT NULL
   ORDER BY f.id
`).all()) {
  pairs.push({
    label: `live flight ${r.flight_id} -> ${r.destination_ident}`,
    a: [r.arrival_lat, r.arrival_lon, r.destination_lat, r.destination_lon],
  });
}
db.close();

// Adversarial: antimeridian, poles, antipodes, zero distance, and two pairs
// chosen to sit either side of a .x5 rounding boundary.
pairs.push(
  { label: 'antimeridian 179E -> 179W', a: [0, 179, 0, -179] },
  { label: 'antimeridian high lat',     a: [65, 179.9, 65.1, -179.9] },
  { label: 'identical point',           a: [58.354721, -134.578491, 58.354721, -134.578491] },
  { label: 'north pole -> equator',     a: [90, 0, 0, 0] },
  { label: 'antipodal',                 a: [10, 20, -10, -160] },
  { label: 'sub-nm',                    a: [58.354721, -134.578491, 58.3552, -134.5791] },
  { label: 'far diversion ~120 nm',     a: [58.354721, -134.578491, 56.3, -134.0] },
  { label: 'tiny lon-only delta',       a: [0, 0, 0, 0.000001] },
);

let bad = 0;
const rows = pairs.map(p => {
  const g = geoHaversineNm(...p.a);
  const f = fmHaversineNm(...p.a);
  const gr = Math.round(g * 10) / 10;
  const fr = Math.round(f * 10) / 10;
  const same = Object.is(g, f) && Object.is(gr, fr);
  if (!same) bad++;
  return {
    case: p.label,
    geo_raw: g,
    fm_raw: f,
    rounded: gr,
    identical: same ? 'yes' : 'NO',
  };
});

console.table(rows);
console.log(`${rows.length} pair(s); ${bad} divergence(s).`);
process.exit(bad === 0 ? 0 : 1);
