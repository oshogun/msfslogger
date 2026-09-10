// tests/loginThrottle.test.ts — design.md §16.2 (run 2026-09-10-security-hardening).
//
// LoginThrottle is pure in-memory state, no DB and no express, so nothing is
// mocked here — only the clock is faked (helpers.useFakeClock/useRealClock),
// matching the pattern in tests/flightManager.duration.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginThrottle } from '../src/auth/middleware';
import { useFakeClock, useRealClock } from './helpers';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

describe('LoginThrottle (design §16.2)', () => {
  let throttle: LoginThrottle;

  beforeEach(() => {
    useFakeClock();
    throttle = new LoginThrottle();
  });
  afterEach(() => useRealClock());

  it('check() returns null on an empty map', () => {
    expect(throttle.check('1.2.3.4', Date.now())).toBeNull();
  });

  it('returns a positive integer seconds wait after MAX_FAILURES recordFailure calls', () => {
    const ip = '10.0.0.5';
    for (let i = 0; i < MAX_FAILURES; i++) {
      throttle.recordFailure(ip, Date.now());
    }
    const wait = throttle.check(ip, Date.now());
    expect(Number.isInteger(wait)).toBe(true);
    expect(wait).toBeGreaterThan(0);
  });

  it('the wait decreases as time advances, but an eleventh failure does not move the window start', () => {
    const ip = '10.0.0.6';
    for (let i = 0; i < MAX_FAILURES; i++) {
      throttle.recordFailure(ip, Date.now());
    }
    const waitAtStart = throttle.check(ip, Date.now())!;
    expect(waitAtStart).toBe(Math.ceil(WINDOW_MS / 1000));

    vi.advanceTimersByTime(5 * 60 * 1000); // 5 minutes in
    const waitAfterFiveMin = throttle.check(ip, Date.now())!;
    expect(waitAfterFiveMin).toBeLessThan(waitAtStart);

    // An eleventh failure while still locked out must not reset windowStart —
    // the wait must continue to reflect the ORIGINAL window, not a fresh one.
    throttle.recordFailure(ip, Date.now());
    const waitAfterEleventh = throttle.check(ip, Date.now())!;
    expect(waitAfterEleventh).toBeCloseTo(waitAfterFiveMin, 0);
    expect(waitAfterEleventh).toBeLessThan(waitAtStart);
  });

  it('the entry is dropped once WINDOW_MS has elapsed', () => {
    const ip = '10.0.0.7';
    for (let i = 0; i < MAX_FAILURES; i++) {
      throttle.recordFailure(ip, Date.now());
    }
    expect(throttle.check(ip, Date.now())).not.toBeNull();

    vi.advanceTimersByTime(WINDOW_MS);
    expect(throttle.check(ip, Date.now())).toBeNull();
  });

  it('recordSuccess deletes the entry', () => {
    const ip = '10.0.0.8';
    for (let i = 0; i < MAX_FAILURES; i++) {
      throttle.recordFailure(ip, Date.now());
    }
    expect(throttle.check(ip, Date.now())).not.toBeNull();

    throttle.recordSuccess(ip);
    expect(throttle.check(ip, Date.now())).toBeNull();
  });

  it('bounds the map: 1001 entries with elapsed windows are pruned on the next check()', () => {
    const now = Date.now();
    for (let i = 0; i < 1001; i++) {
      throttle.recordFailure(`10.0.1.${i}`, now);
    }
    // Reach into the private Map to observe the invariant directly — the
    // design names the Map's size as the bounding trigger (§16.2), so this is
    // the thing under test, not an implementation detail.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internals = throttle as unknown as { entries: Map<string, unknown> };
    expect(internals.entries.size).toBe(1001);

    vi.advanceTimersByTime(WINDOW_MS); // every one of the 1001 windows has now elapsed
    throttle.check('probe-ip', Date.now());

    expect(internals.entries.size).toBe(0);
  });
});
