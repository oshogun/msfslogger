import type { FlightState } from './types';

export const EVENT_TOPICS = ['status', 'flight-state', 'acars', 'flights-changed', 'navdata-demand'] as const;
export type EventTopic = typeof EVENT_TOPICS[number];

export function isEventTopic(s: string): s is EventTopic {
  return (EVENT_TOPICS as readonly string[]).includes(s);
}

/** Level-triggered flight/leg scope. plannedLegId is the effective leg. */
export interface FlightStatePayload {
  flightState: FlightState;
  currentFlightId: number | null;
  plannedLegId: number | null;
}

/** Invalidation hint for acars_messages rows; never the row itself. */
export interface AcarsHint {
  flightId: number | null;
  plannedLegId: number | null;
  messageId: number;
}

/** Serialises as {}. */
export type EmptyHint = Record<string, never>;

export interface EventPayloads {
  status: object;
  'flight-state': FlightStatePayload;
  acars: AcarsHint;
  'flights-changed': EmptyHint;
  'navdata-demand': EmptyHint;
}

export interface HubMessage { topic: EventTopic; data: string }
export type HubListener = (msg: HubMessage) => void;

interface Subscription {
  topics: Set<EventTopic>;
  listener: HubListener;
}

interface PendingPublish<T extends EventTopic = EventTopic> {
  topic: T;
  build: () => EventPayloads[T] | undefined;
}

/**
 * In-process pub/sub for pushing live state to connected SSE streams. No
 * queue, no persistence, no cross-process delivery — a listener that isn't
 * subscribed when publish() runs simply never sees that event, which is fine
 * here because every consumer opens with a snapshot of current state first.
 */
export class EventHub {
  private readonly subscriptions = new Set<Subscription>();
  private readonly pending = new Map<string, PendingPublish>();
  private flushScheduled = false;

  subscribe(topics: ReadonlySet<EventTopic>, listener: HubListener): () => void {
    const sub: Subscription = { topics: new Set(topics), listener };
    this.subscriptions.add(sub);

    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.subscriptions.delete(sub);
    };
  }

  publish<T extends EventTopic>(topic: T, payload: EventPayloads[T]): void {
    if (this.listenerCount(topic) === 0) return;

    const msg: HubMessage = { topic, data: JSON.stringify(payload) };
    // Snapshot first: an (un)subscribe triggered by a listener this publish
    // is calling must not affect the delivery already in progress.
    const targets = [...this.subscriptions].filter(sub => sub.topics.has(topic));
    for (const sub of targets) {
      try {
        sub.listener(msg);
      } catch (err) {
        console.warn('[Events] listener failed:', err);
      }
    }
  }

  publishDeferred<T extends EventTopic>(topic: T, key: string, build: () => EventPayloads[T] | undefined): void {
    const mapKey = `${topic}\u0000${key}`;
    // A repeat before the flush replaces `build` but keeps the entry's
    // original position in the Map, which preserves insertion order below.
    this.pending.set(mapKey, { topic, build } as PendingPublish);

    if (!this.flushScheduled) {
      this.flushScheduled = true;
      setImmediate(() => this.flush());
    }
  }

  private flush(): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    this.flushScheduled = false;

    for (const entry of entries) {
      if (this.listenerCount(entry.topic) === 0) continue;
      let result: EventPayloads[EventTopic] | undefined;
      try {
        result = entry.build();
      } catch (err) {
        console.warn('[Events] listener failed:', err);
        continue;
      }
      if (result === undefined) continue;
      this.publish(entry.topic, result);
    }
  }

  listenerCount(topic?: EventTopic): number {
    if (topic === undefined) return this.subscriptions.size;
    let count = 0;
    for (const sub of this.subscriptions) {
      if (sub.topics.has(topic)) count++;
    }
    return count;
  }
}
