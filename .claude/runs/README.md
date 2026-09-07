# Run artifacts

One directory per run: `.claude/runs/<run-id>/`, where `<run-id>` is
`YYYY-MM-DD-short-slug` (e.g. `2026-09-04-lnmpln-trip-planner`).

A run directory is the durable record of one feature: what was asked, what was
frozen, what was built, what was checked, and what shipped. It is written by the
agents in `.claude/agents/` and is the context a later run reads to understand a
decision.

```
.claude/runs/<run-id>/
├── intake.md          Orchestrator — goal restated, success criteria,
│                      decisions the user froze
├── plan.json          Planner    — phases, tasks, deps, allowed_paths,
│                      acceptance criteria
├── design.md          Designer   — the freeze, alternatives, must-not-change
├── contracts/         Designer   — type stubs, DDL, sample payloads
│                                   (reference only, not wired into the build)
├── prototypes/        Designer   — throwaway scripts that validated an
│                                   assumption against real input
├── reviews/           Reviewer   — one file per phase or task, verdict at top
├── reports/           Dispatcher / DevOps — evidence: commands and their output
└── tools/             one-off checkers worth keeping for the next run
```

Conventions:

- Artifacts are append-mostly. When reality contradicts a frozen section, amend
  it in place, keep the section numbering, and record the change in an amendment
  table with the evidence that forced it.
- Reports cite commands and their real output, not summaries of them.
- Nothing here is imported by the application. `dist/` never depends on a run
  directory.
