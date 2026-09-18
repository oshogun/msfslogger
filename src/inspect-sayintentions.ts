#!/usr/bin/env ts-node
// ── SayIntentions client inspector ──────────────────────────────────────────────
//
// A read-only-by-default CLI over src/sayIntentionsClient.ts. It exists so a
// real call against SayIntentions can be eyeballed without a database, a
// server, or a route in front of it. The key comes from the environment,
// NEVER from the database, so this tool cannot touch the live flights.db.
//
//   SAYINTENTIONS_API_KEY=si_xxx npx ts-node src/inspect-sayintentions.ts --comms
//   SAYINTENTIONS_API_KEY=si_xxx npx ts-node src/inspect-sayintentions.ts --comms 51221
//   SAYINTENTIONS_API_KEY=si_xxx npx ts-node src/inspect-sayintentions.ts --say "PDC KSFO KLAX CLRD SSTIK3"
//
// --comms [sinceId]  calls getCommsHistory and prints the parsed result, plus
//                     the first raw entry exactly as received — useful for
//                     checking the client's field assumptions against a real
//                     response.
// --say "<text>"      calls sayAs(channel=ACARS_IN) with the given text.
//
// SAYINTENTIONS_API_BASE_URL may be set beforehand to point this at a stub
// instead of the live service (see src/sayIntentionsClient.ts's baseUrl()).
//
// Every failure prints one line naming the SayIntentionsErrorCode — never a
// stack trace — and makes the run exit non-zero.

import { getCommsHistory, sayAs, SayIntentionsFetchError } from './sayIntentionsClient';

function fail(message: string): never {
  console.error(message);
  process.exitCode = 2;
  process.exit();
}

async function runComms(apiKey: string, sinceIdArg: string | undefined): Promise<void> {
  const sinceId = sinceIdArg === undefined ? undefined : Number(sinceIdArg);
  if (sinceIdArg !== undefined && !Number.isFinite(sinceId)) {
    fail(`✗ --comms: "${sinceIdArg}" is not a number`);
  }

  try {
    const result = await getCommsHistory(apiKey, sinceId ?? null);
    console.log(`flight_id: ${result.flight_id ?? '(none)'}`);
    console.log(`comm_history: ${result.comm_history.length} entr${result.comm_history.length === 1 ? 'y' : 'ies'}`);
    console.log(`mission: ${result.mission ? JSON.stringify(result.mission) : '(none)'}`);
    if (result.comm_history.length > 0) {
      console.log('first entry, raw:');
      console.log(JSON.stringify(result.comm_history[0], null, 2));
    }
  } catch (err) {
    if (err instanceof SayIntentionsFetchError) {
      console.error(`✗ getCommsHistory ${err.code}: ${err.message}`);
    } else {
      console.error(`✗ getCommsHistory INTERNAL: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exitCode = 1;
  }
}

async function runSay(apiKey: string, text: string | undefined): Promise<void> {
  if (text === undefined) {
    fail('✗ --say needs a message: --say "<text>"');
  }

  try {
    const result = await sayAs(apiKey, { channel: 'ACARS_IN', message: text, rephrase: 0 });
    console.log(`ok: ${result.ok}`);
    console.log(`rawText: ${result.rawText}`);
  } catch (err) {
    if (err instanceof SayIntentionsFetchError) {
      console.error(`✗ sayAs ${err.code}: ${err.message}`);
    } else {
      console.error(`✗ sayAs INTERNAL: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apiKey = process.env.SAYINTENTIONS_API_KEY;
  if (!apiKey) {
    fail('usage: SAYINTENTIONS_API_KEY=<key> npx ts-node src/inspect-sayintentions.ts --comms [sinceId] | --say "<text>"');
  }

  if (args[0] === '--comms') {
    await runComms(apiKey, args[1]);
  } else if (args[0] === '--say') {
    await runSay(apiKey, args[1]);
  } else {
    fail('usage: --comms [sinceId] | --say "<text>"');
  }
}

main();
