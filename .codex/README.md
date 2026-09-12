# Codex workflow adapter

Start a new Codex session in this repository to load `AGENTS.md` and the eight
custom agents in `agents/`. Project configuration requires the checkout to be
trusted in Codex. The main agent follows the existing workflow automatically
according to its three task tiers.

The role TOMLs load the matching `.claude/agents/*.md` instructions at task time,
so edits to those role instructions apply to both tools without regeneration.
Routing, environment facts, context slicing, and run history stay in `.claude/`.
Codex-specific differences live in the root `AGENTS.md`.

Models inherit your selected Codex model; the Orchestrator selects reasoning
according to role and risk. Claude model names and permission allowlists are
not imported as executable Codex settings. No global Codex settings are changed.

When adding a role, add its matching TOML here and update the role list in
`AGENTS.md`. Keep `name`, `description`, and `developer_instructions` present.
A reviewer needs to write review artifacts, so it inherits session permissions
and is instructed to leave application source unchanged.

References: [project instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
[custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[configuration](https://learn.chatgpt.com/docs/config-file/config-reference).
