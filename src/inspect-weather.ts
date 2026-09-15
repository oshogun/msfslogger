#!/usr/bin/env ts-node
// ── Weather client inspector ──────────────────────────────────────────────────
//
// A read-only CLI over src/weatherClient.ts. It exists so a real fetch against
// aviationweather.gov can be eyeballed without a database, a server, or the
// ACARS route in front of it — hand it an ICAO and it prints the parsed
// METAR/TAF, or the failure.
//
//   npx ts-node src/inspect-weather.ts EGLL
//   npx ts-node src/inspect-weather.ts KJFK ZZZZ
//
// WEATHER_API_BASE_URL may be set beforehand to point this at a stub instead
// of the live service (see src/weatherClient.ts's baseUrl()).
//
// Exit status is 0 only when every ICAO produced a result (found or "no
// current report"). A thrown WeatherFetchError prints one line naming the
// code — never a stack trace — and makes the whole run exit non-zero.

import { fetchWeather, WeatherFetchError, type RawWeather } from './weatherClient';
import { normaliseIcao, isValidIcaoShape } from './acars';

function report(icao: string, raw: RawWeather): void {
  console.log(`── ${icao}`);
  console.log(`   metar   ${raw.metar ?? '(no current report)'}`);
  console.log(`   taf     ${raw.taf ?? '(none on file)'}`);
  console.log(`   fetched ${raw.fetched_at}`);
  console.log('');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('usage: ts-node src/inspect-weather.ts <ICAO> [...]');
    process.exitCode = 2;
    return;
  }

  let ok = 0;
  let failed = 0;

  for (const raw of args) {
    const icao = normaliseIcao(raw);
    if (!isValidIcaoShape(icao)) {
      console.error(`✗ REJECTED ${raw}: not a 4-character alphanumeric ICAO`);
      failed++;
      continue;
    }
    try {
      const result = await fetchWeather(icao);
      report(icao, result);
      ok++;
    } catch (err) {
      if (err instanceof WeatherFetchError) {
        console.error(`✗ ${icao} ${err.code}: ${err.message}`);
      } else {
        console.error(`✗ ${icao} INTERNAL: ${err instanceof Error ? err.message : String(err)}`);
      }
      failed++;
    }
  }

  console.log(`${ok} fetched, ${failed} failed, ${args.length} icao(s) seen`);
  if (failed > 0) process.exitCode = 1;
}

main();
