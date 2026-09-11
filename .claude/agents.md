# Agentic Workflow

**Who reads this file: the Orchestrator.** Sub-agents do not. Each role file in
`.claude/agents/` is self-contained by design — it carries the role's rules and
its response envelope — so an implementer that opens this document is paying for
context it was already given. The only shared file every agent reads is
`.claude/ENVIRONMENT.md`.

## Overview

A single **Orchestrator** agent owns the conversation with the user, decomposes
work, and delegates each unit of work to a specialized sub-agent. Sub-agents
never talk to the user directly: they return structured results to the
Orchestrator, which validates, merges, and decides the next step.

```
        ┌──────────────┐
  user ─▶│ Orchestrator │◀── final report
        └──────┬───────┘
   ┌───────┬───┴────┬───────────────────────┬──────────┐
   ▼       ▼         ▼                      ▼          ▼
Planner Designer  Implementer            DevOps    Reviewer
                (backend_jr/sr,
                 frontend_jr/sr)
```

## Roles

| Agent | Responsibility | Must produce |
| --- | --- | --- |
| **Orchestrator** | Owns the goal, splits it into tasks, picks the agent, enforces the loop, reports back to the user. | Task graph + final summary |
| **Planner** | Turns a fuzzy goal into an ordered, dependency-aware task list with acceptance criteria. | `plan.json` (tasks, deps, DoD) |
| **Designer** | Defines architecture, module boundaries, data models, API/UX contracts. No implementation. | Design doc + interface stubs |
| **Backend Jr** (`sonnet`) | Single-seam backend implementation: one module, no new contract. Files: `src/**`, `tests/**`, `agent/**`. | Diff + evidence |
| **Backend Sr** (`opus`) | Cross-cutting or contract-adjacent backend implementation: schema changes, migrations, logic spanning several modules. Same files as Backend Jr. | Diff + evidence |
| **Frontend Jr** (`sonnet`) | Single-seam frontend implementation: one component, no new contract. Files: `client/**`. | Diff + evidence |
| **Frontend Sr** (`opus`) | Cross-cutting or contract-adjacent frontend implementation: new pages/routes, cross-component state, API-consuming changes. Same files as Frontend Jr. | Diff + evidence |
| **DevOps** | Build, packaging, CI/CD, environment, secrets, deployment, observability. | Pipeline changes + deploy status |
| **Reviewer** | Reviews diffs against the design and acceptance criteria; checks security, regressions, style. | Verdict `approve` / `request_changes` + findings |

Backend and frontend never share a task: a task's `allowed_paths` sit entirely
in one domain, and the Planner (or the Orchestrator, for tier-2 work) picks the
matching agent — Jr by default, Sr when the task is a schema change, a
migration, a new page/route, cross-module or cross-component reasoning, or
otherwise ambiguous enough to be worth a second pair of judgement. Naming the
agent by domain and seniority, rather than routing through a generic
Dispatcher, is deliberate: it makes token usage groupable by role straight from
the Agent tool's own invocation record, with no extra spawn spent classifying
the task.

## Cost discipline

A sub-agent starts cold. Everything it knows, it re-read — and it re-reads it on
every spawn. In the `2026-09-07-manual-mark-flown` run, `plan.json` and
`design.md` together came to 131 KB; an implementer that opened both spent
roughly 30k tokens before writing a line, and ten spawns spent it ten times.
These rules exist to stop that, and they bind the Orchestrator first because it
is the Orchestrator that fills the envelope.

**1. Pass slices, never whole artifacts.** `.claude/tools/ctx.sh` extracts them:

```
ctx.sh map    <run-id>                  index: goal, phases, task ids, design headings
ctx.sh task   <run-id> T-004            one task record            (5 KB, not 62 KB)
ctx.sh phase  <run-id> 1                a phase and its tasks
ctx.sh design <run-id> 3 5.2 must-not-change   named sections      (4 KB, not 69 KB)
ctx.sh frozen <run-id>                  frozen_decisions, verbatim
```

The Orchestrator **pastes the task record verbatim into the envelope** — it
already has it — and names design sections by number. An agent told to read
`design.md` reads 69 KB; an agent told `ctx.sh design <run> 3 5` reads 4.

**2. One spawn is the unit of cost, so spawn fewer.** Batch consecutive tasks
that share an owner, an implementer role, and a dependency chain into one
implementer agent when their `allowed_paths` do not collide with a parallel
task. Two tasks on the same file in the same phase are one agent, always. A
backend task and a frontend task never batch into one spawn, even if
sequential — different domain means a different agent. Reserve parallel spawns
for work that is genuinely independent — parallelism buys wall-clock, not
budget, and each extra agent pays the cold-start tax again.

