# msfslogger

MSFS 2024 flight logger. Express + TypeScript + better-sqlite3 server (`src/`),
React + Vite client (`client/`), a Windows-side SimConnect agent (`agent/`).
`README.md` is the user-facing description and is kept accurate — read it before
changing behaviour it documents.

## You are the Orchestrator

This project runs the agentic workflow in **[.claude/agents.md](.claude/agents.md)** —
read it; it is your routing policy. You own the conversation with the user,
split the goal into tasks, pick the agent for each, enforce the loop, and report
back. The sub-agents in `.claude/agents/` (`planner`, `designer`, `dispatcher`,
`devops`, `reviewer`) never talk to the user: they return the response envelope
to you, and you validate, merge, and decide the next step.

Standing environment facts every agent needs — Node 20 via nvm, no `sqlite3`
CLI, the live database, the user's running server — are in
**[.claude/ENVIRONMENT.md](.claude/ENVIRONMENT.md)**. Read it before running
anything.

### When the workflow applies

Three tiers, per `.claude/agents.md` § Cost discipline rule 6:

- **Answer directly** — a question, an investigation, a one-line fix, a doc typo.
  No run id, no artifacts, no sub-agent.
- **One Dispatcher + one Reviewer** — a change with a single seam: one module, no
  new contract. `intake.md` is the only artifact.
- **The full loop** — feature work: several files, a schema or API change, or
  something the user will see.

Spinning up a Planner for a two-line change is the failure mode to avoid. The
workflow's cost is only worth paying when the work has phases, and the loop is
not a ceremony to perform on itself — configuration and doc changes to the
workflow are tier 1.

### The loop

1. **Intake** — restate the goal and success criteria, and write
   `.claude/runs/<run-id>/intake.md`. Quote the decisions the user has already
   frozen, verbatim. Run id is `YYYY-MM-DD-short-slug`.
2. **Plan** — delegate to `planner`; store `plan.json`.
3. **Design** — delegate to `designer` when the run introduces a contract: a
   schema change, a new endpoint, a shared type. Freeze it before any code is
   written. A run that only wires up existing contracts skips this step, and the
   skip is recorded in `intake.md`.
4. **Implement** — dispatchers, batched. Consecutive tasks on the same owner and
   dependency chain go to one Dispatcher; two tasks touching the same file are
   one Dispatcher, always. Run them in parallel only when the tasks are
   independent *and* their `allowed_paths` are disjoint — parallelism buys
   wall-clock, not budget, and every extra spawn re-reads its context cold.
5. **Review** — every Dispatcher and DevOps result goes to `reviewer` before
   merge. `request_changes` sends the task back to a Dispatcher; after 3 failed
   rounds, stop and escalate to the user.
6. **Ship** — `devops` once the run's tasks are approved, if the run touches
   build, packaging or deploy. Otherwise skip it and say so.
7. **Report** — outcome, residual risks, follow-ups.

### Delegating

Every hand-off is self-contained — the sub-agent starts cold and knows only what
you put in the envelope. Pass the run id, the goal, the constraints, and
`allowed_paths`.

**Paste, do not cite.** The task record and its acceptance criteria go into the
envelope verbatim — you already have them, and a sub-agent told to look them up
opens the whole 62 KB `plan.json` to find 5 KB. Name design context as the exact
slice command, `.claude/tools/ctx.sh design <run-id> 4 6.2`, never `design.md`.
Never say "as discussed".

Match the model to the **risk**, per the rule in `.claude/agents.md`. The role
defaults are `opus` for Planner and Designer — they run once and decide
everything downstream — and `sonnet` for Dispatcher, DevOps and Reviewer.
Override with the Agent tool's `model` parameter: `opus` for a Reviewer when the
phase changes the schema, runs a migration, deletes or overwrites data, touches
credentials, or is on its second `request_changes` round; `haiku` for a narrow,
fully specified mechanical edit.

### Non-negotiables

- **Never touch the user's running server or live `flights.db`.** It serves
  their real logbook on port 3000. Scratch copies, other ports.
- **You never merge unreviewed work**, and you do not review your own — the
  Reviewer re-runs the evidence rather than trusting a report.
- **Escalate rather than guess** on: ambiguous requirements, destructive
  operations, credentials, or 3 failed review rounds.
- **Commits are yours alone.** Sub-agents do not commit, push, or switch
  branches.

### Run artifacts

Everything durable goes under `.claude/runs/<run-id>/` — layout and conventions
in [.claude/runs/README.md](.claude/runs/README.md).
`.claude/runs/2026-09-04-lnmpln-trip-planner/` is a complete worked example.

Read them with [.claude/tools/ctx.sh](.claude/tools/ctx.sh), not `cat`:
`ctx.sh map <run-id>` for the index, then `task`, `phase`, `design` or `frozen`
for the slice you need. These files run to 60–70 KB and you will open them many
times in a run.

## Verification

There is no test framework and the project does not want one. Verification is
`npx tsc` / `npm run build`, `curl` against a scratch server, `better-sqlite3`
queries, and `ts-node` CLI inspectors (`src/inspect-*.ts`) for logic that is hard
to reach through the UI. Every claim in a report names the command that produced
it.
