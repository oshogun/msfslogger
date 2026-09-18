# Review: Node 24 docs refresh (README.md, docs/*.md, agent/README.md)

**Verdict: approve**

Scope: Orchestrator-authored docs edits for the Node 20 -> 24 cutover, no
implementer role involved. Reviewed the diff directly (no implementer report
exists to distrust). All checks below are independently reproduced commands,
not taken on the Orchestrator's word. This is round 2, re-verifying the two
blocking findings from round 1 after fixes.

## Round 1 blocking findings — both fixed, re-verified

**1. `docs/setup.md:140` leftover `nvm use 20`.**
`git diff -- docs/setup.md` confirms the "Validate the setup" code block now
reads `nvm use 24`, matching the rest of the file (table row, "Always select
Node 24" prose). Re-ran `grep -n '20' README.md docs/setup.md
docs/troubleshooting.md docs/usage.md docs/development.md agent/README.md`
across all 6 files: every remaining `20` hit is an MSFS-2020 simulator
reference (`--sim 2020`, "MSFS 2020/2024", `Protocol.KittyHawk` default,
`agent/README.md`'s "MSFS 2020 vs 2024 vs FSX" section) — none are Node-version
claims. No leftover Node-20 reference anywhere. **Confirmed fixed.**

**2. `agent/README.md:11` engines-field claim.**
`git diff -- agent/README.md` shows it now reads: "its `package.json`
declares no `engines` constraint, so this isn't a hard requirement — it just
matches the server's current baseline." Re-checked against the actual file:
`grep -n '"engines"' agent/package.json` → no match — `agent/package.json`
genuinely has no `engines` field. The wording now correctly describes that
absence instead of implying a field exists to consult. **Confirmed fixed and
accurate.**

## Criteria unaffected by this round, unchanged since round 1 (re-affirmed, not re-run)

- **Criterion 2** (troubleshooting.md stale-native-build claim) — verified in
  round 1 by requiring `better-sqlite3` under both Node 20 and Node 24
  against the current `node_modules`: Node 20 loads, Node 24 fails with
  `NODE_MODULE_VERSION 115` vs required `137` — matches the documented
  failure mode exactly. Not touched this round.
- **Criterion 3** (internal links resolve) — all links in the 6 files
  resolve except a pre-existing dangling pair in `agent/README.md`
  (`../README.md#environment-variables`, `../README.md#https`), traced via
  `git log -p --follow` to commit `2f7d1d8`, well before this run and
  untouched by either round's diff. Non-blocking follow-up, not a blocker.
- **Criterion 4** (scope) — `git diff` on all 6 files this round touches only
  the two lines named by the coordinator; no unrelated content changed.

## Live database

Not touched. This round made no writes to any file, `node_modules`, or
`flights.db` — only `git diff`/`grep`/`cat` reads.

## Summary

All 5 acceptance criteria now pass on independent verification. The two
round-1 blocking findings (leftover `nvm use 20` in docs/setup.md, and the
inaccurate engines-field claim in agent/README.md) are both fixed and
re-verified against source (`grep`, `cat agent/package.json`), not taken on
the coordinator's word. One non-blocking follow-up carried over: the two
dangling `../README.md#environment-variables`/`#https` anchors in
agent/README.md predate this run and are out of scope for it, but worth a
future fix.
