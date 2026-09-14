#!/usr/bin/env ts-node
// ── Route-table inspector ──────────────────────────────────────────────────
//
// A read-only CLI over the real createServer(). It exists because a router
// table is easy to get wrong silently: two routers mounted at the same
// prefix, a route added above the auth gate by accident, a handler that
// moved from the top level into a sub-router without anyone noticing the
// path changed underneath it. This prints exactly what express would match
// against, in registration order, so that can be diffed instead of read.
//
//   npx ts-node src/inspect-routes.ts
//
// createServer() reads process.env through src/config.ts before a single
// route is registered (BIND_HOST, INGEST_TOKEN/ALLOW_UNAUTHENTICATED_INGEST),
// and getOrCreateAppSecret() needs an initialised database for the session
// secret. Both are handled below — but neither may ever touch the repo's
// real flights.db, so this must be run from a scratch cwd holding a *copy*
// of it (src/db.ts computes its DB_PATH from process.cwd() once, at import
// time — this file imports './db' at the top for exactly that reason: cwd
// has to already be the scratch directory before node even starts, which is
// why this script takes no --db flag and instead trusts its caller to `cd`
// there first).
//
// One line per route, tab-separated: METHOD<TAB>/full/path. A router mounted
// with app.use (today: /api/ingest, /api/auth) is walked recursively so its
// routes print with their real, full path rather than the path they were
// registered under inside the router.

if (!process.env.BIND_HOST) process.env.BIND_HOST = '127.0.0.1';
if (!process.env.INGEST_TOKEN && !process.env.ALLOW_UNAUTHENTICATED_INGEST) {
  process.env.ALLOW_UNAUTHENTICATED_INGEST = '1';
}

import { loadConfig } from './config';
import { initDb } from './db';
import { createServer } from './server';
import type { FlightManager } from './flightManager';

interface ExpressLayer {
  route?: { path: string; methods: Record<string, boolean> };
  regexp?: RegExp & { fast_slash?: boolean };
  handle?: { stack?: ExpressLayer[] };
}

/**
 * Turns a mount layer's compiled regexp back into the literal path prefix it
 * was mounted at (e.g. '/api/ingest'). Every router in this app is mounted
 * with a plain string and no path params, and path-to-regexp always compiles
 * that shape to ^\/literal\/?(?=\/|$) — so this is exact, not a heuristic,
 * for the mounts that actually exist here.
 */
function mountPrefix(layer: ExpressLayer): string {
  if (!layer.regexp || layer.regexp.fast_slash) return '';
  return layer.regexp.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\\\//g, '/');
}

function walk(stack: ExpressLayer[], prefix: string, lines: string[]): void {
  for (const layer of stack) {
    if (layer.route) {
      const routePath = layer.route.path === '/' ? '' : layer.route.path;
      for (const method of Object.keys(layer.route.methods)) {
        if (layer.route.methods[method]) {
          lines.push(`${method.toUpperCase()}\t${prefix}${routePath}`);
        }
      }
    } else if (layer.handle?.stack) {
      // Only an express.Router() mounted via app.use() carries a nested
      // stack; plain middleware (session, requireAuth, express.json, ...)
      // does not, so this never descends into anything but a real
      // sub-router.
      walk(layer.handle.stack, prefix + mountPrefix(layer), lines);
    }
  }
}

function main(): void {
  loadConfig();
  initDb();

  const app = createServer({} as unknown as FlightManager);
  const stack = (app as unknown as { _router: { stack: ExpressLayer[] } })._router.stack;

  const lines: string[] = [];
  walk(stack, '', lines);
  console.log(lines.join('\n'));

  // createServer() starts background timers (session sweep, ingest staleness
  // check) meant to run for the life of a real process. Nothing here is a
  // real server, so print and exit immediately rather than let one of them
  // fire against the stub FlightManager later and crash.
  process.exit(0);
}

main();
