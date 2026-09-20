import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import { ingestTokenDigest, ingestTokenMatches } from '../auth/ingestToken';
import type { IngestConfig } from '../config';
import { isNavdataBusy, NavdataBusyError } from '../navdata/connection';
import { buildDemand } from '../navdata/demand';
import { importNavdataSnapshot } from '../navdata/snapshot';
import { parseSidecarStateReport, type SidecarStateStore } from '../navdata/sidecarState';
import { applyIncrementalBatch, NavdataStoreError } from '../navdata/store';
import type { IncrementalBatch, NavdataErrorCode } from '../navdata/wire';
import { uploadNavdataSnapshot } from './uploads';

function busy(res: Response, retryAfterSeconds: number, message: string): void {
  res.set('Retry-After', String(retryAfterSeconds));
  res.status(503).json({ ok: false, code: 'NAVDATA_BUSY' satisfies NavdataErrorCode, message });
}

function storeError(res: Response, err: NavdataStoreError): void {
  res.status(err.status).json({
    ok: false,
    code: err.code,
    message: err.message,
    ...('serverSnapshotId' in err ? { serverSnapshotId: err.serverSnapshotId } : {}),
    ...(err.serverRev !== undefined ? { serverRev: err.serverRev } : {}),
    ...(err.serverSchemaVersion !== undefined ? { serverSchemaVersion: err.serverSchemaVersion } : {}),
  });
}

/**
 * The sidecar's sync endpoints: authenticated by INGEST_TOKEN, mounted above
 * the session middleware so a request never touches the session store. The
 * router answers only its four routes; every other /api/navdata path falls
 * through to the session stack, so the token check is per-route and there is
 * deliberately no router-level middleware here.
 */
export function createNavdataSyncRouter(
  ingestConfig: IngestConfig,
  sidecarState: SidecarStateStore,
): express.Router {
  const router = express.Router();
  const tokenDigest = ingestTokenDigest(ingestConfig.token);
  let importing = false;

  // Null digest is reachable only through the explicit
  // ALLOW_UNAUTHENTICATED_INGEST opt-out.
  const requireToken = (req: Request, res: Response, next: NextFunction): void => {
    if (!tokenDigest || ingestTokenMatches(req.get('x-ingest-token'), tokenDigest)) {
      next();
      return;
    }
    res.status(401).json({ error: 'Invalid or missing ingest token' });
  };

  // A batch applied to the outgoing replica while a snapshot is importing would
  // be lost when the swap lands, after the sidecar may already have counted it
  // as delivered. So the whole import, from the first byte of the upload to the
  // end of the swap, holds the replica against batches and other snapshots.
  const beginImport = (_req: Request, res: Response, next: NextFunction): void => {
    if (isNavdataBusy() || importing) {
      busy(res, 2, 'navdata replica is being replaced');
      return;
    }
    importing = true;
    // The upload can fail before the handler runs (size limit, bad multipart);
    // the handler owns the release once it has started.
    res.once('close', () => {
      if (!res.locals.importHandlerStarted) importing = false;
    });
    next();
  };

  router.post(
    '/snapshot',
    requireToken,
    beginImport,
    uploadNavdataSnapshot.single('navdataSnapshot'),
    async (req, res) => {
      res.locals.importHandlerStarted = true;
      const file = req.file;
      try {
        if (!file) {
          res.status(400).json({ ok: false, code: 'NAVDATA_BAD_BATCH', message: 'No navdataSnapshot file in the upload' });
          return;
        }
        res.json(await importNavdataSnapshot(file.path));
      } catch (err) {
        if (err instanceof NavdataStoreError) {
          storeError(res, err);
        } else if (err instanceof NavdataBusyError) {
          busy(res, err.retryAfterSeconds, err.message);
        } else {
          console.error(`navdata: snapshot import failed: ${(err as Error).message}`);
          res.status(500).json({ error: 'Snapshot import failed' });
        }
      } finally {
        importing = false;
        if (file) fs.rm(file.path, { force: true }, () => undefined);
      }
    },
  );

  router.post('/rows', requireToken, (req, res) => {
    if (isNavdataBusy() || importing) {
      busy(res, 2, 'navdata replica is being replaced');
      return;
    }
    try {
      const ack = applyIncrementalBatch(req.body as IncrementalBatch);
      sidecarState.markRowsApplied();
      res.json(ack);
    } catch (err) {
      if (err instanceof NavdataStoreError) {
        storeError(res, err);
      } else if (err instanceof NavdataBusyError) {
        busy(res, err.retryAfterSeconds, err.message);
      } else {
        console.error(`navdata: batch failed: ${(err as Error).message}`);
        res.status(500).json({ error: 'Batch failed' });
      }
    }
  });

  router.get('/demand', requireToken, (_req, res) => {
    if (isNavdataBusy()) {
      busy(res, 2, 'navdata replica is being replaced');
      return;
    }
    try {
      res.json(buildDemand());
    } catch (err) {
      if (err instanceof NavdataBusyError) {
        busy(res, err.retryAfterSeconds, err.message);
        return;
      }
      console.error(`navdata: demand failed: ${(err as Error).message}`);
      res.status(500).json({ error: 'Demand failed' });
    }
  });

  // Fire-and-forget: the sidecar never retries, so nothing here may throw.
  router.post('/state', requireToken, (req, res) => {
    try {
      const report = parseSidecarStateReport(req.body);
      if (!report) {
        res.status(400).json({ ok: false, code: 'NAVDATA_BAD_BATCH', message: 'Not a sidecar state report' });
        return;
      }
      sidecarState.report(report);
      res.status(204).end();
    } catch (err) {
      console.error(`navdata: state report failed: ${(err as Error).message}`);
      res.status(204).end();
    }
  });

  return router;
}
