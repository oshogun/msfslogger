// Prototype for run 2026-09-13-simbrief-import, design section 4/5.
// Reads the REAL captured SimBrief response and exercises the proposed
// navlog -> planned_waypoints mapping. Not shipped; nothing here goes in src/.
//
//   node .claude/runs/2026-09-13-simbrief-import/prototypes/map-navlog.js
const fs = require('fs');
const path = require('path');

const SAMPLE = path.join(__dirname, '..', 'contracts', 'simbrief.userid.json');
const j = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));

// --- the two helpers the design proposes ------------------------------------
// PHP's XML->JSON drops empty elements to {} and collapses a single repeated
// element to an object instead of a 1-element array. Both are real, observed.
const str = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v) => { const s = str(v); if (s === null) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const arr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' && Object.keys(v).length > 0 ? [v] : []);

const R = 3440.065;
const rad = (d) => (d * Math.PI) / 180;
function haversineNm(a1, o1, a2, o2) {
  const dLat = rad(a2 - a1), dLon = rad(o2 - o1);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// --- what is actually in navlog ---------------------------------------------
const fixes = arr(j.navlog && j.navlog.fix);
console.log('navlog.fix count:', fixes.length);
console.log('idents/types/stage/airway:');
for (const f of fixes) {
  console.log(
    '  ' + String(str(f.ident)).padEnd(8),
    String(str(f.type)).padEnd(5),
    String(str(f.stage)).padEnd(4),
    'airway=' + String(str(f.via_airway)).padEnd(9),
    'sid_star=' + f.is_sid_star,
    'alt=' + String(num(f.altitude_feet)).padStart(6),
    'lat=' + num(f.pos_lat), 'lon=' + num(f.pos_long),
  );
}

const origin = str(j.origin && j.origin.icao_code);
const dest = str(j.destination && j.destination.icao_code);
console.log('\norigin.icao_code =', origin, ' destination.icao_code =', dest);
console.log('first fix ident   =', str(fixes[0].ident), '  <- origin airport present in navlog?',
  str(fixes[0].ident) === origin);
console.log('last  fix ident   =', str(fixes[fixes.length - 1].ident), '  <- destination present in navlog?',
  str(fixes[fixes.length - 1].ident) === dest);

// --- proposed waypoint chain: synthesize origin, reuse navlog, dedupe dest ---
const chain = [];
chain.push({ ident: origin, name: str(j.origin.name), type: 'AIRPORT', airway: null,
  lat: num(j.origin.pos_lat), lon: num(j.origin.pos_long), altFt: num(j.origin.elevation) });
for (const f of fixes) {
  chain.push({ ident: str(f.ident), name: str(f.name),
    type: str(f.type) === 'apt' ? 'AIRPORT' : (str(f.type) || 'UNKNOWN').toUpperCase(),
    airway: str(f.via_airway), lat: num(f.pos_lat), lon: num(f.pos_long), altFt: num(f.altitude_feet) });
}
if (chain[chain.length - 1].ident !== dest) {
  chain.push({ ident: dest, name: str(j.destination.name), type: 'AIRPORT', airway: null,
    lat: num(j.destination.pos_lat), lon: num(j.destination.pos_long), altFt: num(j.destination.elevation) });
}
console.log('\nchain length:', chain.length, '=> ', chain.map((c) => c.ident).join(' '));

let d = 0;
for (let i = 1; i < chain.length; i++) d += haversineNm(chain[i - 1].lat, chain[i - 1].lon, chain[i].lat, chain[i].lon);
console.log('\napproxDistanceNm (haversine over chain) =', d.toFixed(1));
console.log('general.route_distance (SimBrief)       =', num(j.general.route_distance));
console.log('general.gc_distance   (SimBrief)        =', num(j.general.gc_distance));

// --- the empty-element hazard, counted on real data -------------------------
let empties = 0, emptyPaths = [];
(function walk(o, p) {
  if (o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === 0) {
    empties++; if (emptyPaths.length < 12) emptyPaths.push(p); return;
  }
  if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], p + '.' + k);
})(j, '$');
console.log('\nempty-object ({}) leaves in the real sample:', empties);
console.log('  e.g.', emptyPaths.join(', '));

console.log('\nalternate is:', Array.isArray(j.alternate) ? 'array' : typeof j.alternate,
  '- keys:', Object.keys(j.alternate).length, '=> arr() gives', arr(j.alternate).length, 'alternate(s)');
console.log('atc.flight_rules =', JSON.stringify(str(j.atc.flight_rules)),
  '-> flightplanType', str(j.atc.flight_rules) === 'I' ? '"IFR"' : '"VFR"');
console.log('aircraft.icao_code =', JSON.stringify(str(j.aircraft.icao_code)));
console.log('general.initial_altitude =', num(j.general.initial_altitude));
console.log('params.time_generated =', str(j.params.time_generated),
  '->', new Date(Number(j.params.time_generated) * 1000).toISOString());
console.log('params.request_id =', str(j.params.request_id), ' params.sequence_id =', str(j.params.sequence_id));
