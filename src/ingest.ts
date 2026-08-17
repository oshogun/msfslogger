import express, { Router, Request, Response } from 'express';
import type { FlightManager } from './flightManager';
import type { SimFrame } from './types';

const STALE_TIMEOUT_MS = 10_000;
const STALE_CHECK_INTERVAL_MS = 5_000;

function isValidFrame(body: unknown): body is SimFrame {
  if (typeof body !== 'object' || body === null) return false;
  const f = body as Record<string, unknown>;
  return (
    typeof f.lat === 'number' &&
    typeof f.lon === 'number' &&
    typeof f.altitudeFt === 'number' &&
    typeof f.airspeedKnots === 'number' &&
    typeof f.groundSpeedKnots === 'number' &&
    typeof f.headingDeg === 'number' &&
    typeof f.verticalSpeedFpm === 'number' &&
    typeof f.onGround === 'boolean' &&
    typeof f.simRunning === 'number' &&
    typeof f.aircraft === 'string'
  );
}

/**
 * Receives flight data pushed over HTTP by the Windows-side agent (see /agent),
 * which talks to SimConnect locally on the MSFS machine. This is the inverse of
 * src/simconnect.ts, which instead connects out to a remote SimConnect TCP port.
 */
export function createIngestRouter(flightManager: FlightManager): Router {
  const router = express.Router();
  const token = process.env.INGEST_TOKEN;
  let lastFrameAt = 0;

  const checkAuth = (req: Request, res: Response): boolean => {
    if (!token) return true;
    if (req.get('x-ingest-token') === token) return true;
    res.status(401).json({ error: 'Invalid or missing ingest token' });
    return false;
  };

  const markConnected = () => {
    if (!flightManager.appState.connected) {
      console.log('[Ingest] Agent connected');
    }
    flightManager.appState.connected = true;
    lastFrameAt = Date.now();
  };

  const markDisconnected = () => {
    if (flightManager.appState.connected) {
      console.log('[Ingest] Agent disconnected');
      flightManager.appState.connected = false;
      flightManager.onSimDisconnect();
    }
  };

  // The agent only sends an explicit "disconnected" event when it shuts down cleanly.
  // If it dies or the network drops, this catches the silence instead.
  setInterval(() => {
    if (flightManager.appState.connected && Date.now() - lastFrameAt > STALE_TIMEOUT_MS) {
      console.log('[Ingest] No data received recently — marking disconnected');
      markDisconnected();
    }
  }, STALE_CHECK_INTERVAL_MS);

  router.post('/frame', (req, res) => {
    if (!checkAuth(req, res)) return;
    if (!isValidFrame(req.body)) {
      res.status(400).json({ error: 'Invalid frame payload' });
      return;
    }
    markConnected();
    flightManager.onFrame(req.body);
    res.status(204).end();
  });

  router.post('/event', (req, res) => {
    if (!checkAuth(req, res)) return;
    const { type } = req.body as { type?: unknown };

    switch (type) {
      case 'connected':
        markConnected();
        break;
      case 'disconnected':
        markDisconnected();
        break;
      case 'paused':
        flightManager.setPaused(true);
        break;
      case 'unpaused':
        flightManager.setPaused(false);
        break;
      case 'crashed':
        console.log('[Ingest] Crash detected');
        flightManager.onCrash();
        break;
      default:
        res.status(400).json({ error: `Unknown event type: ${String(type)}` });
        return;
    }
    res.status(204).end();
  });

  return router;
}
