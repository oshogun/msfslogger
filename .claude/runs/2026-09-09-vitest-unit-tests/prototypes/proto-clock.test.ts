import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { haversineNm } from '../src/geo';

describe('fake clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T12:00:00.000Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('fakes Date.now() and new Date().toISOString() together', () => {
    expect(Date.now()).toBe(Date.parse('2026-09-09T12:00:00.000Z'));
    expect(new Date().toISOString()).toBe('2026-09-09T12:00:00.000Z');
    vi.advanceTimersByTime(5000);
    expect(Date.now()).toBe(Date.parse('2026-09-09T12:00:05.000Z'));
    expect(new Date().toISOString()).toBe('2026-09-09T12:00:05.000Z');
    expect(new Date(Date.now()).toISOString()).toBe('2026-09-09T12:00:05.000Z');
  });

  it('runs real source', () => {
    expect(haversineNm(0, 0, 0, 1)).toBeCloseTo(60.04, 1);
  });
});
