import {
  initDb,
  closeDb,
  getDb,
  getSetting,
  setSetting,
  setAuthUser,
  createTrip,
  insertFlight,
  closeFlight,
  insertPoint,
  assignFlightToTrip,
  createPlannedLeg,
  type CreatePlannedLegInput,
} from './db';
import { hashPassword } from './auth/password';

/**
 * Deterministic seed/reset for the end-to-end test database. Never runs
 * against the operator's real database: FLIGHTS_DB_PATH is mandatory, has no
 * default and no fallback, and even a correctly-set path is refused unless it
 * is either brand new or was created by a previous run of this same script.
 *
 * Compiled into dist/ with everything else (no ts-node requirement in
 * production), invoked exactly one way:
 *
 *   FLIGHTS_DB_PATH=/path/to/scratch/e2e.db node dist/testSeed.js
 *
 * Idempotent: running it twice against the same database reproduces the same
 * rows with the same ids, never duplicates, because every table this script
 * owns is cleared (and its AUTOINCREMENT counter reset) before the fixture is
 * re-inserted.
 */

const USAGE = 'Usage: FLIGHTS_DB_PATH=<path> node dist/testSeed.js   (no other arguments; the database path has no flag and no default)';

const RESET_TABLES = [
  'acars_messages',
  'ground_sessions',
  'flight_points',
  'planned_waypoints',
  'planned_alternates',
  'planned_legs',
  'flights',
  'trips',
  'auth_user',
  'auth_session',
] as const;

const SEQUENCE_TABLES = [
  'flights',
  'trips',
  'planned_legs',
  'flight_points',
  'planned_waypoints',
  'planned_alternates',
  'ground_sessions',
  'acars_messages',
] as const;

/** Tables checked for pre-existing, non-fixture data when no e2e marker is present. */
const CONTENT_GUARD_TABLES = ['flights', 'trips', 'planned_legs', 'ground_sessions', 'acars_messages', 'auth_user'] as const;

const E2E_USERNAME = process.env.MSFSLOGGER_E2E_USERNAME || 'e2e';
const E2E_PASSWORD = process.env.MSFSLOGGER_E2E_PASSWORD || 'e2e-password-123';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv: string[]): void {
  if (argv.length === 0) return;
  if (argv.length === 1 && argv[0] === '--help') {
    console.log(USAGE);
    process.exit(0);
  }
  fail(`Unrecognised argument "${argv[0]}".\n${USAGE}`);
}

function requireDbPath(): string {
  const dbPath = process.env.FLIGHTS_DB_PATH;
  if (!dbPath) {
    fail('testSeed: FLIGHTS_DB_PATH is not set — refusing to guess a database path.');
  }
  return dbPath;
}

