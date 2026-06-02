# Agent skill patterns for mcpscope

## Why this note exists

We are considering shipping a reusable agent skill that teaches a coding agent how to use **mcpscope** well:

- start the released Docker image
- use the packaged CLI
- run one session at a time
- inspect traces
- evaluate MCP server quality
- iterate on tool descriptions, schemas, and payloads

This note captures public precedents and the recommended shape for an mcpscope skill.

## Short conclusion

Yes, publishing a skill for mcpscope makes sense.

There are already public repositories that ship:

- explicit `SKILL.md` files
- skill directories
- adjacent agent-instruction files such as `AGENTS.md`, `.agents/tools.md`, or Cursor/Claude rule files

The strongest precedent is tools that teach an agent how to use a **development or testing CLI** in a disciplined way. mcpscope fits that pattern well.

## Strong public examples

### 1. MCPJam Inspector

- Repo: `MCPJam/inspector`
- File: `skills/mcp-inspector/SKILL.md`
- Why it matters:
  - closest match to mcpscope
  - an MCP inspection tool shipping an agent skill for investigating MCP server behavior
  - includes workflow, command choices, output contract, and hard rules

Key characteristics:

- YAML front matter with `name` and `description`
- numbered investigation workflow
- security-review workflow
- command choice section
- output contract
- explicit hard rules
- reference map to supporting files

Observed opening:

```yaml
---
name: mcp-inspector
description: Interpret and use `mcpjam` probe, doctor, OAuth, apps conformance, tools, resources, and prompts output conservatively...
---
```

## 2. Chrome DevTools MCP

- Repo: `ChromeDevTools/chrome-devtools-mcp`
- File: `skills/chrome-devtools-cli/SKILL.md`
- Why it matters:
  - a development tool ships a skill that teaches an agent how to drive the CLI
  - separates one-time setup from the recurring AI workflow
  - has a very practical command reference

Key characteristics:

- short front matter
- `Setup` section
- `AI Workflow` section
- command reference grouped by task area

Observed opening:

```yaml
---
name: chrome-devtools-cli
description: Use this skill to write shell scripts or run shell commands to automate tasks in the browser or otherwise use Chrome DevTools via CLI.
---
```

## 3. Anthropic knowledge-work plugins

- Repo: `anthropics/knowledge-work-plugins`
- File: `partner-built/zoom-plugin/skills/zoom-mcp/SKILL.md`
- Why it matters:
  - shows a production-style skill format
  - includes `triggers`
  - includes quick start, tool catalog, workflows, error reference, and related skills

Key characteristics:

- front matter with `name`, `description`, `user-invocable`, `triggers`
- quick start
- critical notes
- tool catalog table
- error table
- related skills

Observed opening:

```yaml
---
name: zoom-mcp
description: Guidance for the bundled Zoom MCP connectors...
user-invocable: false
triggers:
  - "zoom mcp"
  - "zoom mcp server"
  ...
---
```

## 4. Hermes Agent / FastMCP

- Repo: `NousResearch/hermes-agent`
- File: `optional-skills/mcp/fastmcp/SKILL.md`
- Why it matters:
  - MCP-oriented skill
  - covers building, testing, installing, and validating an MCP server
  - includes richer metadata and a strong workflow structure

Key characteristics:

- front matter with metadata, tags, prerequisites
- when-to-use / when-not-to-use guidance
- workflow phases
- common patterns
- quality bar
- troubleshooting

Observed opening:

```yaml
---
name: fastmcp
description: Build, test, inspect, install, and deploy MCP servers with FastMCP in Python...
version: 1.0.0
prerequisites:
  commands: [python3]
---
```

## 5. GSD create-mcp-server skill

- Repo: `gsd-build/gsd-2`
- File: `src/resources/skills/create-mcp-server/SKILL.md`
- Why it matters:
  - very relevant to the mcpscope use case
  - emphasizes real task completion, not just schema validity
  - explicitly includes testing and evaluation

Key characteristics:

- front matter
- objective/context/core principle
- numbered process
- anti-patterns
- success criteria

