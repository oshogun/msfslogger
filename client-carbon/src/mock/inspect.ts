/**
 * Prints the fixture counts and checks the volume requirements. Run with:
 *   npx esbuild src/mock/inspect.ts --bundle --platform=node --format=esm --outfile=$TMPDIR/inspect.mjs && node $TMPDIR/inspect.mjs
 */
import {
  getCurrentGroundSession, getFlight, getFlightAcars, getJourney, getNavdataFeatures, getPlannedLeg,
  getRouteGeometry, getTrip, listCannedMessages, listFlights, listPlannedLegs, listTrips, MOCK_LATENCY_MS,
} from './api';
import { altitudeSeries, replayFrames } from './data/tracks';
import { SEED_ACARS } from './data/acars';

const checks: [string, boolean][] = [];
const check = (name: string, ok: boolean) => checks.push([name, ok]);

async function main() {
  const t0 = Date.now();
  const flights = await listFlights();
  const latency = Date.now() - t0;
  const trips = await listTrips();
  const legs = await listPlannedLegs();
  const canned = await listCannedMessages();
  const ground = await getCurrentGroundSession();
  const full = await Promise.all(flights.map(f => getFlight(f.id)));
  const tripFull = await Promise.all(trips.map(t => getTrip(t.id)));
  const journey = await getJourney(2);
  const journeyEmpty = await getJourney(3);
  const features = await getNavdataFeatures([-60, -35, 30, 62], 8);
  const geom = await getRouteGeometry(13);
  const flight1 = full.find(f => f.id === 1)!;
  const acars = SEED_ACARS;

  const counts: Record<string, number> = {
    flights: flights.length,
    'flights in progress': flights.filter(f => f.end_time == null).length,
    'flights with no points': full.filter(f => f.points!.length === 0).length,
    'points on longest track': Math.max(...full.map(f => f.points!.length)),
    trips: trips.length,
    'legs in longest trip': Math.max(...tripFull.map(t => t.planned_legs.length)),
    'empty trips': tripFull.filter(t => t.flight_count === 0 && t.planned_leg_count === 0).length,
    'active trips': trips.filter(t => t.is_active === 1).length,
    'planned legs': legs.length,
    'leg statuses': new Set(legs.map(l => l.status)).size,
    'snippet legs': legs.filter(l => l.is_snippet === 1).length,
    'legs with SID+STAR+approach': legs.filter(l => l.sid_name && l.star_name && l.approach_name).length,
    'acars messages': acars.length,
    'acars categories': new Set(acars.map(m => m.category)).size,
    'acars directions': new Set(acars.map(m => m.direction)).size,
    'canned messages': canned.length,
    'ground sessions': ground.session ? 1 : 0,
    'journey legs': journey.legCount,
    'altitude series (flight 1)': altitudeSeries(flight1.points!).length,
    'replay frames (flight 1)': replayFrames(flight1.points!).length,
    'navdata features airports': features.airports.length,
    'route geometry enroute points': geom.enroute.points.length,
  };
  for (const [k, v] of Object.entries(counts)) console.log(`${k.padEnd(34)} ${v}`);

  const thread13 = await getFlightAcars(13);
  const leg13 = await getPlannedLeg(13);
  check(`latency >= ${MOCK_LATENCY_MS}ms (${latency}ms)`, latency >= MOCK_LATENCY_MS - 5);
  check('every collection count is non-zero', Object.entries(counts).every(([, v]) => v > 0));
  check('>=12 flights, 2 in progress', flights.length >= 12 && counts['flights in progress'] === 2);
  check('1 flight with no points, 1 with ~600', counts['flights with no points'] >= 1 && counts['points on longest track'] === 600);
  check('>=3 trips, 1 active, one 25+ legs, one empty',
    trips.length >= 3 && counts['active trips'] === 1 && counts['legs in longest trip'] >= 25 && counts['empty trips'] === 1);
  check('>=8 planned legs, all 4 statuses', legs.length >= 8 && counts['leg statuses'] === 4);
  check('1+ snippet, 1+ SID/STAR/approach', counts['snippet legs'] >= 1 && counts['legs with SID+STAR+approach'] >= 1);
  check('>=20 acars, 6 categories, both directions', acars.length >= 20 && counts['acars categories'] >= 6 && counts['acars directions'] === 2);
  check('flight 13 thread and leg 13 linked', thread13.messages.length > 0 && leg13.linked_flight_id === 13);
  check('empty trip journey has no progress pct', journeyEmpty.plannedRouteProgressPct === undefined);

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failed++;
  }
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
