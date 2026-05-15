# CLI Design for Coding Agents

---

## Summary

Recent agent-facing CLIs converge on a few clear patterns: **stable machine-readable output, explicit non-interactive behavior, small default responses, asynchronous job handling, and structured errors**. The best current references are **CLIG.dev**, **Claude Code**, **GitHub CLI**, **Temporal CLI**, **OpenAI CLI**, and **Aider**.

For mcpscope, the current direction is already strong:

- CLI-first for automation
- shared DB/session model with the UI
- hierarchical IDs for session / turn / round / part
- summary-first inspection
- synchronous failure for session creation
- asynchronous handling for long-running turns

The main remaining gaps are specification details: output format contracts, exit codes, non-interactive rules, async command semantics, structured errors, and output size controls.

---

## Key best practices

### 1. Machine-readable output must be first-class

Agent-facing CLIs should always support stable structured output, typically JSON or NDJSON.

- **CLIG.dev** recommends explicit JSON output for scripting: https://clig.dev/#output
- **Claude Code** exposes `text`, `json`, and `stream-json`: https://docs.anthropic.com/en/docs/claude-code/headless
- **OpenAI CLI** supports multiple output formats including JSON/JSONL: https://github.com/openai/openai-cli

**Implication for mcpscope:** every data-returning command should support `--format text|json|stream-json`, and JSON mode should be stable and versioned.

### 2. IDs must be stable and routable

Agent workflows depend on IDs returned immediately and reused later.

- **Claude Code** returns `session_id` and supports resume/attach/logs: https://docs.anthropic.com/en/docs/claude-code/headless
- **Temporal CLI** returns workflow IDs and uses them across start/describe/cancel: https://docs.temporal.io/cli/workflow

**Implication for mcpscope:** the hierarchical `SSS.T.R.P` direction is correct and should become part of the stable CLI contract.

### 3. Non-interactive mode must be explicit

Agents should never get stuck on prompts.

- **CLIG.dev** recommends `--no-input`: https://clig.dev/#interactivity
- **Aider** uses `--yes` for automatic confirmation: https://aider.chat/docs/scripting.html

**Implication for mcpscope:** define `--no-input` and `--yes`, and auto-disable prompts in non-TTY/CI contexts.

### 4. Long-running work should use submit / status / follow

Blocking one-shot commands are a poor fit for agent workflows.

- **Claude Code Agent View** uses background jobs plus logs/stop/attach: https://docs.anthropic.com/en/docs/claude-code/agent-view
- **Temporal CLI** separates start from execute/follow: https://docs.temporal.io/cli/workflow
- **GitHub CLI** has explicit watch/follow behavior: https://cli.github.com/manual/gh_run_watch

**Implication for mcpscope:** define explicit semantics for `start`, `status`, `follow`, `wait`, and `cancel`.

### 5. Default output should be summary-first

Context window is a scarce resource for coding agents.

- Anthropic highlights context pressure explicitly: https://www.anthropic.com/engineering/claude-code-best-practices
- GitHub CLI reduces payload size with `--json <fields>` and filtering: https://cli.github.com/manual/gh_pr_list

**Implication for mcpscope:** default responses should be short summaries; full content should require targeted inspect commands.

### 6. Errors must be structured and actionable

Agents need to know what failed and whether retry makes sense.

- **CLIG.dev** emphasizes actionable error messages: https://clig.dev/#errors
- **Claude Code** exposes structured retry/error events in streaming mode: https://docs.anthropic.com/en/docs/claude-code/headless

**Implication for mcpscope:** JSON errors should include `code`, `stage`, `retryable`, and `suggestion`.

### 7. Stdout/stderr discipline matters

- **CLIG.dev**: machine-readable output belongs on stdout, logs/progress/errors on stderr: https://clig.dev/#the-basics

**Implication for mcpscope:** never mix plain text progress with JSON payloads on stdout.

### 8. Versioning and stability must be documented

Agents script against the CLI. The structured output is an API.

- **CLIG.dev** discusses future-proofing machine output: https://clig.dev/#future-proofing

**Implication for mcpscope:** add `api_version` to JSON output and make `--version` machine-readable.

---

## Notable examples and what to learn from them

| Tool | URL | Key lesson for mcpscope |
|---|---|---|
| CLIG.dev | https://clig.dev/ | Foundation for output, errors, flags, interactivity, future-proofing |
| Claude Code headless | https://docs.anthropic.com/en/docs/claude-code/headless | Best current model for agent-first CLI, stream-json, structured outputs, session IDs |
| Claude Code Agent View | https://docs.anthropic.com/en/docs/claude-code/agent-view | Background job model, logs/attach/stop semantics, compact status |
| GitHub CLI | https://cli.github.com/manual/gh_pr_list | `--json <fields>`, filtering, compact machine-readable listings |
| GitHub CLI watch | https://cli.github.com/manual/gh_run_watch | Good follow/watch behavior for long-running jobs |
| Temporal CLI | https://docs.temporal.io/cli/workflow | Clear start/status/follow/cancel lifecycle for long-running work |
| OpenAI CLI | https://github.com/openai/openai-cli | Global format handling and separation of output modes |
| Aider scripting | https://aider.chat/docs/scripting.html | `--yes`, `--message-file`, `--dry-run`, scripting ergonomics |

---

