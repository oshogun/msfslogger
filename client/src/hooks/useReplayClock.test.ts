import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReplayClock } from './useReplayClock';
import type { FrameScheduler, TickReason } from './useReplayClock';

// A hand-stepped scheduler: each step() delivers one frame at the given time.
function makeScheduler() {
  let cb: ((t: number) => void) | null = null;
  let next = 1;
  const cancel = vi.fn((h: number) => {
    void h;
    cb = null;
  });
  const scheduler: FrameScheduler = {
    request(fn) {
      cb = fn;
      return next++;
    },
    cancel,
  };
  return {
    scheduler,
    cancel,
    pending: () => cb !== null,
    step(t: number) {
      const f = cb;
      cb = null;
      f?.(t);
    },
  };
}

function setup(over: { duration?: number; speed?: number } = {}) {
  const s = makeScheduler();
  const ticks: [number, TickReason][] = [];
  const onTick = (v: number, r: TickReason) => ticks.push([v, r]);
  const hook = renderHook(
    (props: { speed: number }) =>
      useReplayClock({
        virtualDurationSec: over.duration ?? 100,
        speed: props.speed,
        onTick,
        scheduler: s.scheduler,
      }),
    { initialProps: { speed: over.speed ?? 1 } }
  );
  const last = () => ticks[ticks.length - 1];
  return { s, ticks, hook, last };
}

// Runs frames every 16 ms from `from` for `ms`; returns the final timestamp.
function run(s: ReturnType<typeof makeScheduler>, from: number, ms: number) {
  let t = from;
  while (t < from + ms && s.pending()) {
    t += 16;
    act(() => s.step(t));
  }
  return t;
}

describe('useReplayClock', () => {
  it('advances virtual time while playing', () => {
    const { s, hook } = setup();
    act(() => hook.result.current.play());
    act(() => s.step(1000));
    run(s, 1000, 1000);
    expect(hook.result.current.getVirtualSec()).toBeGreaterThan(0.9);
    expect(hook.result.current.getVirtualSec()).toBeLessThan(1.1);
    expect(hook.result.current.playing).toBe(true);
  });

  it('multiplies by speed', () => {
    const { s, hook } = setup({ speed: 8 });
    act(() => hook.result.current.play());
    act(() => s.step(1000));
    run(s, 1000, 1000);
    expect(hook.result.current.getVirtualSec()).toBeGreaterThan(7.5);
    expect(hook.result.current.getVirtualSec()).toBeLessThan(8.5);
  });

  it('freezes on pause', () => {
    const { s, hook, ticks } = setup();
    act(() => hook.result.current.play());
    act(() => s.step(1000));
    const end = run(s, 1000, 500);
    act(() => hook.result.current.pause());
    const v = hook.result.current.getVirtualSec();
    const n = ticks.length;
    expect(s.pending()).toBe(false);
    run(s, end, 1000);
    expect(hook.result.current.getVirtualSec()).toBe(v);
    expect(ticks.length).toBe(n);
    expect(ticks[n - 1][1]).toBe('pause');
    expect(hook.result.current.playing).toBe(false);
  });

  it('keeps position when the speed changes mid-play', () => {
    const { s, hook } = setup();
    act(() => hook.result.current.play());
    act(() => s.step(1000));
    const end = run(s, 1000, 500);
    const before = hook.result.current.getVirtualSec();
    hook.rerender({ speed: 32 });
    expect(hook.result.current.getVirtualSec()).toBe(before);
    act(() => s.step(end + 16));
    expect(hook.result.current.getVirtualSec() - before).toBeCloseTo(0.016 * 32, 5);
  });

  it('stops at the end and reports finished', () => {
    const { s, hook, last } = setup({ duration: 2, speed: 4 });
    act(() => hook.result.current.play());
    act(() => s.step(1000));
    run(s, 1000, 2000);
    expect(hook.result.current.playing).toBe(false);
    expect(hook.result.current.finished).toBe(true);
    expect(last()).toEqual([2, 'end']);
    expect(s.pending()).toBe(false);
  });

  it('restarts from 0 when played after finishing', () => {
    const { s, hook } = setup({ duration: 2, speed: 4 });
    act(() => hook.result.current.play());
    act(() => s.step(1000));
    run(s, 1000, 2000);
    expect(hook.result.current.finished).toBe(true);
    act(() => hook.result.current.play());
    expect(hook.result.current.finished).toBe(false);
    expect(hook.result.current.playing).toBe(true);
    expect(hook.result.current.getVirtualSec()).toBe(0);
  });

  it('seekTo clamps and leaves playing alone', () => {
    const { hook, last } = setup({ duration: 10 });
    act(() => hook.result.current.seekTo(50));
    expect(hook.result.current.getVirtualSec()).toBe(10);
    expect(last()).toEqual([10, 'seek']);
    act(() => hook.result.current.seekTo(-5));
    expect(hook.result.current.getVirtualSec()).toBe(0);
    expect(hook.result.current.playing).toBe(false);
  });

  it('keeps playing while scrubbing', () => {
    const { s, hook } = setup({ duration: 10 });
    act(() => hook.result.current.play());
    act(() => hook.result.current.seekTo(5));
    expect(hook.result.current.playing).toBe(true);
    expect(s.pending()).toBe(true);
  });

  it('seekBy is relative and clamped', () => {
    const { hook } = setup({ duration: 10 });
    act(() => hook.result.current.seekBy(4));
    act(() => hook.result.current.seekBy(4));
    expect(hook.result.current.getVirtualSec()).toBe(8);
    act(() => hook.result.current.seekBy(100));
    expect(hook.result.current.getVirtualSec()).toBe(10);
    act(() => hook.result.current.seekBy(-100));
    expect(hook.result.current.getVirtualSec()).toBe(0);
  });

  it('ends immediately when the duration is 0', () => {
    const { hook, ticks } = setup({ duration: 0 });
    act(() => hook.result.current.play());
    expect(ticks).toEqual([[0, 'end']]);
    expect(hook.result.current.finished).toBe(true);
    expect(hook.result.current.playing).toBe(false);
  });

  it('cancels the pending frame on unmount', () => {
    const { s, hook } = setup();
    act(() => hook.result.current.play());
    expect(s.pending()).toBe(true);
    hook.unmount();
    expect(s.cancel).toHaveBeenCalled();
    expect(s.pending()).toBe(false);
  });

  it('limits a frame after a long stall to 0.25 s of virtual time per speed unit', () => {
    const { s, hook } = setup({ speed: 8 });
    act(() => hook.result.current.play());
    act(() => s.step(1000));
    act(() => s.step(1000 + 60_000));
    expect(hook.result.current.getVirtualSec()).toBeCloseTo(0.25 * 8);
  });

  describe('with the default rAF under fake timers', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('advances and freezes', () => {
      const onTick = vi.fn();
      const { result } = renderHook(() =>
        useReplayClock({ virtualDurationSec: 100, speed: 2, onTick })
      );
      act(() => result.current.play());
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      const v = result.current.getVirtualSec();
      expect(v).toBeGreaterThan(1.5);
      act(() => result.current.pause());
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current.getVirtualSec()).toBe(v);
    });
  });
});
