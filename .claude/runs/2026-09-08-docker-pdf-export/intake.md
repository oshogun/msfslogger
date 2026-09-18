# Intake — fix PDF export in the Docker image

Run id: 2026-09-08-docker-pdf-export
Orchestrator: Claude (msfslogger session)

## The user's request, verbatim

> Begin design of pending demand: fix PDF support on the docker version (a fix
> is already suggested on the project's readme)

## Goal (restated)

`README.md` §"Docker caveat" (lines 161–174) documents that PDF export is
broken in the shipped Docker image: the production stage is `node:20-alpine`,
Puppeteer's bundled Chromium is a glibc build that cannot run on Alpine's
musl, and the image ships no fonts (text would render as boxes even if
Chromium ran). Every other route works; only `GET /api/flights/:id/export.pdf`
and `GET /api/trips/:id/export.pdf` fail.

This run makes those two endpoints work under `docker compose up --build`,
using the fix the README already prescribes rather than inventing a new one.

## Success criteria

1. `docker compose up --build` produces an image where `GET
   /api/flights/:id/export.pdf` returns a valid PDF (not a 500), for a flight
   with no attached plan.
2. Exported PDF text is legible (a real font, not boxes) — i.e. `fonts-liberation`
   / `font-noto` (or equivalent) is present in the image.
3. The container does not accumulate Chromium zombie processes — `init: true`
   (or equivalent) is set on the compose service.
4. Every other route continues to work unchanged (build compiles, server
   starts, non-PDF pages served).
5. No change to `src/pdfExport.ts` or any application code — this is a
   packaging-only fix, matching the README's framing that "everything else in
   the app works normally."

## Decision frozen by the Orchestrator (README offered two options, verbatim)

> To make it work, either switch the production stage to a Debian base
> (`node:20-slim` + `apt-get install chromium fonts-liberation`), or install
> Alpine's own build and point Puppeteer at it:
>
> ```dockerfile
> RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont font-noto
> ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
>     PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
> ```
>
> Add `init: true` to the compose service as well

**Chosen: stay on Alpine, install Alpine's native Chromium build.** Not the
Debian-base switch. Reasoning:

- Smaller diff — all three Dockerfile stages (`client-builder`, `server-builder`,
  `production`) stay on `node:20-alpine`; a base-family switch would touch every
  stage's `apk add` lines for no functional gain here.
- The README gives this option as a ready-to-paste snippet; the Debian option
  is described but not fully spelled out (exact `apt-get` invocation, `-y`,
  cache cleanup).
- Current `production` stage already runs `apk add --no-cache python3 make
  g++` for `better-sqlite3`'s native build — Alpine package management is
  already the established pattern in this Dockerfile, not a new one.

This is a reversible, non-destructive Docker config choice with no schema/API
surface, so it was made directly rather than escalated — flag if the user
wanted the Debian path instead.

## Tier decision (per `.claude/agents.md` § Cost discipline rule 6)

**Tier 2 — one seam, no new contract.** Two files only (`Dockerfile`,
`docker-compose.yml`), no schema/API/shared-type change, no code touched.
Planner and Designer are both skipped: there is nothing to sequence into
multiple tasks and nothing to freeze as a contract — the "design" is the
snippet above, already decided. Implementation goes straight to **DevOps**
(role: build/packaging/deploy), then **Reviewer**. `intake.md` is the only
run artifact besides the DevOps report and review.

## Also worth doing while in this file (same seam, mentioned for completeness)

`puppeteer` is a production `dependency` (`package.json`), so `npm ci` in
**both** the `server-builder` stage (full install, for `tsc`) and the
`production` stage (`--omit=dev`) currently trigger Puppeteer's ~300 MB
Chromium postinstall download — a download that is thrown away once we point
Puppeteer at the Alpine-native binary instead. Setting
`PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` before `npm ci` in **both** stages
(not just `production`) avoids wasting that download during
`server-builder` too. In scope for this run since it's the same env var on
the same seam, not a separate task.

## Out of scope

- Any change to `src/pdfExport.ts`, the print routes, or `pdf-lib` merging.
- Switching the production base image to Debian (considered, not chosen —
  see decision above).
- Non-Docker deployment paths.
