#!/usr/bin/env bash
# scratch-server.sh — start a throwaway server on :3100 against a COPY of the
# live database, verbatim recipe from plan.json's sequencing_rationale
# (2026-09-09-sidebar-nav-legs-paging). Never touches the live server on
# :3000 or flights.db directly.
#
# src/db.ts:9 and src/server.ts:123 resolve both the database and the static
# client from process.cwd(), so a scratch server is a scratch *cwd*.
#
# Usage (from the repo root):
#   .claude/runs/2026-09-09-sidebar-nav-legs-paging/tools/scratch-server.sh [SCRATCH_DIR]
#
# Runs in the foreground on :3100; Ctrl-C (or `kill`) to stop it. Caller is
# responsible for killing it when the task ends — this script does not
# background itself.
set -euo pipefail

REPO="/home/guilherme/msfslogger"
SCRATCH="${1:-$(mktemp -d)/ui}"

mkdir -p "$SCRATCH/client"
cp "$REPO/flights.db" "$REPO/flights.db-wal" "$REPO/flights.db-shm" "$SCRATCH/" 2>/dev/null || true
ln -sfn "$REPO/client/dist" "$SCRATCH/client/dist"
ln -sfn "$REPO/airports.json" "$SCRATCH/airports.json"
ln -sfn "$REPO/flight_plans" "$SCRATCH/flight_plans"

echo "scratch cwd: $SCRATCH" >&2
echo "scratch db:  $SCRATCH/flights.db" >&2

cd "$SCRATCH"
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1090
. "$NVM_DIR/nvm.sh"
nvm use 20 >/dev/null
PORT=3100 exec node "$REPO/dist/index.js"
