# Agentic Workflow

## Overview

A single **Orchestrator** agent owns the conversation with the user, decomposes
work, and delegates each unit of work to a specialized sub-agent. Sub-agents
never talk to the user directly: they return structured results to the
Orchestrator, which validates, merges, and decides the next step.

```
        ┌──────────────┐
  user ─▶│ Orchestrator │◀── final report
        └──────┬───────┘
   ┌───────┬───┴───┬────────────┬──────────┐
   ▼       ▼       ▼            ▼          ▼
Planner Designer Dispatcher  DevOps    Reviewer
```

## Roles

| Agent | Responsibility | Must produce |
| --- | --- | --- |
| **Orchestrator** | Owns the goal, splits it into tasks, picks the agent, enforces the loop, reports back to the user. | Task graph + final summary |
| **Planner** | Turns a fuzzy goal into an ordered, dependency-aware task list with acceptance criteria. | `plan.json` (tasks, deps, DoD) |
| **Designer** | Defines architecture, module boundaries, data models, API/UX contracts. No implementation. | Design doc + interface stubs |
| **Dispatcher** | Executes implementation tasks: writes/edits code, runs unit tests locally. | Diff + test results |
| **DevOps** | Build, packaging, CI/CD, environment, secrets, deployment, observability. | Pipeline changes + deploy status |
| **Reviewer** | Reviews diffs against the design and acceptance criteria; checks security, tests, style. | Verdict `approve` / `request_changes` + findings |

## Delegation contract

Every hand-off uses the same envelope.

**Request (Orchestrator → agent)**

```json
{
  "task_id": "T-004",
  "role": "dispatcher",
  "goal": "Implement flight log persistence layer",
  "context": ["plan.json#T-004", "design/storage.md"],
  "constraints": ["no new runtime deps", "keep public API stable"],
  "acceptance_criteria": ["unit tests pass", "handles empty log file"],
  "allowed_paths": ["src/storage/**", "tests/storage/**"]
}
```

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

1. **Intake** — Orchestrator restates the goal and success criteria.
2. **Plan** — delegate to Planner; store `plan.json`.
3. **Design** — delegate design-bearing tasks to Designer; freeze contracts.
4. **Implement** — delegate each leaf task to Dispatcher (parallel when tasks
   are independent and touch disjoint `allowed_paths`).
5. **Review** — every Dispatcher result goes to Reviewer before merge.
   `request_changes` sends the task back to Dispatcher (max 3 rounds, then
   escalate to the user).
6. **Ship** — delegate build/deploy to DevOps once all tasks are approved.
7. **Report** — Orchestrator summarizes outcome, residual risks, follow-ups.

## Rules

- One task, one agent, one owner at a time.
- Model choice must match task complexity: use lighter/faster models for simple scoped tasks, and stronger reasoning models for ambiguous, cross-file, or high-risk tasks.
- Agents only read/write inside their `allowed_paths`.
- No agent may skip Review; Orchestrator never merges unreviewed work.
- Any agent may return `blocked` with a concrete question instead of guessing.
- Orchestrator escalates to the user on: ambiguous requirements, destructive
  operations, credentials/secrets, or 3 failed review rounds.
- Keep every hand-off self-contained: context is passed explicitly, never assumed.

## Setup checklist

1. Create `.claude/agents/` with one prompt file per role
   (`planner.md`, `designer.md`, `dispatcher.md`, `devops.md`, `reviewer.md`).
2. Give each file: role description, inputs, outputs, tool allow-list, and the
   response envelope above.
3. Point the Orchestrator prompt at this document as its routing policy.
4. Store run artifacts (`plan.json`, design docs, review logs) under `.claude/runs/<run-id>/`.
