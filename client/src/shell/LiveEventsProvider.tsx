import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type MutableRefObject, type ReactNode,
} from 'react';
import { apiFetch, UnauthorizedError } from '../utils/api';
import type { FlightStateEvent, LiveBatch, LiveTopic, Status } from '../types';

export const LIVE_EVENTS_URL = '/api/events?topics=status,flight-state,flights-changed,acars';
/** Cadence of the /api/status probe while the stream stays refused for a reason other than the hub limit. */
export const EVENTS_RETRY_MS = 3_000;
/** How long a hidden tab is given before its stream is closed deliberately. */
export const HIDDEN_CLOSE_DELAY_MS = 30_000;
/** Trailing debounce per registered handler; one refetch per burst of triggers. */
export const LIVE_HANDLER_DEBOUNCE_MS = 100;
/** First wait before reopening the stream after a refused/closed connection. */
export const EVENTS_CLOSED_RETRY_MIN_MS = 5_000;
/** Cap the backoff doubles at. */
export const EVENTS_CLOSED_RETRY_MAX_MS = 30_000;

const READY_STATE_CONNECTING = 0;

type HandlerRef = MutableRefObject<(batch: LiveBatch) => void>;

interface Registration {
  topics: Set<LiveTopic>;
  handlerRef: HandlerRef;
  pending: { topic: LiveTopic; data: unknown }[];
  reconnected: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

type RegisterHandler = (topics: Set<LiveTopic>, handlerRef: HandlerRef) => () => void;

const noopRegister: RegisterHandler = () => () => {};

interface LiveEventsValue {
  status: Status | null;
  flightState: FlightStateEvent | null;
  serverError: boolean;
}

const INERT_VALUE: LiveEventsValue = { status: null, flightState: null, serverError: false };

const LiveEventsContext = createContext<LiveEventsValue>(INERT_VALUE);
// Kept apart from LiveEventsContext so a component that only registers a
// refetch handler (useLiveEvent) never re-renders on the 1 Hz status/
// flight-state churn that every useLiveEvents() consumer lives with.
const RegistryContext = createContext<RegisterHandler>(noopRegister);

export function LiveEventsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [flightState, setFlightState] = useState<FlightStateEvent | null>(null);
  const [serverError, setServerError] = useState(false);

  const registrationsRef = useRef<Set<Registration>>(new Set());

