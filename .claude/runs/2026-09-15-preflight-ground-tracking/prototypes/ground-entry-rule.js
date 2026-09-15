#!/usr/bin/env node
// ── Ground-entry decision prototype ──────────────────────────────────────────
//
// A reference oracle for design.md §1/§4: the same rule, written once here,
// against the frame sequences the real state machine will see. It exists so
// that the rule frozen in the design is known to be self-consistent before
// anyone implements it, and so the implementer of src/groundState.ts has a
// table to reproduce rather than a paragraph to interpret.
//
// Not wired into the build. No import from src/. Run under Node 20:
//   node .claude/runs/<run-id>/prototypes/ground-entry-rule.js
//
// Exits non-zero if any scenario disagrees with its expectation.

const GROUND_DEBOUNCE_FRAMES = 5;
const GROUND_SPEED_MAX_KTS = 1;
const AIRBORNE_DEBOUNCE_FRAMES = 3; // unchanged, mirrored from src/flightManager.ts

/** design.md §4 step 1 — the per-frame predicate, pure. */
function isParkedFrame(frame) {
  if (frame.simRunning === 0) return false;
  if (frame.simRunning === 3) return false;            // slew
  if (frame.onGround !== true) return false;
  if (!(frame.groundSpeedKnots < GROUND_SPEED_MAX_KTS)) return false;
  const enginesOff = frame.enginesRunning !== undefined && frame.enginesRunning === 0;
  const brakeSet = frame.parkingBrake === true;
  return enginesOff || brakeSet;                        // unknown telemetry -> false
}

/** design.md §4 step 2 — the debounce, as a fold over frames. */
function runGroundDebounce(frames) {
  let streak = 0;
  for (let i = 0; i < frames.length; i++) {
    streak = isParkedFrame(frames[i]) ? streak + 1 : 0;
    if (streak >= GROUND_DEBOUNCE_FRAMES) return i; // index of the frame that trips entry
  }
  return null;
}

/** The existing IDLE->FLYING rule, copied verbatim from src/flightManager.ts. */
function runAirborneDebounce(frames) {
  let streak = 0;
  for (let i = 0; i < frames.length; i++) {
    const inSlew = frames[i].simRunning === 3;
    if (!inSlew && !frames[i].onGround && frames[i].airspeedKnots > 30) {
      streak++;
      if (streak >= AIRBORNE_DEBOUNCE_FRAMES) return i;
    } else {
      streak = 0;
    }
    if (frames[i].simRunning === 0) streak = 0;
  }
  return null;
}

const base = {
  lat: 37.618, lon: -122.3755, altitudeFt: 13, airspeedKnots: 0, groundSpeedKnots: 0,
  headingDeg: 90, verticalSpeedFpm: 0, onGround: true, simRunning: 2, aircraft: 'Cessna 172',
};
const f = (over, n = 1) => Array.from({ length: n }, () => ({ ...base, ...over }));