**3. Skip the steps a run does not need.** Design is for runs that introduce a
contract — a schema change, a new endpoint, a shared type. A run that adds a
button to an existing endpoint does not need a freeze, and DevOps is for runs
that touch build, packaging or deploy. Skipping a step is a decision the
Orchestrator records in `intake.md`, not something it does silently.

**4. Evidence is quoted, not pasted.** Reports and reviews cite the command and
the lines of output that decide the question — a `tsc` run that passes is one
line, not eighty. Cap a report at ~150 lines; if the raw output matters, leave it
in a file under `reports/` and cite the path. The 41 KB review is the artifact
this rule is aimed at.

**5. The Reviewer does not read the report it is checking.** Its own doctrine is
that the implementer's report is not evidence. Reading 30 KB it is required to
distrust is the worst line item in the run. It reads the diff, the criteria and
the report's `risks` list — nothing else.

**6. Tier the work.** Not everything is a run:

| Work | Path |
| --- | --- |
| Question, investigation, one-line fix, doc typo | Orchestrator answers directly. No run id, no artifacts. |
| A change with one seam — one module, no new contract | One implementer (Jr) + one Reviewer. `intake.md` only. |
| Feature work: several files, a schema or API change, something the user sees | The full loop below. |

Spinning up a Planner for a two-line change is the failure mode. So is running
the full loop on the workflow's own config.

## Delegation contract

Every hand-off uses the same envelope.

**Request (Orchestrator → agent)**

```json
{
  "task_id": "T-004",
  "role": "backend_sr",
  "goal": "Implement flight log persistence layer",
  "task_record": { "…the task object from plan.json, pasted verbatim…" },
  "context": ["ctx.sh design 2026-09-07-run 4 6.2", "src/db.ts"],
  "constraints": ["no new runtime deps", "keep public API stable"],
  "acceptance_criteria": ["…verbatim from the task record…"],
  "allowed_paths": ["src/storage/**"]
}
```

`task_record` and `acceptance_criteria` are pasted in full so the agent never
opens `plan.json`. `context` lists exact commands or paths — never a bare
document name, and never "as discussed".

**Response (agent → Orchestrator)**

```json
{
  "task_id": "T-004",
  "status": "done | blocked | needs_input",
  "artifacts": ["src/storage/log_store.py"],
  "summary": "…",
  "risks": ["…"],
  "next_suggested_role": "reviewer"
}
```

## Standard loop

For tier-3 work only — see Cost discipline rule 6.

1. **Intake** — Orchestrator restates the goal and success criteria, and records
   which steps this run skips and why.
2. **Plan** — delegate to Planner; store `plan.json`.
3. **Design** — delegate to Designer *if the run introduces a contract*; freeze
   before code is written.
4. **Implement** — delegate to the implementer agents (`backend_jr`,
   `backend_sr`, `frontend_jr`, `frontend_sr`), batched per rule 2.
5. **Review** — every implementer and DevOps result goes to Reviewer before
   merge, at phase granularity. `request_changes` sends the task back to the
   same implementer agent (max 3 rounds, then escalate to the user).
6. **Ship** — delegate to DevOps *if the run touches build, packaging or deploy*.
7. **Report** — Orchestrator summarizes outcome, residual risks, follow-ups.

## Rules

- One task, one agent, one owner at a time.
- **Model choice matches task risk, not task size.** The defaults in the role
  files are the starting point; the Orchestrator overrides with the Agent tool's
  `model` parameter:
  - `opus` — Planner and Designer, which run once per run and decide everything
    downstream. This is the cheapest place in the workflow to spend.
  - `opus` — Backend Sr and Frontend Sr by default: a schema change, a
    migration, a new page/route, or logic spanning several modules in that
    domain.
  - `sonnet` — Backend Jr and Frontend Jr by default, and DevOps and Reviewer
    always.
  - `opus` for a Reviewer — escalate for a phase that changes the schema, runs a
    migration, deletes or overwrites data, touches credentials, or comes back for
    a second `request_changes` round.
  - `haiku` — override a Jr implementer down for a narrow, fully specified
    mechanical edit with no judgement in it.
- Agents only read/write inside their `allowed_paths`.
- No agent may skip Review; Orchestrator never merges unreviewed work.
- Any agent may return `blocked` with a concrete question instead of guessing.
- Orchestrator escalates to the user on: ambiguous requirements, destructive
  operations, credentials/secrets, or 3 failed review rounds.
- Keep every hand-off self-contained: context is passed explicitly, never
  assumed — and passed as slices, never as whole documents.
