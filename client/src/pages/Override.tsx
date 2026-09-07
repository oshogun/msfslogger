import { useState, useRef, useEffect } from 'react';

type Phase = 'idle' | 'held' | 'struggling' | 'releasing';

const HOLD_MS_MIN = 700;
const HOLD_MS_MAX = 1200;
const STRUGGLE_MS_MIN = 3200;
const STRUGGLE_MS_MAX = 4400;

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi);
}

export function Override() {
  const [on, setOn] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const initialPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const [cursor, setCursor] = useState(initialPos);
  const posRef = useRef(initialPos);
  const frameRef = useRef<HTMLDivElement>(null);
  const switchRef = useRef<HTMLButtonElement>(null);
  const phaseRef = useRef<Phase>('idle');
  const timers = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => { document.title = 'The Override'; }, []);

  // Every phase change goes through here so phaseRef is current the instant
  // the phase is, not one commit later. The rAF loop and the mousemove
  // handler both read the ref to decide whether they still apply, and both
  // can run before React has committed a setPhase: syncing the ref from an
  // effect instead would let the first frame of the struggle read 'held',
  // bail out without rescheduling, and strand the page mid-struggle with the
  // switch disabled and the pointer locked.
  function enterPhase(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function moveCursor(x: number, y: number) {
    const next = { x: clamp(x, 12, window.innerWidth - 12), y: clamp(y, 12, window.innerHeight - 12) };
    posRef.current = next;
    setCursor(next);
  }

  function stopAll() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  // The real cursor stays hidden on this page from the moment it mounts, and
  // this fake one stands in for it throughout — so there's no icon swap when
  // pointer lock actually engages. Idle tracks the real (absolute) position;
  // once locked, only relative movementX/Y are available, and during the
  // struggle those deltas are the user's only leverage against the pull.
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (phaseRef.current === 'idle') {
        moveCursor(e.clientX, e.clientY);
      } else if (phaseRef.current === 'held' || phaseRef.current === 'struggling') {
        moveCursor(posRef.current.x + e.movementX, posRef.current.y + e.movementY);
      }
    }
    function onLockChange() {
      if (document.pointerLockElement !== frameRef.current && phaseRef.current !== 'idle') {
        stopAll();
        enterPhase('idle');
        setOn(false);
      }
    }
    function onLockError() {
      stopAll();
      enterPhase('idle');
      setOn(false);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('pointerlockerror', onLockError);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
    };
  }, []);

  useEffect(() => stopAll, []);

  // A tug of war: every frame it drags the cursor a little closer to the
  // switch, and the pull strengthens as the deadline nears. Real mouse
  // movement (via onMove above) can pull it back out — but the deadline is
  // absolute, so however hard you resist, it reaches the switch in the end.
  function startStruggle() {
    const duration = STRUGGLE_MS_MIN + Math.random() * (STRUGGLE_MS_MAX - STRUGGLE_MS_MIN);
    const startedAt = performance.now();
    enterPhase('struggling');

    function frame(now: number) {
      if (phaseRef.current !== 'struggling') return;
      const rect = switchRef.current?.getBoundingClientRect();
      if (!rect) {
        // No switch to pull towards this frame; keep the loop alive rather
        // than abandoning the struggle it is the only way out of.
        rafRef.current = requestAnimationFrame(frame);
        return;
      }
      const targetX = rect.left + rect.width / 2;
      const targetY = rect.top + rect.height / 2;
      const t = Math.min((now - startedAt) / duration, 1);
      const dx = targetX - posRef.current.x;
      const dy = targetY - posRef.current.y;

      if (t >= 1 || Math.hypot(dx, dy) < 3) {
        moveCursor(targetX, targetY);
        finishStruggle();
        return;
      }

      const pull = 0.015 + t * t * 0.35;
      moveCursor(posRef.current.x + dx * pull, posRef.current.y + dy * pull);
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
  }

  function finishStruggle() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    enterPhase('releasing');
    setOn(false);
    timers.current.push(window.setTimeout(() => {
      document.exitPointerLock();
      enterPhase('idle');
    }, 220));
  }

  function engage(e: React.MouseEvent) {
    if (phase !== 'idle' || on) return;

    moveCursor(e.clientX, e.clientY);
    setOn(true);
    enterPhase('held');
    frameRef.current?.requestPointerLock();

    const holdMs = HOLD_MS_MIN + Math.random() * (HOLD_MS_MAX - HOLD_MS_MIN);
    timers.current.push(window.setTimeout(startStruggle, holdMs));
  }

  const resisting = phase === 'struggling' || phase === 'releasing';

  return (
    <main className="device-page override-page">
      <div ref={frameRef} className={`device-frame${on ? ' is-engaged' : ''}`}>
        <div className="device-head">
          <div>
            <div className="device-title">THE OVERRIDE</div>
            <div className="device-sub">UNIT 0x7F3B · REV A</div>
            <div className="device-sub">DOES NOT ACCEPT INSTRUCTION</div>
          </div>
          <div className={`device-state${on ? ' is-engaged' : ''}${resisting ? ' is-resisting' : ''}`}>
            {resisting ? 'RESISTING' : on ? 'ENGAGED' : 'DORMANT'}
          </div>
        </div>

        <button
          ref={switchRef}
          type="button"
          className={`device-switch${on ? ' is-engaged' : ''}`}
          onClick={engage}
          disabled={phase !== 'idle'}
          role="switch"
          aria-checked={on}
          aria-label="The Override"
        >
          <span className="device-switch-track">
            <span className="device-switch-knob" />
          </span>
        </button>

        <div className="device-footer">
          {phase === 'held' && 'You are not in control of this.'}
          {phase === 'struggling' && 'Pull as hard as you like.'}
          {phase === 'releasing' && 'It always wins.'}
          {phase === 'idle' && (on ? 'Engaged.' : 'Disengaged.')}
        </div>
      </div>

      <div
        className={`ghost-cursor${resisting ? ' is-auto' : ''}`}
        style={{ left: cursor.x, top: cursor.y }}
      />
    </main>
  );
}
