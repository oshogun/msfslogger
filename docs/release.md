# Release

This project does not currently have a formal release process — noted here,
per [`docs/index.md`](index.md), rather than omitting the file.

- `package.json` carries a static version (`1.0.0`) that hasn't been bumped
  per release; there's no script or CI step that updates it.
- There are no git tags and no `CHANGELOG.md` in this repository.
- There's no publish step: CI (`.github/workflows/ci.yml`) only builds and
  tests on push/PR — it doesn't build or push a container image, cut a
  GitHub Release, or publish anything.

## What "shipping a change" actually means today

1. Merge to `main` (see [development.md](development.md) for the working
   convention).
2. Whoever runs a given instance pulls `main` and rebuilds it themselves:

   ```bash
   git pull
   (cd client && npm ci)   # only when client/package.json changed
   npm run build
   npm start   # or restart however you're running it — see operations.md
   ```

   The move to the Carbon client (the whole web UI replaced at once) is such a
   change: it swaps the client's dependencies, so `client/node_modules` must be
   reinstalled before the build. The server, database and API are unchanged —
   no migration, no data step.

   For a Docker deployment: `docker compose build && docker compose up -d`.

There is no staged rollout, canary, or blue/green concept — this is a
single-operator, self-hosted app with (typically) one running instance.

## If you add a real release process later

Worth documenting here when it exists: how the version number is decided,
whether tags are cut, whether a container image is published (and where),
and whether `CHANGELOG.md` is maintained by hand or generated from commits.
None of that exists yet, so this page intentionally doesn't invent it.
