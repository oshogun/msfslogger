// tests/eventHub.test.ts — src/eventHub.ts: topic filtering, the cleanup
// guarantee (T-009 re-checks listenerCount() for leak-free reconnects), and
// publishDeferred coalescing. No mocks: EventHub has no imports besides a
// type, so it is exercised directly.

import { describe, it, expect, vi } from 'vitest';
import { EventHub, isEventTopic, EVENT_TOPICS } from '../src/eventHub';
import type { HubMessage } from '../src/eventHub';

/** Waits for the hub's pending setImmediate flush to have run. A second
 *  setImmediate queued after the hub's own is guaranteed to run after it —
 *  same macrotask queue, FIFO within it. */
function afterFlush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('isEventTopic()', () => {
  it('accepts every declared topic', () => {
    for (const t of EVENT_TOPICS) expect(isEventTopic(t)).toBe(true);
  });

  it('rejects an unknown string', () => {
    expect(isEventTopic('bogus')).toBe(false);
    expect(isEventTopic('')).toBe(false);
  });
});

describe('EventHub — subscribe/publish filtering', () => {
  it('a listener subscribed to a subset never receives a publish on a topic it did not ask for, and receives every publish on a topic it did', () => {
    const hub = new EventHub();
    const received: HubMessage[] = [];
    hub.subscribe(new Set(['flight-state', 'acars']), msg => received.push(msg));

    hub.publish('status', {});
    hub.publish('status', {});
    hub.publish('status', {});
    expect(received.filter(m => m.topic === 'status')).toHaveLength(0);

    hub.publish('flight-state', { flightState: 'IDLE', currentFlightId: null, plannedLegId: null });
    hub.publish('acars', { flightId: 1, plannedLegId: null, messageId: 9 });
    expect(received.map(m => m.topic)).toEqual(['flight-state', 'acars']);
  });

  it('mutating the caller\'s own Set after subscribe() changes nothing', () => {
    const hub = new EventHub();
    const topics = new Set<'status' | 'acars'>(['status']);
    const received: HubMessage[] = [];
    hub.subscribe(topics, msg => received.push(msg));

    topics.add('acars');
    hub.publish('acars', { flightId: null, plannedLegId: 5, messageId: 1 });

    expect(received).toHaveLength(0);
  });

  it('the same listener function subscribed twice is two subscriptions, called twice', () => {
    const hub = new EventHub();
    const listener = vi.fn();
    hub.subscribe(new Set(['status']), listener);
    hub.subscribe(new Set(['status']), listener);

    hub.publish('status', {});

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('serialises the payload exactly once and delivers the identical HubMessage to every matching listener, in subscription order', () => {
    const hub = new EventHub();
    const order: string[] = [];
    hub.subscribe(new Set(['status']), () => order.push('first'));
    hub.subscribe(new Set(['status']), () => order.push('second'));

    let stringifyCalls = 0;
    const payload = {
      get x() { stringifyCalls++; return 1; },
    };
    hub.publish('status', payload as unknown as object);

    expect(order).toEqual(['first', 'second']);
    expect(stringifyCalls).toBe(1);
  });

  it('never calls JSON.stringify when a topic has zero listeners', () => {
    const hub = new EventHub();
    hub.subscribe(new Set(['acars']), () => {});
    let getterCalls = 0;
    const payload = { get x() { getterCalls++; return 1; } };

    hub.publish('status', payload as unknown as object);

    expect(getterCalls).toBe(0);
  });

  it('a throwing listener is caught and logged; the remaining listeners still run and publish never throws', () => {
    const hub = new EventHub();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const order: string[] = [];
    hub.subscribe(new Set(['status']), () => { throw new Error('boom'); });
    hub.subscribe(new Set(['status']), () => order.push('survivor'));

    expect(() => hub.publish('status', {})).not.toThrow();
    expect(order).toEqual(['survivor']);
    expect(warn).toHaveBeenCalledWith('[Events] listener failed:', expect.any(Error));
    warn.mockRestore();
  });

  it('an unsubscribe triggered during delivery affects only later publishes', () => {
    const hub = new EventHub();
    let unsubscribeSecond: (() => void) | null = null;
    const order: string[] = [];
    hub.subscribe(new Set(['status']), () => {
      order.push('first');
      unsubscribeSecond?.();
    });
    unsubscribeSecond = hub.subscribe(new Set(['status']), () => order.push('second'));

    hub.publish('status', {});
    expect(order).toEqual(['first', 'second']);

    hub.publish('status', {});
    expect(order).toEqual(['first', 'second', 'first']);
  });
});

describe('EventHub — cleanup guarantee', () => {
  it('listenerCount() is zero once every unsubscribe has run, for a single subscriber', () => {
    const hub = new EventHub();
    const unsubscribe = hub.subscribe(new Set(['status', 'acars']), () => {});

    expect(hub.listenerCount()).toBe(1);
    expect(hub.listenerCount('status')).toBe(1);

    unsubscribe();

    expect(hub.listenerCount()).toBe(0);
    expect(hub.listenerCount('status')).toBe(0);
    expect(hub.listenerCount('acars')).toBe(0);
  });

  it('unsubscribe is idempotent — a second call is a no-op', () => {
    const hub = new EventHub();
    const unsubscribe = hub.subscribe(new Set(['status']), () => {});

    unsubscribe();
    unsubscribe();

    expect(hub.listenerCount()).toBe(0);
  });

  it('unsubscribing one of several listeners leaves the others reachable', () => {
    const hub = new EventHub();
    const stays = vi.fn();
    const goes = hub.subscribe(new Set(['status']), () => {});
    hub.subscribe(new Set(['status']), stays);

    goes();
    hub.publish('status', {});

    expect(hub.listenerCount('status')).toBe(1);
    expect(stays).toHaveBeenCalledTimes(1);
  });
});

describe('EventHub — publishDeferred coalescing', () => {
  it('N same-key calls in one tick produce exactly one publish carrying the last payload', async () => {
    const hub = new EventHub();
    const received: HubMessage[] = [];
    hub.subscribe(new Set(['flight-state']), msg => received.push(msg));

    for (let i = 0; i < 5; i++) {
      hub.publishDeferred('flight-state', 'scope', () => ({
        flightState: 'FLYING', currentFlightId: 1, plannedLegId: i,
      }));
    }

    await afterFlush();

    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0].data)).toEqual({ flightState: 'FLYING', currentFlightId: 1, plannedLegId: 4 });
  });

  it('does not call build when the topic has zero listeners at flush time', async () => {
    const hub = new EventHub();
    const build = vi.fn(() => ({ flightId: 1, plannedLegId: null, messageId: 1 }));

    hub.publishDeferred('acars', 'k', build);
    await afterFlush();

    expect(build).not.toHaveBeenCalled();
  });

  it('a build() returning undefined publishes nothing', async () => {
    const hub = new EventHub();
    const received: HubMessage[] = [];
    hub.subscribe(new Set(['acars']), msg => received.push(msg));

    hub.publishDeferred('acars', 'k', () => undefined);
    await afterFlush();

    expect(received).toHaveLength(0);
  });

  it('a throwing build() is caught and logged, and does not stop other entries from flushing', async () => {
    const hub = new EventHub();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const received: HubMessage[] = [];
    hub.subscribe(new Set(['acars', 'flight-state']), msg => received.push(msg));

    hub.publishDeferred('acars', 'a', () => { throw new Error('boom'); });
    hub.publishDeferred('flight-state', 'b', () => ({ flightState: 'IDLE', currentFlightId: null, plannedLegId: null }));
    await afterFlush();

    expect(warn).toHaveBeenCalledWith('[Events] listener failed:', expect.any(Error));
    expect(received.map(m => m.topic)).toEqual(['flight-state']);
    warn.mockRestore();
  });

  it('publishDeferred never calls build synchronously', () => {
    const hub = new EventHub();
    hub.subscribe(new Set(['acars']), () => {});
    const build = vi.fn(() => ({ flightId: 1, plannedLegId: null, messageId: 1 }));

    hub.publishDeferred('acars', 'k', build);

    expect(build).not.toHaveBeenCalled();
  });

  it('distinct keys on the same topic flush as separate entries, each keeping its own last value', async () => {
    const hub = new EventHub();
    const received: HubMessage[] = [];
    hub.subscribe(new Set(['acars']), msg => received.push(msg));

    hub.publishDeferred('acars', 'flight:1', () => ({ flightId: 1, plannedLegId: null, messageId: 10 }));
    hub.publishDeferred('acars', 'flight:2', () => ({ flightId: 2, plannedLegId: null, messageId: 20 }));
    hub.publishDeferred('acars', 'flight:1', () => ({ flightId: 1, plannedLegId: null, messageId: 11 }));

    await afterFlush();

    expect(received).toHaveLength(2);
    // First-insertion order is kept even though key 'flight:1' was updated last.
    expect(JSON.parse(received[0].data)).toEqual({ flightId: 1, plannedLegId: null, messageId: 11 });
    expect(JSON.parse(received[1].data)).toEqual({ flightId: 2, plannedLegId: null, messageId: 20 });
  });

  it('a repeat of the same key across two separate ticks produces two publishes', async () => {
    const hub = new EventHub();
    const received: HubMessage[] = [];
    hub.subscribe(new Set(['acars']), msg => received.push(msg));

    hub.publishDeferred('acars', 'k', () => ({ flightId: 1, plannedLegId: null, messageId: 1 }));
    await afterFlush();
    hub.publishDeferred('acars', 'k', () => ({ flightId: 1, plannedLegId: null, messageId: 2 }));
    await afterFlush();

    expect(received).toHaveLength(2);
  });
});
