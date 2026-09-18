// Prototype for design.md section 6.5 — normalising comm_history[].stamp_zulu
// into the ISO-8601 UTC string acars_messages.sent_at requires.
//
// Run: node .claude/runs/2026-09-17-sayintentions-integration/prototypes/stamp.js
//
// SayIntentions does not document stamp_zulu's format, so the rule must be
// total over every plausible one and must never throw. FALLBACK is what the
// route passes in (the import's own wall clock).

const FALLBACK = '2026-09-17T12:00:00.000Z';

function normaliseStampZulu(raw, fallbackIso) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? fallbackIso : d.toISOString();
  }
  if (typeof raw !== 'string') return fallbackIso;
  const t = raw.trim();
  if (t === '') return fallbackIso;

  // 'YYYY-MM-DD HH:MM:SS' and friends: make the separator T, and mark it UTC
  // when it carries no zone at all. "zulu" in the field name is the only
  // statement of intent there is, so an unzoned stamp is read as UTC.
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(:(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(t);
  const candidate = m ? `${t.replace(' ', 'T')}${m[9] ? '' : 'Z'}` : t;

  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? fallbackIso : d.toISOString();
}

const CASES = [
  '2026-09-17 14:33:12',
  '2026-09-17T14:33:12',
  '2026-09-17T14:33:12Z',
  '2026-09-17T14:33:12.482Z',
  '2026-09-17 14:33',
  '2026-09-17T14:33:12+02:00',
  '2026/09/17 14:33:12',
  '17 Sep 2026 14:33:12 GMT',
  1789654392,
  1789654392000,
  '',
  '   ',
  'not a date',
  null,
  undefined,
  { nope: true },
  NaN,
];

for (const c of CASES) {
  console.log(`${JSON.stringify(c) ?? String(c)}  ->  ${normaliseStampZulu(c, FALLBACK)}`);
}