function countRows(table: string): number {
  return (getDb().prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

/**
 * Refuses to write unless the database is either already marked as an e2e
 * fixture (a previous run of this script) or holds no rows at all in the
 * tables this script owns. This is what makes a mistyped or mis-scoped
 * FLIGHTS_DB_PATH harmless: a real logbook has rows and no marker, so the
 * guard stops before the first DELETE.
 */
function ensureSafeToSeed(dbPath: string): void {
  if (getSetting('e2e_seed') !== null) return;

  const counts = CONTENT_GUARD_TABLES
    .map(table => [table, countRows(table)] as const)
    .filter(([, count]) => count > 0);

  if (counts.length > 0) {
    const detail = counts.map(([table, count]) => `${table}=${count}`).join(', ');
    fail(`testSeed: refusing to seed ${dbPath} — it already holds data (${detail}) and carries no e2e marker.`);
  }
}

function resetOwnedTables(): void {
  for (const table of RESET_TABLES) {
    getDb().prepare(`DELETE FROM ${table}`).run();
  }
  const placeholders = SEQUENCE_TABLES.map(() => '?').join(', ');
  getDb().prepare(`DELETE FROM sqlite_sequence WHERE name IN (${placeholders})`).run(...SEQUENCE_TABLES);
}

function defaultPlannedLegPlan(): CreatePlannedLegInput['plan'] {
  return {
    departure: { ident: '', name: null, lat: 0, lon: 0, isAirport: true },
    destination: { ident: '', name: null, lat: 0, lon: 0, isAirport: true },
    isSnippet: false,
    cruiseAltFt: null,
    flightplanType: 'IFR',
    aircraftType: 'A20N',
    remarks: null,
    createdAt: null,
    sourceProgram: 'msfslogger-e2e-seed',
    departureStart: { pos: null, start: null, startType: null },
    procedures: {
      sidName: null, sidRunway: null, sidTransition: null, sidType: null, sidCustomDistanceNm: null,
      starName: null, starRunway: null, starTransition: null,
      approachName: null, approachRunway: null, approachTransition: null, approachType: null,
      approachArinc: null, approachSuffix: null, approachTransitionType: null,
      approachCustomDistanceNm: null, approachCustomAltitudeFt: null, approachCustomOffsetDeg: null,
    },
    waypoints: [],
    alternates: [],
    approxDistanceNm: 0,
  };
}

interface Fixture {
  db: string;
  tripId: number;
  flightIds: number[];
  plannedLegIds: number[];
}

function seed(dbPath: string): Fixture {
  resetOwnedTables();

  setAuthUser(E2E_USERNAME, hashPassword(E2E_PASSWORD));

  const tripId = createTrip('E2E Baltic Hop', 'Seeded trip for end-to-end tests');
  getDb().prepare('UPDATE trips SET created_at = ? WHERE id = ?').run('2026-02-20T09:00:00.000Z', tripId);

  // Flight 1: EFHK -> EETN, Airbus A320neo, linked into the trip.
  const flight1Id = insertFlight('Airbus A320neo', 60.3172, 24.9633, '2026-03-01T08:00:00.000Z', 'EFHK', 'Helsinki-Vantaa');
  closeFlight(flight1Id, '2026-03-01T09:12:00.000Z', 59.4133, 24.8328, 4320, 152.4, 36000, 451, 3, 'EETN', 'Tallinn Lennart Meri');
  insertPoint(flight1Id, '2026-03-01T08:00:00.000Z', 60.3172, 24.9633, 0, 0, 0, 185, 0, true);
  insertPoint(flight1Id, '2026-03-01T08:36:00.000Z', 59.8653, 24.8981, 36000, 451, 460, 185, 0, false);
  insertPoint(flight1Id, '2026-03-01T09:12:00.000Z', 59.4133, 24.8328, 0, 0, 0, 185, 0, true);
  assignFlightToTrip(flight1Id, tripId);

  // Flight 2: EETN -> EEPU, Cessna 172, ungrouped.
  const flight2Id = insertFlight('Cessna 172', 59.4133, 24.8328, '2026-03-02T10:00:00.000Z', 'EETN', 'Tallinn Lennart Meri');
  closeFlight(flight2Id, '2026-03-02T11:05:00.000Z', 58.3854, 24.3980, 3900, 96.1, 8500, 122, 2, 'EEPU', 'Parnu');
  insertPoint(flight2Id, '2026-03-02T10:00:00.000Z', 59.4133, 24.8328, 0, 0, 0, 200, 0, true);
  insertPoint(flight2Id, '2026-03-02T11:05:00.000Z', 58.3854, 24.3980, 0, 0, 0, 200, 0, true);

  // Planned leg 1: EETN -> ESSA, attached to the trip.
  const leg1Plan = defaultPlannedLegPlan();
  leg1Plan.departure = { ident: 'EETN', name: 'Tallinn Lennart Meri', lat: 59.4133, lon: 24.8328, isAirport: true };
  leg1Plan.destination = { ident: 'ESSA', name: 'Stockholm Arlanda', lat: 59.6519, lon: 17.9186, isAirport: true };
  leg1Plan.cruiseAltFt = 34000;
  leg1Plan.waypoints = [
    { seq: 1, ident: 'EETN', name: 'Tallinn Lennart Meri', region: null, airway: null, track: null, type: 'AIRPORT', comment: null, lat: 59.4133, lon: 24.8328, altFt: null },
    { seq: 2, ident: 'ESSA', name: 'Stockholm Arlanda', region: null, airway: null, track: null, type: 'AIRPORT', comment: null, lat: 59.6519, lon: 17.9186, altFt: null },
  ];
  leg1Plan.approxDistanceNm = 212.0;
  const leg1Id = createPlannedLeg({
    tripId,
    plan: leg1Plan,
    sourceFilename: 'e2e-eetn-essa.lnmpln',
    sourceSha256: 'e2e' + '0'.repeat(57) + '0001',
  });
  getDb().prepare('UPDATE planned_legs SET imported_at = ? WHERE id = ?').run('2026-02-20T12:05:00.000Z', leg1Id);

  // Planned leg 2: ESSA -> EFHK, loose (no trip).
  const leg2Plan = defaultPlannedLegPlan();
  leg2Plan.departure = { ident: 'ESSA', name: 'Stockholm Arlanda', lat: 59.6519, lon: 17.9186, isAirport: true };
  leg2Plan.destination = { ident: 'EFHK', name: 'Helsinki-Vantaa', lat: 60.3172, lon: 24.9633, isAirport: true };
  leg2Plan.cruiseAltFt = 32000;
  leg2Plan.waypoints = [
    { seq: 1, ident: 'ESSA', name: 'Stockholm Arlanda', region: null, airway: null, track: null, type: 'AIRPORT', comment: null, lat: 59.6519, lon: 17.9186, altFt: null },
    { seq: 2, ident: 'EFHK', name: 'Helsinki-Vantaa', region: null, airway: null, track: null, type: 'AIRPORT', comment: null, lat: 60.3172, lon: 24.9633, altFt: null },
  ];
  leg2Plan.approxDistanceNm = 210.0;
  const leg2Id = createPlannedLeg({
    tripId: null,
    plan: leg2Plan,
    sourceFilename: 'e2e-essa-efhk.lnmpln',
    sourceSha256: 'e2e' + '0'.repeat(57) + '0002',
  });
  getDb().prepare('UPDATE planned_legs SET imported_at = ? WHERE id = ?').run('2026-02-21T08:05:00.000Z', leg2Id);

  // Written last: a crash partway through the seed leaves an unmarked
  // database, which the guard above refuses rather than trusting a
  // half-seeded one.
  setSetting('e2e_seed', '1');

  return { db: dbPath, tripId, flightIds: [flight1Id, flight2Id], plannedLegIds: [leg1Id, leg2Id] };
}

function main(): void {
  parseArgs(process.argv.slice(2));
  const dbPath = requireDbPath();

  // Printed before anything is opened, so a mis-scoped variable is visible in
  // the log rather than inferred afterwards.
  console.log(dbPath);

  initDb(dbPath);
  try {
    ensureSafeToSeed(dbPath);
    const fixture = seed(dbPath);
    console.log(JSON.stringify(fixture));
  } finally {
    closeDb();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('testSeed failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
