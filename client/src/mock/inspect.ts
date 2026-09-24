/**
 * Prints the fixture counts and checks the volume requirements. Run with:
 *   npx esbuild src/mock/inspect.ts --bundle --platform=node --format=esm --outfile=$TMPDIR/inspect.mjs && node $TMPDIR/inspect.mjs
 */
import {
  getCurrentGroundSession, getSayIntentionsLink, importPlannedLegs, importSayIntentions,
  importSimbriefLeg, linkSayIntentions, pushClearanceToSayIntentions, requestAcarsPair, setGroundSession,
  unlinkSayIntentions, linkFlightToLeg, setPlannedLegStatus, getFlight, getFlightAcars, getJourney, getNavdataFeatures, getPlannedLeg,
  attachFlightPlan, removeFlightPlan, setFlightPlannedLegStatus,
  getNavdataStatus, getRouteGeometry, getStoreVersion, getTrip, patchTrip, subscribeStore, listCannedMessages, listFlights, listPlannedLegs, listTrips, MOCK_LATENCY_MS,
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

  // Write accessors go through the shared store, so their effects show in the reads.
  const legsBefore = legs.length;
  const imp = await importPlannedLegs([
    new File([''], 'SBGR-SBBR.lnmpln'), new File([''], 'SBCT-SBPA warn.lnmpln'),
    new File([''], 'notes.txt'), new File([''], 'SBGR-SBBR.lnmpln'),
  ]);
  const legsAfter = await listPlannedLegs();
  const sb = await importSimbriefLeg();
  const sb2 = await importSimbriefLeg();
  const threadBefore = (await getFlightAcars(13)).messages.length;
  const ls1 = await requestAcarsPair({ legId: 13 }, 'loadsheet');
  const ls2 = await requestAcarsPair({ legId: 13 }, 'loadsheet');
  await requestAcarsPair({ legId: 13 }, 'clearance');
  const threadAfter = (await getFlightAcars(13)).messages;
  const link = await linkSayIntentions(12);
  const si1 = await importSayIntentions(12);
  const si2 = await importSayIntentions(12);
  const siStatus = await getSayIntentionsLink(12);
  await unlinkSayIntentions(12);
  const siUnlinked = await getSayIntentionsLink(12);
  const push = await pushClearanceToSayIntentions(13, 'CLEARED');
  const g = await setGroundSession({ airport_icao: 'sbgr', parking_position: 'B12' });
  const g2 = await setGroundSession({ airport_icao: 'SBGR' });
  const newLeg = imp.imported[0].id;
  const skipLinked = await setPlannedLegStatus(13, 'skipped').then(() => 'ok', (e: Error) => e.message);
  const linkTaken = await linkFlightToLeg(1, 13).then(() => 'ok', (e: Error) => e.message);
  console.log(`legs ${legsBefore} -> ${legsAfter.length}; thread 13 ${threadBefore} -> ${threadAfter.length}; SI imports ${si1.imported}/${si2.imported}`);
  check('import outcomes: imported, warning, rejected, duplicate, upload ordering',
    imp.results.map(r => r.status).join() === 'imported,imported,rejected,duplicate'
    && imp.results[1].warnings?.length === 1 && imp.batch?.ordering === 'upload' && imp.imported.length === 2);
  check('imported legs visible to listPlannedLegs', legsAfter.length === legsBefore + 2 && legsAfter.some(l => l.id === newLeg));
  check('simbrief imports once then duplicates', sb.status === 'imported' && sb2.status === 'duplicate' && sb2.planned_leg_id === sb.planned_leg_id);
  check('loadsheet repeat returns same rows, created=false',
    ls1.created && !ls2.created && ls1.request.id === ls2.request.id && ls1.reply.id === ls2.reply.id);
  check('thread 13 grows by exactly 4 with unique ids',
    threadAfter.length === threadBefore + 4 && new Set(threadAfter.map(m => m.id)).size === threadAfter.length);
  check('SayIntentions link/import/repeat/unlink round trip',
    link.pending_messages === 2 && si1.imported === 2 && si2.imported === 0 && siStatus.link?.imported_count === 2 && !siUnlinked.linked);
  check('push clearance stored on the leg thread', push.planned_leg_id === 13 && push.category === 'pdc');
  check('ground entry persists and keeps stand when omitted',
    g.session?.airport_icao === 'SBGR' && g2.session?.parking_position === 'B12' && (await getCurrentGroundSession()).session?.source === 'manual');
  check('409 texts for linked leg', /cannot have its status changed: linked to flight 13/.test(skipLinked) && /already linked to flight 13/.test(linkTaken));

  // Flight detail writes: flight 8 is hand-linked and ended, flight 1 is auto-linked.
  const before8 = (await getPlannedLeg((await getFlight(8)).planned_leg_id!)).status;
  const target8 = before8 === 'flown' ? 'planned' : 'flown';
  const wrong8 = await setFlightPlannedLegStatus(8, before8 === 'flown' ? 'flown' : 'planned').then(() => 'ok', (e: Error) => e.message);
  const marked8 = await setFlightPlannedLegStatus(8, target8);
  const auto1 = await setFlightPlannedLegStatus(1, 'flown').then(() => 'ok', (e: Error) => e.message);
  const noLink11 = await setFlightPlannedLegStatus(11, 'flown').then(() => 'ok', (e: Error) => e.message);
  const badPlan = await attachFlightPlan(12, new File([''], 'x.txt', { type: 'text/plain' })).then(() => 'ok', (e: Error) => e.message);
  const goodPlan = await attachFlightPlan(12, new File(['%PDF-'], 'plan.pdf', { type: 'application/pdf' }));
  const removed = await removeFlightPlan(12);
  check('hand-close: gate 409 texts and status flip on a hand-linked ended flight',
    marked8.status === target8 && /^Planned leg \d+ is '.*', not '.*': only a/.test(wrong8)
    && /was not linked to its planned leg by hand/.test(auto1) && /^Flight 11 is not linked to a planned leg$/.test(noLink11));
  check('flight plan attach validates PDF, attach and remove write the store',
    badPlan === 'File must be a PDF' && goodPlan.flight_plan_name === 'plan.pdf' && removed.flight_plan_name === null);

  // Trip-scoped imports attach to that trip, appended after its last leg.
  const tripImp = await importPlannedLegs([new File([''], 'SBBR-SBSV trip.lnmpln'), new File([''], 'SBSV-SBRF trip.lnmpln')], 3);
  const trip3 = await getTrip(3);
  const badTrip = await importPlannedLegs([new File([''], 'SBGR-SBCT trip.lnmpln')], 9999).then(() => 'ok', (e: Error) => e.message);
  check('importPlannedLegs with tripId attaches legs to that trip in order, and is visible in the listing',
    tripImp.imported.length === 2 && trip3.planned_legs.map(l => l.seq).join() === '1,2'
    && trip3.planned_legs.every(l => l.trip_id === 3) && (await listPlannedLegs()).filter(l => l.trip_id === 3).length === 2);
  check('importPlannedLegs rejects an unknown trip', /Trip 9999 not found/.test(badTrip));

  // Store change notification: one call per successful write, none for reads or failed writes.
  let notified = 0;
  const unsubscribe = subscribeStore(() => { notified += 1; });
  const v0 = getStoreVersion();
  await listTrips();
  await patchTrip(1, { name: 'Baltic Hop' });
  await patchTrip(9999, { name: 'x' }).catch(() => undefined);
  unsubscribe();
  await patchTrip(1, { name: 'Baltic Hop' });
  check('subscribeStore: one notification per successful write; none for reads, failures or after unsubscribe',
    notified === 1 && getStoreVersion() === v0 + 2);

  // Navdata: the replica is reported present and five legs across Brazil and the Baltic draw SID, STAR and approach.
  const navStatus = await getNavdataStatus();
  const procLegs = (await listPlannedLegs()).filter(l => l.sid_name && l.star_name && l.approach_name);
  const geoms = await Promise.all(procLegs.map(l => getRouteGeometry(l.id)));
  check('navdata: replica present, and at least 3 legs (Brazil and Baltic) have SID+STAR+approach geometry',
    navStatus.present && procLegs.length >= 3 && geoms.every(g => g.sid.points.length > 0 && g.star.points.length > 0 && g.approach.points.length > 0)
    && procLegs.some(l => l.departure_ident.startsWith('EF') || l.departure_ident.startsWith('EE'))
    && procLegs.some(l => l.departure_ident.startsWith('SB')));

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failed++;
  }
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
