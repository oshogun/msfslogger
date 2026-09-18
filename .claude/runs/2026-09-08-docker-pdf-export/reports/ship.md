# Ship report — T-001 Docker PDF export (2026-09-08-docker-pdf-export)

## Scope
Edited only `Dockerfile` and `docker-compose.yml`, per `allowed_paths`. No files
under `src/`, `client/`, or `package.json` touched.
`git status --porcelain -- Dockerfile docker-compose.yml` → both `M`, nothing
else. `git diff --stat` → 2 files changed, 5 insertions(+), 0 deletions.

## Changes made

**Dockerfile**
- `server-builder` stage: added `ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true`
  before `RUN npm ci`, so that stage's full install doesn't pull a Chromium it
  never runs. No `PUPPETEER_EXECUTABLE_PATH` there (stage only compiles TS).
- `production` stage: added
  `RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont font-noto`
  and `ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`,
  both placed before `RUN npm ci --omit=dev`, matching README's documented
  Alpine-native snippet (README.md lines 167-171).
- `client-builder` stage: untouched (no puppeteer dependency there).

**docker-compose.yml**
- Added `init: true` as a sibling key to `build:` on the `msfslogger` service,
  so PID 1 reaps Chromium zombie children.

## Verification

`docker compose config` (validates without starting anything) — succeeded,
output shows `init: true` under the `msfslogger` service, and the existing
volume binds (`flights.db`, `flight_plans`) and ports (`3000:3000`) are
unchanged from before.

Built a scratch image, tagged so it can't collide with any real deploy tag:

    docker build -t msfslogger-pdf-scratch:test .
    → completed, exit 0. All 3 stages (client-builder, server-builder,
      production) built and `npm run build:server` (tsc) succeeded with no
      errors. Full log tail shows `exporting to image ... DONE 89.3s`.

Checks against the built image (container run and removed immediately each
time, never a persistent container, never named/port-mapped to clash with the
live app):

    docker run --rm msfslogger-pdf-scratch:test which chromium-browser
    → /usr/bin/chromium-browser

    docker run --rm msfslogger-pdf-scratch:test node -e "console.log(process.env.PUPPETEER_EXECUTABLE_PATH)"
    → /usr/bin/chromium-browser

    docker run --rm msfslogger-pdf-scratch:test /usr/bin/chromium-browser --version
    → Chromium 149.0.7827.53 Alpine Linux
    (extra check beyond the acceptance criteria — confirms the binary isn't
    just present but actually executes on this Alpine base)

Cleanup: `docker rmi msfslogger-pdf-scratch:test` → removed
(`Untagged:`/`Deleted:` lines confirmed). `docker ps` shows no leftover
containers from this task.

## Live server / live data — untouched

- Never ran `docker compose up`; only `docker build` + `docker run --rm` on a
  distinctly-tagged scratch image, so the live app on port 3000 and its
  `flights.db` bind mount were never referenced by any command here.
- `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/flights` →
  `200` (live server still up and responding after this task).
- `md5sum /home/guilherme/msfslogger/flights.db` →
  `583f9076867333681c90be6ddd309629`. This task performed no writes to the
  live database at any point (no volume mount, no `npm run backup`, no
  migration) — one reading is sufficient evidence of no change; before/after
  comparison is not applicable since the file was never opened by this task.

## Not verified (explicitly out of scope per task constraints)
Actually generating a PDF via `GET /api/flights/:id/export.pdf` through a
running containerized server was **not** attempted — the task record scopes
this out ("verifying the Chromium binary is present and
PUPPETEER_EXECUTABLE_PATH is wired is sufficient evidence"). Puppeteer's
ability to successfully launch `/usr/bin/chromium-browser` with the installed
`nss`/`freetype`/`harfbuzz`/font packages under sandboxed conditions, and
render CJK/emoji or unusual glyphs, is untested. `ttf-freefont` and
`font-noto` are installed per the README's own recommendation but font
coverage for exotic content is not verified.

## Risks / residual
- If Puppeteer's own sandbox flags (`--no-sandbox` etc., set in
  `src/pdfExport.ts`, out of scope for this task) aren't already compatible
  with a non-root Alpine Chromium launch, first real export attempt in the
  container could still fail — recommend a follow-up manual PDF export test
  against a scratch container + scratch DB before calling this fully shipped.
- `docker build` added ~89s and pulled several apk packages (chromium et al.);
  final image size was not measured but chromium + fonts add real weight to
  the production layer — acceptable trade per the frozen decision in
  intake.md.