## Gaps and risks in the current mcpscope spec

The direction is correct, but these pieces still need to be made explicit:

1. **Output contract**  
   The spec says "machine-readable output" but does not define JSON schemas or formats.

2. **Exit code taxonomy**  
   Initialization failure, runtime failure, timeout, and usage error should not all collapse into one exit code.

3. **Non-interactive behavior**  
   The spec should explicitly forbid prompts in agent/CI mode.

4. **Output minimization controls**  
   There is no explicit `--fields`, `--limit`, or `--quiet` contract yet.

5. **Stream vs. poll semantics**  
   The distinction between `status`, `follow`, and `wait` should be explicit.

6. **Retry guidance in errors**  
   The spec says errors should guide retry behavior, but not yet how.

7. **Version stability**  
   The CLI’s machine-readable contract needs versioning.

8. **Signal/interruption behavior**  
   Long-running commands should not leave turns stuck in `running` forever after interruption.

---

## Recommended additions for mcpscope

### Output format contract

All commands should support:

- `--format text`
- `--format json`
- `--format stream-json`

In JSON modes:

- stdout is structured output only
- stderr is logs/progress/warnings
- all objects include `api_version`

### Exit codes

Recommended minimum set:

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | general error |
| 2 | usage error |
| 3 | initialization/dependency failure |
| 4 | runtime failure after successful start |
| 5 | timeout / partial / interrupted waiting |
| 130 | SIGINT |

### Standard flags

Recommended standard flags:

- `--format`
- `--fields`
- `--limit`
- `--quiet`
- `--no-input`
- `--yes`
- `--dry-run`
- `--async`
- `--follow`
- `--timeout`

### Error object shape

Example:

```json
{
  "error": true,
  "code": "INIT_MCP_UNAVAILABLE",
  "message": "MCP server 'filesystem' is not reachable",
  "stage": "initialization",
  "retryable": false,
  "suggestion": "Check MCP server configuration in the UI settings",
  "api_version": 1
}
```

### Job/status object shape

Example:

```json
{
  "id": "test5.3",
  "type": "turn",
  "status": "running",
  "session_id": "test5",
  "current_round": 2,
  "tools_called": ["read_file", "list_directory"],
  "tokens_used": 4821,
  "latest_part_id": "test5.3.2.1",
  "elapsed_ms": 12400,
  "api_version": 1
}
```

---

## Suggested command and UX rules

1. **Creation commands always return IDs immediately**
2. **Long-running commands support both async and follow modes**
3. **List commands are field-selectable and limitable**
4. **Hierarchical IDs are accepted directly in inspect/show commands**
5. **Errors never leave zombie state behind**
6. **Status, follow, and inspect are distinct concepts**
7. **Token counts are exposed at every level**
8. **Errors include suggestions and retryability**
9. **CI/non-TTY mode implies non-interactive behavior**
10. **`--version` is machine-readable**

---

## Anti-patterns to avoid

- mixed stdout text + JSON
- optional prompts in script paths
- unstable or opaque IDs
- verbose default list output
- ANSI in non-TTY output
- pagers in agent flows
- async commands that hide immediate validation failures
- relying on humans to parse unstable text output in scripts

---

## Summary table

| Area | Recommendation for mcpscope | Why it matters |
|---|---|---|
| Output | `--format text/json/stream-json` | Stable parsing for agents |
| IDs | Hierarchical stable IDs (`SSS.T.R.P`) | Shared references across UI and CLI |
| Interactivity | `--no-input`, `--yes`, no prompts in CI | Prevent hangs |
| Long-running work | `start/status/follow/wait/cancel` model | Better than blocking-only commands |
| Errors | Structured JSON with `retryable` and `suggestion` | Stops pointless retries |
| Exit codes | Distinct codes for init/runtime/timeout | Lets agents branch correctly |
| Output size | `--fields`, `--limit`, `--quiet` | Protects token budget |
| Streams | NDJSON for follow/progress | Efficient incremental inspection |
| Stability | `api_version` + machine-readable `--version` | Safe scripting contract |
| Collaboration | Shared DB and IDs with UI | Human and agent inspect same artifacts |

---

## Sources

1. CLI Guidelines (CLIG.dev): https://clig.dev/
2. Claude Code CLI Reference: https://docs.anthropic.com/en/docs/claude-code/cli-reference
3. Claude Code Headless Mode: https://docs.anthropic.com/en/docs/claude-code/headless
4. Claude Code Agent View: https://docs.anthropic.com/en/docs/claude-code/agent-view
5. Claude Code Best Practices: https://www.anthropic.com/engineering/claude-code-best-practices
6. Claude Agent SDK Overview: https://docs.anthropic.com/en/docs/claude-code/agent-sdk/overview
7. Claude Agent SDK Structured Outputs: https://docs.anthropic.com/en/docs/claude-code/agent-sdk/structured-outputs
8. Aider scripting: https://aider.chat/docs/scripting.html
9. OpenAI CLI: https://github.com/openai/openai-cli
10. GitHub CLI PR list: https://cli.github.com/manual/gh_pr_list
11. GitHub CLI run watch: https://cli.github.com/manual/gh_run_watch
12. GitHub CLI api: https://cli.github.com/manual/gh_api
13. Temporal CLI workflow: https://docs.temporal.io/cli/workflow
