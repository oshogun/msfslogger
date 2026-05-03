import { initDb, getDb } from './db';
import { initAirports, findNearestAirport } from './airports';

type FlightRow = {
  id: number;
  departure_lat: number | null;
  departure_lon: number | null;
  departure_icao: string | null;
  arrival_lat: number | null;
  arrival_lon: number | null;
  arrival_icao: string | null;
};

async function main() {
  await initAirports();
  const db = initDb();

  const flights = db.prepare(`
    SELECT id, departure_lat, departure_lon, departure_icao, arrival_lat, arrival_lon, arrival_icao
    FROM flights
    WHERE (departure_lat IS NOT NULL AND (departure_icao IS NULL OR departure_name IS NULL))
       OR (arrival_lat   IS NOT NULL AND (arrival_icao   IS NULL OR arrival_name   IS NULL))
  `).all() as FlightRow[];

  if (flights.length === 0) {
    console.log('All flights already have ICAO codes — nothing to do.');
    return;
  }

  console.log(`Backfilling ${flights.length} flight(s)...`);

  const updateBothDep = db.prepare('UPDATE flights SET departure_icao = ?, departure_name = ? WHERE id = ?');
  const updateNameDep = db.prepare('UPDATE flights SET departure_name = ? WHERE id = ?');
  const updateBothArr = db.prepare('UPDATE flights SET arrival_icao   = ?, arrival_name   = ? WHERE id = ?');
  const updateNameArr = db.prepare('UPDATE flights SET arrival_name   = ? WHERE id = ?');

  let depFound = 0;
  let arrFound = 0;

  for (const f of flights) {
    let depIcao: string | null = null;
    let depName: string | null = null;
    let arrIcao: string | null = null;
    let arrName: string | null = null;

    if (f.departure_lat !== null && f.departure_lon !== null) {
      const dep = findNearestAirport(f.departure_lat, f.departure_lon);
      if (dep) { depIcao = dep.icao; depName = dep.name; depFound++; }
    }
    if (f.arrival_lat !== null && f.arrival_lon !== null) {
      const arr = findNearestAirport(f.arrival_lat, f.arrival_lon);
      if (arr) { arrIcao = arr.icao; arrName = arr.name; arrFound++; }
    }

    if (depName) {
      if (depIcao && !f.departure_icao) updateBothDep.run(depIcao, depName, f.id);
      else                              updateNameDep.run(depName, f.id);
    }
    if (arrName) {
      if (arrIcao && !f.arrival_icao) updateBothArr.run(arrIcao, arrName, f.id);
      else                            updateNameArr.run(arrName, f.id);
    }

    const route = `${depIcao ?? '???'} (${depName ?? '—'}) → ${arrIcao ?? '???'} (${arrName ?? '—'})`;
    console.log(`  Flight #${f.id}: ${route}`);
  }

  console.log(`Done. Departure identified: ${depFound}/${flights.length}, Arrival: ${arrFound}/${flights.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
