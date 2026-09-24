import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface FrameScheduler {
  request(cb: (timeMs: number) => void): number;
  cancel(handle: number): void;
}

export type TickReason = 'frame' | 'seek' | 'play' | 'pause' | 'end';

export interface UseReplayClockOptions {
  virtualDurationSec: number;
  speed: number;
  onTick: (virtualSec: number, reason: TickReason) => void;
  scheduler?: FrameScheduler;
}

export interface ReplayClock {
  playing: boolean;
  finished: boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  seekTo(virtualSec: number): void;
  seekBy(deltaSec: number): void;
  restart(): void;
  getVirtualSec(): number;
}

// A backgrounded tab delivers one huge frame delta on return; clamp it so the
// replay resumes where it paused instead of leaping toward the end.
const MAX_FRAME_DT_SEC = 0.25;

const defaultScheduler: FrameScheduler = {
  request: cb => globalThis.requestAnimationFrame(cb),
  cancel: h => globalThis.cancelAnimationFrame(h),
};

export function useReplayClock(opts: UseReplayClockOptions): ReplayClock {
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);

  const virtualRef = useRef(0);
  const playingRef = useRef(false);
  const finishedRef = useRef(false);
  const handleRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);

  const speedRef = useRef(opts.speed);
  const onTickRef = useRef(opts.onTick);
  const durationRef = useRef(opts.virtualDurationSec);
  const schedulerRef = useRef<FrameScheduler>(opts.scheduler ?? defaultScheduler);
  speedRef.current = opts.speed;
  onTickRef.current = opts.onTick;
  durationRef.current = opts.virtualDurationSec;
  schedulerRef.current = opts.scheduler ?? defaultScheduler;

  const setFinishedBoth = useCallback((v: boolean) => {
    finishedRef.current = v;
    setFinished(v);
  }, []);
  const setPlayingBoth = useCallback((v: boolean) => {
    playingRef.current = v;
    setPlaying(v);
  }, []);

  const cancelFrame = useCallback(() => {
    if (handleRef.current !== null) {
      schedulerRef.current.cancel(handleRef.current);
      handleRef.current = null;
    }
  }, []);

  const finish = useCallback(() => {
    cancelFrame();
    virtualRef.current = durationRef.current;
    setPlayingBoth(false);
    setFinishedBoth(true);
    onTickRef.current(durationRef.current, 'end');
  }, [cancelFrame, setPlayingBoth, setFinishedBoth]);

  const frame = useCallback(
    (t: number) => {
      handleRef.current = null;
      if (!playingRef.current) return;
      const last = lastFrameRef.current;
      lastFrameRef.current = t;
      const dt = last === null ? 0 : Math.min(Math.max((t - last) / 1000, 0), MAX_FRAME_DT_SEC);
      const next = virtualRef.current + dt * speedRef.current;
      if (next >= durationRef.current) {
        finish();
        return;
      }
      virtualRef.current = next;
      onTickRef.current(next, 'frame');
      handleRef.current = schedulerRef.current.request(frame);
    },
    [finish]
  );

  const play = useCallback(() => {
    if (playingRef.current) return;
    if (finishedRef.current) {
      virtualRef.current = 0;
      setFinishedBoth(false);
    }
    if (durationRef.current <= 0) {
      finish();
      return;
    }
    lastFrameRef.current = null;
    setPlayingBoth(true);
    onTickRef.current(virtualRef.current, 'play');
    cancelFrame();
    handleRef.current = schedulerRef.current.request(frame);
  }, [cancelFrame, finish, frame, setFinishedBoth, setPlayingBoth]);

  const pause = useCallback(() => {
    cancelFrame();
    setPlayingBoth(false);
    onTickRef.current(virtualRef.current, 'pause');
  }, [cancelFrame, setPlayingBoth]);

  const seekTo = useCallback(
    (x: number) => {
      const d = durationRef.current;
      const v = Number.isNaN(x) ? 0 : Math.min(Math.max(x, 0), d);
      virtualRef.current = v;
      if (v < d && finishedRef.current) setFinishedBoth(false);
      onTickRef.current(v, 'seek');
    },
    [setFinishedBoth]
  );

  const seekBy = useCallback((delta: number) => seekTo(virtualRef.current + delta), [seekTo]);
  const toggle = useCallback(() => (playingRef.current ? pause() : play()), [pause, play]);
  const restart = useCallback(() => {
    seekTo(0);
    play();
  }, [play, seekTo]);
  const getVirtualSec = useCallback(() => virtualRef.current, []);

  useEffect(() => cancelFrame, [cancelFrame]);

  return useMemo(
    () => ({ playing, finished, play, pause, toggle, seekTo, seekBy, restart, getVirtualSec }),
    [playing, finished, play, pause, toggle, seekTo, seekBy, restart, getVirtualSec]
  );
}