  const registerHandler = useCallback<RegisterHandler>((topics, handlerRef) => {
    const reg: Registration = { topics, handlerRef, pending: [], reconnected: false, timer: null };
    registrationsRef.current.add(reg);
    return () => {
      if (reg.timer) clearTimeout(reg.timer);
      registrationsRef.current.delete(reg);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let closedForHidden = false;
    let closedRetryMs = EVENTS_CLOSED_RETRY_MIN_MS;
    // Bumped by anything that supersedes a pending reconnect attempt (a fresh
    // connect(), or the deliberate hidden-tab close). A probe's apiFetch can
    // still be in flight when that happens; it checks this on the way back
    // in and drops its own connect() if it no longer matches.
    let epoch = 0;

    const esRef: { current: EventSource | null } = { current: null };
    let closedRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let probeRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;

    function clearClosedRetryTimer() {
      if (closedRetryTimer) { clearTimeout(closedRetryTimer); closedRetryTimer = null; }
    }
    function clearProbeRetryTimer() {
      if (probeRetryTimer) { clearTimeout(probeRetryTimer); probeRetryTimer = null; }
    }
    function clearHiddenTimer() {
      if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
    }
    // Cancels any pending backoff/probe retry and invalidates whatever probe
    // might already be in flight from one, so it can't open a stream behind
    // whatever caller is about to take over reconnecting.
    function invalidatePendingReconnect() {
      epoch++;
      clearClosedRetryTimer();
      clearProbeRetryTimer();
    }

    function scheduleFire(reg: Registration) {
      if (reg.timer) clearTimeout(reg.timer);
      reg.timer = setTimeout(() => {
        const batch: LiveBatch = { reconnected: reg.reconnected, events: reg.pending };
        reg.pending = [];
        reg.reconnected = false;
        reg.timer = null;
        reg.handlerRef.current(batch);
      }, LIVE_HANDLER_DEBOUNCE_MS);
    }

    function dispatchEvent(topic: LiveTopic, data: unknown) {
      for (const reg of registrationsRef.current) {
        if (reg.topics.has(topic)) {
          reg.pending.push({ topic, data });
          scheduleFire(reg);
        }
      }
    }

    // Every handler, whatever its topics — the refetch-on-reconnect closes
    // the fetch-then-subscribe race, at the cost of one extra fetch.
    function triggerReconnectRefetch() {
      for (const reg of registrationsRef.current) {
        reg.reconnected = true;
        scheduleFire(reg);
      }
    }

    function disposeSource() {
      const es = esRef.current;
      if (es) {
        es.removeEventListener('open', onOpen);
        es.removeEventListener('error', onError);
        es.removeEventListener('status', onStatusMessage);
        es.removeEventListener('flight-state', onFlightStateMessage);
        es.removeEventListener('flights-changed', onFlightsChangedMessage);
        es.removeEventListener('acars', onAcarsMessage);
        es.close();
      }
      esRef.current = null;
    }

    function onOpen() {
      setServerError(false);
      closedRetryMs = EVENTS_CLOSED_RETRY_MIN_MS;
      triggerReconnectRefetch();
    }

    function onError() {
      const es = esRef.current;
      if (!es) return;
      if (es.readyState === READY_STATE_CONNECTING) {
        // A network blip: the server's own `retry: 3000` reopens it, nothing to do here.
        setServerError(true);
        return;
      }
      setServerError(true);
      disposeSource();
      const delay = closedRetryMs;
      closedRetryMs = Math.min(closedRetryMs * 2, EVENTS_CLOSED_RETRY_MAX_MS);
      clearClosedRetryTimer();
      closedRetryTimer = setTimeout(probe, delay);
    }

    function parsePayload(topic: LiveTopic, e: MessageEvent): { ok: true; data: unknown } | { ok: false } {
      try {
        return { ok: true, data: JSON.parse(e.data) };
      } catch (err) {
        console.error(`live event: could not parse ${topic} payload`, err);
        return { ok: false };
      }
    }

    function onStatusMessage(e: MessageEvent) {
      const parsed = parsePayload('status', e);
      if (!parsed.ok) return;
      setStatus(parsed.data as Status);
      dispatchEvent('status', parsed.data);
    }
    function onFlightStateMessage(e: MessageEvent) {
      const parsed = parsePayload('flight-state', e);
      if (!parsed.ok) return;
      setFlightState(parsed.data as FlightStateEvent);
      dispatchEvent('flight-state', parsed.data);
    }
    function onFlightsChangedMessage(e: MessageEvent) {
      const parsed = parsePayload('flights-changed', e);
      if (parsed.ok) dispatchEvent('flights-changed', parsed.data);
    }
    function onAcarsMessage(e: MessageEvent) {
      const parsed = parsePayload('acars', e);
      if (parsed.ok) dispatchEvent('acars', parsed.data);
    }

    function connect() {
      invalidatePendingReconnect();
      disposeSource();
      if (disposed) return;
      const es = new EventSource(LIVE_EVENTS_URL);
      esRef.current = es;
      es.addEventListener('open', onOpen);
      es.addEventListener('error', onError);
      es.addEventListener('status', onStatusMessage);
      es.addEventListener('flight-state', onFlightStateMessage);
      es.addEventListener('flights-changed', onFlightsChangedMessage);
      es.addEventListener('acars', onAcarsMessage);
    }

    function probe() {
      if (disposed) return;
      const myEpoch = epoch;
      apiFetch<Status>('/api/status')
        .then(s => {
          // A newer connect() or the hidden-tab close already took over
          // while this fetch was in flight — do not open a stream on top of
          // (or instead of) whatever that did.
          if (disposed || myEpoch !== epoch) return;
          setStatus(s);
          connect();
        })
        .catch(err => {
          if (disposed || myEpoch !== epoch) return;
          if (err instanceof UnauthorizedError) return; // apiFetch already fired the login redirect
          probeRetryTimer = setTimeout(probe, EVENTS_RETRY_MS);
        });
    }

    function onVisibilityChange() {
      if (document.hidden) {
        clearHiddenTimer();
        hiddenTimer = setTimeout(() => {
          disposeSource();
          invalidatePendingReconnect();
          closedForHidden = true;
        }, HIDDEN_CLOSE_DELAY_MS);
        return;
      }
      clearHiddenTimer();
      if (closedForHidden) {
        closedForHidden = false;
        connect();
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    connect();
    // A tab that is already hidden when this mounts (e.g. opened in a
    // background tab) gets no 'visibilitychange' event to arm the close
    // timer with — run the same check by hand once, up front.
    if (document.hidden) onVisibilityChange();

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearHiddenTimer();
      clearClosedRetryTimer();
      clearProbeRetryTimer();
      disposeSource();
    };
  }, []);

  return (
    <RegistryContext.Provider value={registerHandler}>
      <LiveEventsContext.Provider value={{ status, flightState, serverError }}>
        {children}
      </LiveEventsContext.Provider>
    </RegistryContext.Provider>
  );
}

/** Replaces the old useStatus poll: same {status, serverError} meaning. */
export function useLiveEvents(): LiveEventsValue {
  return useContext(LiveEventsContext);
}

/**
 * Registers `handler` for `topics` and for the reconnect refetch. `handler`
 * is read from a ref at fire time, so passing a fresh inline arrow every
 * render never re-registers. A no-op outside a provider.
 */
export function useLiveEvent(topics: readonly LiveTopic[], handler: (batch: LiveBatch) => void): void {
  const register = useContext(RegistryContext);
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  const topicsKey = topics.join(',');
  useEffect(() => {
    const topicSet = new Set(topicsKey.split(',') as LiveTopic[]);
    return register(topicSet, handlerRef);
    // topicsKey stands in for `topics` here on purpose: an inline array
    // literal gets a new identity every render, which would tear down and
    // rebuild the registration (and drop whatever was mid-debounce) even
    // though the actual topic list never changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, topicsKey]);
}
