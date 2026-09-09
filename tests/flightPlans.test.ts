// tests/flightPlans.test.ts — src/flightPlans.ts, T-004.
//
// Only isPdfBuffer() and flightPlanPath() are pure — no fs I/O. Everything
// else in src/flightPlans.ts (ensureFlightPlansDir, saveFlightPlanFile,
// deleteFlightPlanFile, copyFlightPlanFile) touches fs and is out of scope
// per design.md §10.3. This file does not import 'fs'.

import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { flightPlanPath, isPdfBuffer } from '../src/flightPlans';

describe('flightPlanPath', () => {
  it('joins process.cwd()/flight_plans/<flightId>.pdf', () => {
    expect(flightPlanPath(42)).toBe(path.join(process.cwd(), 'flight_plans', '42.pdf'));
  });

  it('uses the flight id verbatim in the filename for other ids', () => {
    expect(flightPlanPath(7)).toBe(path.join(process.cwd(), 'flight_plans', '7.pdf'));
    expect(flightPlanPath(1000)).toBe(path.join(process.cwd(), 'flight_plans', '1000.pdf'));
  });
});

describe('isPdfBuffer', () => {
  it("returns true for a buffer starting with '%PDF-'", () => {
    expect(isPdfBuffer(Buffer.from('%PDF-1.4 rest of file'))).toBe(true);
  });

  it('returns false for a buffer shorter than 5 bytes', () => {
    expect(isPdfBuffer(Buffer.from('%PDF'))).toBe(false); // 4 bytes
  });

  it('returns false for an empty buffer', () => {
    expect(isPdfBuffer(Buffer.alloc(0))).toBe(false);
  });

  it("returns false when '%PDF-' appears at a non-zero offset", () => {
    expect(isPdfBuffer(Buffer.from('XX%PDF-rest'))).toBe(false);
  });
});