const SCENARIOS = [
  {
    name: 'cold and dark at a gate — enters on the 5th frame, not the 4th',
    frames: f({ enginesRunning: 0, parkingBrake: true }, 8),
    expectEntryAt: 4,
  },
  {
    name: 'ready-for-taxi spawn: engines running, parking brake set — enters',
    frames: f({ enginesRunning: 2, parkingBrake: true }, 6),
    expectEntryAt: 4,
  },
  {
    name: 'engines running, brake released, stationary at the hold — never enters',
    frames: f({ enginesRunning: 2, parkingBrake: false }, 30),
    expectEntryAt: null,
  },
  {
    name: 'taxiing with the brake released — never enters',
    frames: f({ enginesRunning: 2, parkingBrake: false, groundSpeedKnots: 12 }, 30),
    expectEntryAt: null,
  },
  {
    name: 'engines off but rolling (towed/pushback, 3 kts) — never enters',
    frames: f({ enginesRunning: 0, parkingBrake: false, groundSpeedKnots: 3 }, 30),
    expectEntryAt: null,
  },
  {
    name: 'exactly at the speed threshold (1.0 kt) — never enters (strict <)',
    frames: f({ enginesRunning: 0, parkingBrake: true, groundSpeedKnots: 1 }, 30),
    expectEntryAt: null,
  },
  {
    name: 'just under the threshold (0.9 kt) — enters',
    frames: f({ enginesRunning: 0, parkingBrake: true, groundSpeedKnots: 0.9 }, 6),
    expectEntryAt: 4,
  },
  {
    name: 'a one-frame jolt resets the streak — entry slips by one frame',
    frames: [
      ...f({ enginesRunning: 0, parkingBrake: true }, 4),
      ...f({ enginesRunning: 0, parkingBrake: true, groundSpeedKnots: 4 }, 1),
      ...f({ enginesRunning: 0, parkingBrake: true }, 6),
    ],
    expectEntryAt: 9,
  },
  {
    name: 'slew at the gate (simRunning 3) — never enters, like IDLE->FLYING',
    frames: f({ enginesRunning: 0, parkingBrake: true, simRunning: 3 }, 30),
    expectEntryAt: null,
  },
  {
    name: 'sim stopped (simRunning 0) — never enters',
    frames: f({ enginesRunning: 0, parkingBrake: true, simRunning: 0 }, 30),
    expectEntryAt: null,
  },
  {
    name: 'OLD AGENT: no engine/brake fields at all — never enters, no crash',
    frames: f({}, 60),
    expectEntryAt: null,
  },
  {
    name: 'OLD AGENT parked and then updated mid-session — enters 5 frames after the first complete frame',
    frames: [...f({}, 10), ...f({ enginesRunning: 0, parkingBrake: true }, 6)],
    expectEntryAt: 14,
  },
  {
    name: 'cold-and-dark shutdown after a flight (engines cut at the gate)',
    frames: [
      ...f({ enginesRunning: 2, parkingBrake: false, groundSpeedKnots: 8 }, 5), // taxi in
      ...f({ enginesRunning: 2, parkingBrake: true }, 2),                       // brake set
      ...f({ enginesRunning: 0, parkingBrake: true }, 5),                       // shutdown
    ],
    expectEntryAt: 9,
  },
  {
    name: 'engines shut down IN THE AIR (flameout) — never enters, onGround is false',
    frames: f({ enginesRunning: 0, parkingBrake: false, onGround: false, airspeedKnots: 180, groundSpeedKnots: 175 }, 30),
    expectEntryAt: null,
  },
];

// The existing IDLE->FLYING rule must be untouched by any of the above: a
// takeoff sequence still trips at exactly the third airborne frame whether or
// not the new fields are present.
const TAKEOFF_WITHOUT_NEW_FIELDS = [
  ...f({ groundSpeedKnots: 0 }, 2),
  ...f({ onGround: false, airspeedKnots: 80, groundSpeedKnots: 78 }, 5),
];
const TAKEOFF_WITH_NEW_FIELDS = TAKEOFF_WITHOUT_NEW_FIELDS.map(fr => ({
  ...fr, enginesRunning: 2, parkingBrake: false,
}));

let failures = 0;
for (const s of SCENARIOS) {
  const got = runGroundDebounce(s.frames);
  const ok = got === s.expectEntryAt;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${s.name}\n        entry at ${got} (expected ${s.expectEntryAt})`);
}

const a = runAirborneDebounce(TAKEOFF_WITHOUT_NEW_FIELDS);
const b = runAirborneDebounce(TAKEOFF_WITH_NEW_FIELDS);
const airborneOk = a === 4 && b === 4;
if (!airborneOk) failures++;
console.log(`${airborneOk ? 'ok  ' : 'FAIL'}  IDLE->FLYING airborne debounce unchanged by the new fields\n        without=${a}, with=${b} (expected 4, 4)`);

console.log(`\n${SCENARIOS.length + 1 - failures}/${SCENARIOS.length + 1} checks passed`);
process.exit(failures === 0 ? 0 : 1);
