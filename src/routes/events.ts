import express, { Router } from 'express';
import { EVENT_TOPICS, isEventTopic } from '../eventHub';
import type { EventHub, EventTopic, FlightStatePayload } from '../eventHub';

export const EVENTS_KEEPALIVE_MS = 15_000;
export const EVENTS_RETRY_MS = 3_000;
export const EVENTS_MAX_BUFFERED_BYTES = 1_048_576;
export const EVENTS_MAX_STREAMS = 64;

export interface EventSnapshot {
  status(): object;
  flightState(): FlightStatePayload;
}

export interface EventsRouteOptions { keepaliveMs?: number }

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
};

/**
 * Absent means every topic. Present must be a single comma list — a repeated
 * `topics=` arrives as an array from express's query parser and is refused
 * rather than silently taking the first or last one. A blank segment between
 * commas contributes nothing (neither a valid name nor an error by itself);
 * an unknown name is always an error, even alongside good ones.
 */
export function parseTopicsParam(raw: unknown): { ok: true; topics: Set<EventTopic> } | { ok: false; error: string } {
  if (raw === undefined) {
    return { ok: true, topics: new Set(EVENT_TOPICS) };
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: 'topics must be given once' };
  }

  const names = raw.split(',').map(name => name.trim()).filter(name => name.length > 0);
  if (names.length === 0) {
    return { ok: false, error: 'topics must name at least one topic' };
  }

  const topics = new Set<EventTopic>();
  for (const name of names) {
    if (!isEventTopic(name)) {
      return { ok: false, error: `Unknown topic: ${name}` };
    }
    topics.add(name);
  }
  return { ok: true, topics };
}

/**
 * GET /api/events — a long-lived Server-Sent-Events stream over the hub.
 * Mounted at '/api' by src/server.ts, directly after GET /api/status and
 * behind requireAuth, so both the session cookie and the ingest-token scope
 * (INGEST_SCOPED_ROUTES) already gate it before this handler ever runs.
 */
export function createEventsRouter(hub: EventHub, snapshot: EventSnapshot, options: EventsRouteOptions = {}): Router {
  const keepaliveMs = options.keepaliveMs ?? EVENTS_KEEPALIVE_MS;
  const router = express.Router();

  router.get('/events', (req, res) => {
    // Parsed before the HEAD and stream-limit checks below, so a malformed
    // query is always a 400 — even against a HEAD probe, and even while the
    // hub is already full.
    const parsed = parseTopicsParam(req.query.topics);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error, code: 'INVALID_TOPICS' });
      return;
    }

    if (req.method === 'HEAD') {
      res.status(200).set(SSE_HEADERS);
      res.end();
      return;
    }

    if (hub.listenerCount() >= EVENTS_MAX_STREAMS) {
      res.status(503).set('Retry-After', '5').json({ error: 'Too many event streams', code: 'EVENTS_STREAM_LIMIT' });
      return;
    }

    res.status(200).set(SSE_HEADERS);
    res.flushHeaders();

    // A stalled consumer is disconnected rather than buffered without bound —
    // it reconnects and refetches via the open-stream snapshot, same as any
    // other reconnect.
    const write = (chunk: string): void => {
      res.write(chunk);
      if (res.writableLength > EVENTS_MAX_BUFFERED_BYTES) {
        res.destroy();
      }
    };

    // Subscribed before anything is written, so nothing published between the
    // snapshot below and this call can be missed.
    const unsubscribe = hub.subscribe(parsed.topics, msg => write(`event: ${msg.topic}\ndata: ${msg.data}\n\n`));

    write(`retry: ${EVENTS_RETRY_MS}\n\n`);

    if (parsed.topics.has('status')) {
      try {
        write(`event: status\ndata: ${JSON.stringify(snapshot.status())}\n\n`);
      } catch (err) {
        console.warn('[Events] status snapshot failed:', err);
      }
    }
    if (parsed.topics.has('flight-state')) {
      try {
        write(`event: flight-state\ndata: ${JSON.stringify(snapshot.flightState())}\n\n`);
      } catch (err) {
        console.warn('[Events] flight-state snapshot failed:', err);
      }
    }

    // Fixed period, never reset by other traffic — the one timer a hint-only
    // consumer on an idle server still sees.
    const keepalive = setInterval(() => write(': keepalive\n\n'), keepaliveMs);

    // The only cleanup path: fires when the client aborts, and does not fire
    // early for a bodiless GET.
    res.on('close', () => {
      clearInterval(keepalive);
      unsubscribe();
    });
  });

  return router;
}
