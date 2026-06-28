# inspect: `setup` (`SSS.S`)

**What it is:** the session-level prelude shared by the whole session — holds the
`system_prompt`, `mcp_instructions`, and `tool_definitions` parts
([`DATA-MODEL.md:110-115`](../../../../DATA-MODEL.md);
[`hierarchicalLookup.ts:225-237`](../../../../backend/src/runtime/hierarchicalLookup.ts)).

Example: [`example-9LJM-setup.md`](example-9LJM-setup.md).

## Summary mode — use-cases

- **Enumerate setup parts and their token weight** (e.g. how many tokens
  `tool_definitions` costs) without pulling the schema blob. `tool_definitions` still
  shows the tool-**name** list even in summary
  ([`hierarchicalLookup.ts:170-179`](../../../../backend/src/runtime/hierarchicalLookup.ts)).
- **Find the part IDs** (`.S.1-MI`, `.S.2-TD`, …) to drill into.

## Full mode — use-cases

- **Read the system prompt and `mcp_instructions` text the model actually saw**, to
  judge whether *configuration* (not the model) caused a failure — "inspect the setup
  snapshot when diagnosis depends on configuration"
  ([`agent-skill-patterns-for-mcpscope.md`](../../agent-skill-patterns-for-mcpscope.md)).
- **Caveat:** a full-mode setup inspect still lists `tool_definitions` as **names only**;
  the full JSON schemas require a *direct* part lookup of `.S.2-TD`
  ([`hierarchicalLookup.ts:170-180`](../../../../backend/src/runtime/hierarchicalLookup.ts)).

## Dog-fooding evidence

- Bootstrap inspects the target session's setup parts deterministically
  (`target_mcp_instructions_part_id`, `target_tool_definitions_part_id` appended to
  `bootstrapInspectIds`) — explicitly because "the analysis session already has its own
  restricted MCP setup", so it must read the *target's* environment
  ([`completed/SESSION-ANALYSIS.md`](../../completed/SESSION-ANALYSIS.md)).
- Why setup matters to the judge: "Setup parts such as mcp-instructions and
  tool-definitions describe the tool environment and are often relevant when judging
  whether a tool call or result interpretation was reasonable"
  ([`fullSession/systemPrompt.ts:23`](../../../../backend/src/analysis/fullSession/systemPrompt.ts)).

## Tuning notes (Phase 2)

- **F6 — judgment call (default implemented).** A full setup still lists `tool_definitions`
  as **names only** (now with a **tool count**), not the full schemas. Inlining ~5k tokens
  of schemas into the most-fetched router payload would defeat the token-efficiency goal,
  so the schemas stay one drill away at the `-TD` part; the count + token weight are the
  discoverability signal. *Open for review:* whether a full **setup** specifically (not a
  session) should inline schemas, since "inspect the setup in full" most strongly implies
  wanting them — left out by default as the low-risk choice.