Most relevant principle:

> The quality metric is task completion, not schema validity.

That is highly aligned with mcpscope's purpose.

## Adjacent patterns

Even when repos do not use `SKILL.md`, they often publish equivalent agent guidance.

### JetBrains MPS

- Repo: `JetBrains/MPS`
- File: `.agents/tools.md`
- Pattern:
  - a dedicated file teaching the agent when and how to use each available tool
  - includes behavioral rules and safety constraints

### Hortonworks Cloudbreak

- Repo: `hortonworks/cloudbreak`
- Files:
  - `AGENTS.md`
  - `.agent/skills/.../SKILL.md`
- Pattern:
  - repo-wide skill library
  - root agent file acts as a router/index

### Cursor / Claude style rule files

Examples found in the research pass:

- `.cursor/rules/...`
- `.claude/skills/.../SKILL.md`

These are the same basic idea in ecosystem-specific locations.

## Common structure across good examples

The strong examples mostly converge on the same shape.

### Minimal useful front matter

```yaml
---
name: <skill-name>
description: >
  What the skill does, when to use it, and what kind of task it is for.
---
```

### Common optional metadata

```yaml
---
triggers:
  - "..."
user-invocable: false
prerequisites:
  commands: [docker]
version: 1.0.0
---
```

### Common sections

1. purpose / when to use
2. prerequisites or setup
3. numbered AI workflow
4. command reference
5. hard rules / anti-patterns
6. output or reporting contract
7. links to supporting docs

## Why mcpscope is a good candidate

mcpscope is not just a command set. It embodies a workflow:

1. configure defaults once in the Web UI
2. create a fresh session
3. wait until it is ready
4. send a prompt
5. inspect the trace
6. diagnose whether the MCP server, tool descriptions, schemas, or payloads need work
7. repeat with a fresh session

That is exactly the kind of multi-step operating procedure that skills help with.

An mcpscope skill would likely improve:

- agent consistency
- correct use of one-session-at-a-time execution
- disciplined trace inspection
- better iteration on tool descriptions and schemas
- lower risk of agents using the CLI in a shallow way

## Recommended shape for mcpscope

### Proposed location

For a neutral repo-owned version:

- `skills/mcpscope/SKILL.md`

This keeps the skill tool-owned and portable. It can later be copied or adapted to:

- `.claude/skills/mcpscope/SKILL.md`
- `.cursor/rules/...`
- `AGENTS.md`

### Recommended scope

The first mcpscope skill should teach:

1. the Docker quick start
2. the packaged CLI wrapper pattern
3. the session lifecycle loop:
   - `list`
   - `create`
   - `status`
   - `send`
   - `inspect`
4. why sequential runs matter
5. how to inspect:
   - setup
   - turn
   - rounds
   - tool calls
   - tool results
6. how to turn a trace into actionable MCP feedback

### What it should explicitly tell the agent to evaluate

- whether the model chose the right tool
- whether the tool description was specific enough
- whether arguments were well-formed and sensible
- whether the tool result payload was actually useful
- whether the model had to work too hard around the payload shape
- whether context size or noise may have harmed the run

### Hard rules that should likely be in the skill

- do not run multiple sessions in parallel
- use a fresh session after changing defaults or MCP configuration
- prefer text output unless JSON is really needed
- do not judge tool descriptions without inspecting the actual trace
- inspect the setup snapshot (`ABCD.S`) when diagnosis depends on configuration
- do not claim success just because the final assistant answer looked plausible

## Suggested minimal content for the skill

The first version should probably include:

- front matter
- when to use
- prerequisites
- quick start
- evaluation workflow
- inspection checklist
- report template
- hard rules
- reference map:
  - `TUTORIAL.md`
  - `CLI.md`
  - `ARCHITECTURE.md`

## Recommended next step

Create a first repo-owned draft at:

- `skills/mcpscope/SKILL.md`

Keep it:

- short
- operational
- opinionated
- aligned with the current shipped Docker + CLI workflow

Then later, if needed, adapt it for specific agent ecosystems.
