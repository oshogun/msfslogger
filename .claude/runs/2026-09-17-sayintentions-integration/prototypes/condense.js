// Prototype for design.md section 7 — the condensed ACARS_IN message.
//
// Run: node .claude/runs/2026-09-17-sayintentions-integration/prototypes/condense.js
//
// Not implementation. This exists so the worked examples in design.md are
// computed output, not hand-counted prose. src/acars.ts's
// buildCondensedClearanceMessage() must reproduce these byte for byte.

const MAX_ACARS_IN_CHARS = 128;

/** levelText, copied verbatim from src/acars.ts so the prototype cannot drift. */
function levelText(ft) {
  if (ft === null) return 'UNKNOWN';
  const r = Math.round(ft);
  return r >= 18000 ? `FL${String(Math.round(r / 100)).padStart(3, '0')}` : `${r}FT`;
}

function normaliseRoute(route) {
  if (route === null || route === undefined) return null;
  const cleaned = route
    .replace(/[^\x20-\x7E]/g, ' ')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned === '' ? null : cleaned;
}

function clipRouteToBudget(tokens, budget) {
  const whole = tokens.join(' ');
  if (whole.length <= budget) return whole;

  const last = tokens[tokens.length - 1];
  const suffix = ` .. ${last}`;
  if (tokens.length > 1 && suffix.length + tokens[0].length <= budget) {
    let out = tokens[0];
    for (let i = 1; i < tokens.length - 1; i++) {
      const next = `${out} ${tokens[i]}`;
      if (next.length + suffix.length > budget) break;
      out = next;
    }
    return out + suffix;
  }

  if (budget >= 3) return `${whole.slice(0, budget - 2).trimEnd()}..`;
  return 'NIL';
}

function buildCondensedClearanceMessage(details) {
  const dep = (details.departure_icao ?? '').trim().toUpperCase() || '????';
  const dst = (details.destination_icao ?? '').trim().toUpperCase() || '????';
  const head = `PDC ${dep} ${dst} CLRD `;
  const tail = ` CLB ${levelText(details.initial_altitude_ft)} SQ ${details.squawk}`;
  const budget = MAX_ACARS_IN_CHARS - head.length - tail.length;

  const route = normaliseRoute(details.route);
  let routeText;
  if (route === null || route === 'NIL') routeText = 'NIL';
  else if (budget < 5) routeText = 'NIL';
  else routeText = clipRouteToBudget(route.split(' '), budget);

  const message = `${head}${routeText}${tail}`;
  return message.length <= MAX_ACARS_IN_CHARS ? message : message.slice(0, MAX_ACARS_IN_CHARS);
}

// ── Worked examples ──────────────────────────────────────────────────────────

const CASES = [
  {
    name: 'A — short route, fits whole',
    details: {
      v: 1,
      departure_icao: 'KSFO',
      destination_icao: 'KLAX',
      route: 'SSTIK3 BSR Q13 RZS KWANG2',
      initial_altitude_ft: 5000,
      squawk: '2451',
    },
  },
  {
    name: 'B — long route, must clip',
    details: {
      v: 1,
      departure_icao: 'EGLL',
      destination_icao: 'LFPG',
      route:
        'DET2F DET L6 DVR UL9 KONAN UL607 SPI UZ739 PIGOS UN872 LUMEN UM605 TANGO ' +
        'UP600 REVTU UL610 SITET UN862 BIBAX UM728 OKRIX UY111 LORKU RANUX6A',
      initial_altitude_ft: 5000,
      squawk: '5123',
    },
  },
  {
    name: 'C — no route on file (route === null)',
    details: {
      v: 1,
      departure_icao: 'SBGR',
      destination_icao: 'SBRJ',
      route: null,
      initial_altitude_ft: 4000,
      squawk: '0361',
    },
  },
  {
    name: 'D — route already the literal NIL clampRoute() emits',
    details: {
      v: 1,
      departure_icao: 'SBGR',
      destination_icao: 'SBRJ',
      route: 'NIL',
      initial_altitude_ft: 4000,
      squawk: '0361',
    },
  },
  {
    name: 'E — unknown airports, high initial altitude (boundary: FL form)',
    details: {
      v: 1,
      departure_icao: null,
      destination_icao: null,
      route: 'DCT',
      initial_altitude_ft: 18000,
      squawk: '7401',
    },
  },
  {
    name: 'F — single enormous token (no whitespace to clip on)',
    details: {
      v: 1,
      departure_icao: 'KJFK',
      destination_icao: 'EGLL',
      route: 'X'.repeat(400),
      initial_altitude_ft: 5000,
      squawk: '1234',
    },
  },
  {
    name: 'G — 900-char route at clampRoute()\'s own ceiling',
    details: {
      v: 1,
      departure_icao: 'KJFK',
      destination_icao: 'EGLL',
      route: `${'WAYPT ABCDE FIXES UN123 '.repeat(37).trim().slice(0, 897)}...`,
      initial_altitude_ft: 5000,
      squawk: '1234',
    },
  },
];

for (const c of CASES) {
  const out = buildCondensedClearanceMessage(c.details);
  console.log(`${c.name}`);
  console.log(`  len=${out.length}`);
  console.log(`  ${out}`);
  console.log('');
  if (out.length > MAX_ACARS_IN_CHARS) {
    console.error('FAIL: over the cap');
    process.exit(1);
  }
}

// ── Boundary sweep: never over the cap, for any route length ─────────────────

let worst = 0;
for (let n = 0; n <= 900; n++) {
  for (const sep of [' ', '']) {
    const route = Array.from({ length: n }, (_, i) => `F${i}`).join(sep).slice(0, 900);
    const out = buildCondensedClearanceMessage({
      v: 1,
      departure_icao: 'AAAA',
      destination_icao: 'BBBB',
      route,
      initial_altitude_ft: 5000,
      squawk: '7401',
    });
    worst = Math.max(worst, out.length);
    if (out.length > MAX_ACARS_IN_CHARS) {
      console.error(`FAIL at n=${n} sep=${JSON.stringify(sep)}: ${out.length}`);
      process.exit(1);
    }
  }
}
console.log(`boundary sweep: 1802 routes, longest output ${worst} chars, cap ${MAX_ACARS_IN_CHARS}`);
