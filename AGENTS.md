# msfslogger — Codex instructions

This repository shares its agentic workflow between Claude Code and Codex.
The source of truth stays in `.claude/`; apply the Codex adaptations below
when reading those files.

## Start here

Every agent reads [.claude/ENVIRONMENT.md](.claude/ENVIRONMENT.md) before running
commands. Use Node 20 via nvm for every Node/npm/npx command. Protect the user's
server on port 3000 and live `flights.db`; verification that writes uses a
scratch database and another port. Preserve unrelated working-tree changes.
Read `README.md` before changing behavior it documents.

**Main agent:** you are the Orchestrator. Read [CLAUDE.md](CLAUDE.md) and
[.claude/agents.md](.claude/agents.md) for the routing policy, loop, verification,
and delegation envelopes. Their workflow rules apply in Codex with the
adaptations in this file.

**Delegated agent:** you are the role assigned by the Orchestrator, not another
Orchestrator. Read only `.claude/ENVIRONMENT.md`, your matching
`.claude/agents/<role>.md`, and the context explicitly supplied in your envelope.
Do not read `CLAUDE.md` or `.claude/agents.md`, and do not spawn further agents.
Return your role's response envelope to the Orchestrator.

## Workflow tiers and delegation

- Questions, investigations, tiny fixes, and workflow configuration/documentation
  changes: handle directly. No run artifacts or subagents.
- One module with no new contract: delegate to one implementer, then a separate
  Reviewer. Use `intake.md`; keep results in the response envelopes rather than
  creating a full plan/design/report tree.
- Feature work across files or involving a schema/API/user-facing change:
  use the full Intake → Planner → Designer (when introducing a contract) →
  Implementer → Reviewer → DevOps (when build/packaging/deploy is involved) loop.
  Record skipped steps in intake. Review DevOps results too.

For the latter two tiers, **use subagents explicitly**. Select the matching
custom role in `.codex/agents/`: `planner`, `designer`, `backend_jr`, `backend_sr`,
`frontend_jr`, `frontend_sr`, `devops`, or `reviewer`. If the available spawn tool
has no custom-role selector, use its general agent with an explicit instruction
to read `.claude/agents/<role>.md` and apply this file's Codex adaptations.
If delegation is unavailable, report that limitation; do not claim independent
review happened.

Pass the run id, verbatim task record and acceptance criteria, constraints,
allowed paths (including any permitted artifact outputs), and exact context
slice commands. Prefer a fresh context when the tool supports it. Agents may
read their role/environment instructions and explicitly supplied context even
when those paths lie outside their write scope; `allowed_paths` bounds edits.
Batch dependent tasks sharing a domain, role and file owner. Parallelize only
independent tasks with disjoint write paths. Reuse the same implementer for
review fixes; after three failed rounds, escalate. Only the Orchestrator manages
commits or branches. Never merge implementation without independent review.

## Codex adaptations

- Claude's `Agent`, `Read`, `Grep`, `Glob`, `Bash`, `Write`, `Edit`, `WebSearch`,
  and `WebFetch` mean the equivalent tools available in this Codex session.
  Claude YAML frontmatter is source metadata, not Codex configuration.
- Do not pass `opus`, `sonnet`, or `haiku` as Codex model IDs. Inherit the user's
  selected model. Request `high` reasoning for Planner, Designer, and senior
  implementers; `medium` for junior implementers, DevOps, and routine review;
  `low` for a fully specified mechanical junior task. High-risk review (schema,
  migration, data deletion/overwrite, credentials, or the second changes round)
  uses `high`. Treat legacy `model_hint` values as these risk/effort hints.
  If the tool cannot select effort, keep the inherited setting and role scope.
- The role files allow batches assigned by the Orchestrator even where they say
  "exactly one task". Use the supplied criteria when no plan or design is needed.
- `.claude/ENVIRONMENT.md` and current project scripts take precedence over stale
  role examples: the project has Vitest (`npm test`, `npm run test:types`).
- `.claude/settings.json` permissions are specific to Claude Code. Codex uses
  its active sandbox and approval settings; this import does not grant shell,
  network, or filesystem permissions.
- Honor authorization and frozen decisions already supplied by the user.
  Resolve routine implementation choices within scope; ask only for material
  missing requirements or actions that actually require new authorization.

## Shared run history

Both tools write durable feature artifacts to `.claude/runs/<run-id>/`, following
[.claude/runs/README.md](.claude/runs/README.md). Do not duplicate history under
`.codex/`. Use `.claude/tools/ctx.sh map|task|phase|design|frozen` for slices of
existing artifacts; never load whole plans or designs just to find one task.
Keep workflow citations out of application source comments.
