# Hierarchical IDs and Lookup API

mcpscope needs one compact canonical reference system for sessions, turns, rounds, and logical parts, together with one generic JSON lookup operation.

This is **not** a greenfield feature anymore. A partial implementation already exists, but it reflects an older and now superseded direction. This task must therefore **correct, simplify, and clean up** that existing work so the backend, UI, and docs all converge on the model defined in [DATA-MODEL.md](../DATA-MODEL.md).

This is a foundational task for:

- backend consistency
- Web UI inspect workflows
- future `mcpscope-cli`
- human/agent collaboration

The same ID must let a human and a coding agent refer to the same object without ambiguity.

## Correction and cleanup of the current implementation

The current codebase already contains hierarchical lookup work, but the code audit shows that it still carries outdated choices that should be treated as provisional rather than preserved.

This task should explicitly clean up and replace the earlier approach in the following areas:

- the lookup payload shape still reflects the old contract and must be rewritten to match the canonical runtime tree from [DATA-MODEL.md](../DATA-MODEL.md)
- obsolete payload fields such as duplicated context arrays, previews, labels, and other transitional fields should be removed rather than adapted
- the previous setup-as-prelude/turn-0 approach should be replaced by the explicit `Setup` node model
- lookup examples and tests should validate the new canonical payloads directly, not preserve compatibility with the old response shape
- frontend types and inspect-mode lookup usage should be updated to the cleaned-up contract rather than carrying compatibility layers
- the current API reference tooling around lookup should be reduced to the minimum needed or removed if it no longer pulls its weight after the simplification

### API documentation tooling cleanup

The current implementation includes extra machinery around lookup documentation and payload auditing, including:

- backend OpenAPI schema generation dedicated to the old lookup payload shape
- `/reference/` integration for browsing those generated docs
- test-generated lookup payload audit artifacts under `test-results/`

After the contract simplification, this should be reassessed aggressively:

- keep only the minimum documentation tooling that is clearly useful
- prefer the canonical examples in this task spec over large generated payload-audit machinery
- if the OpenAPI/reference path is no longer providing enough value for its complexity, remove it

## Core principles

- IDs must be stable, human-readable, easy to copy, and easy to parse.
- The public lookup model must follow **mcpscope's canonical runtime model** defined in [DATA-MODEL.md](../DATA-MODEL.md), not LM Studio transport details.
- The lookup API must be **compact** and must not duplicate large parts of the trace in multiple shapes.
- **Summary** and **full** mode must return the **same tree structure**. The difference is content inclusion, not a different object model.
- The API must be JSON-only. Rendering for UI or CLI is a client concern.

## Canonical model reference

The canonical tree, public part taxonomy, public node properties, and canonical ID rules are defined in [DATA-MODEL.md](../DATA-MODEL.md).

This task should implement the lookup API and UI behavior against that model instead of redefining it here.

## ID format

Implement the hierarchical ID system defined in [DATA-MODEL.md](../DATA-MODEL.md), including explicit setup IDs and typed part suffixes.

## Lookup API

Add one generic lookup operation that accepts a hierarchical ID and resolves the represented object.

Examples:

- session ID -> return that session subtree
- turn ID -> return that turn subtree
- round ID -> return that round subtree
- part ID -> return that logical part

The backend should:

- parse the ID
- infer the target type
- resolve the target object
- return structured JSON
- return clear errors for invalid IDs and not-found IDs

The response envelope should stay simple:

- `id`
- `type`
- `mode`
- `data`

No redundant `parentIds` object is needed because ancestry is already encoded in the ID.

## Payload contract

Lookup payloads should be compact, tree-shaped, and should follow the public node properties defined in [DATA-MODEL.md](../DATA-MODEL.md).

Lookup payloads must **not** include:

- raw LM Studio transport blobs
- duplicated context arrays
- preview snippets
- ambiguous display-only attributes such as `label` unless they have a clear semantic role

### Summary vs full

The difference between the modes should be narrow and predictable:

- **summary** -> same tree and same node properties, but without variable-size content
- **full** -> same tree and same node properties, with the allowed content fields populated

This is the key rule: full mode adds content; it should not invent a different payload shape.

### Content rules

- For session / turn / round lookups, full mode additionally includes full text for `user_prompt` and `assistant_answer`.
- For direct part lookups, full mode may include the full payload appropriate to that part type.
- `tool_call` full mode should include the tool name plus tool request and tool response payloads.
- `tool_definitions` full mode should include the actual tool definitions payload.

### Field presence rules

- Omit a property when it does not apply to the current node type.
- Omit a property when it is pruned by `summary` mode.
- Use `null` only when a property applies but its value is genuinely unknown or unavailable.

Examples:

- omit `tool_name` on non-`tool_call` parts
- omit `content` in `summary` mode
- omit `tool_payload` except on direct `tool_call` full lookups
- allow `token_count: null` when token attribution is unknown

## Session payload requirements

Session lookup is the most important case because it is the main navigation entry point for UI and CLI.

Both summary and full mode should include the `Session` properties defined in [DATA-MODEL.md](../DATA-MODEL.md), including setup, turns, model metadata, and context-window totals.

Summary mode exists so a client can cheaply obtain the full ID tree before deciding which deeper content to fetch.

## Context-related metadata

Parts should include the metadata needed to understand:

- token counts
- whether the part remains in model-visible context or not

That information belongs on the relevant tree nodes. The lookup API should not also dump a separate flattened context snapshot array into the same payload.

## UI scope

The Web UI should adopt the ID system before the CLI exists.

Required outcomes:

- show IDs for sessions, turns, rounds, and parts in Inspect mode
- make IDs easy to copy
- make the hierarchy clear enough that humans can reference objects confidently
- expose actions to fetch lookup JSON in summary and full mode
- show the returned JSON in the existing JSON dialog

This is enough to validate the contract end to end before the CLI is implemented.

## Scope

- implement the canonical hierarchical ID format from [DATA-MODEL.md](../DATA-MODEL.md)
- make IDs stable and available across the model
- implement generic hierarchical lookup by ID
- return compact tree-shaped JSON matching [DATA-MODEL.md](../DATA-MODEL.md)
- support summary and full mode with the same structure and node properties
- expose IDs and lookup actions in the UI

## Non-goals

- full CLI implementation
- CLI-oriented text formatting in the backend
- exposing raw LM Studio transport structures through the lookup contract
- broad API redesign beyond what is needed for the canonical lookup model

## Acceptance criteria

- humans and agents can refer to sessions, turns, rounds, and logical parts with one stable canonical ID system
- part IDs encode part kind
- setup / prelude nodes are addressable within the same reference system
- lookup returns one compact tree-shaped contract for session / turn / round / part
- summary and full mode share the same structure
- session lookup gives the full ID tree without embedding unnecessary duplicated payloads
- direct tool-call part lookup can return full request/response payloads in full mode
- the UI can display, copy, and exercise the IDs through the lookup API

## Dependency

This task should be completed before implementing `mcpscope-cli`.

The examples below are simplified subsets based on `exports/test-with-multiple-turns-and-tools.trace.json`.

## Example: session summary

```json
{
  "id": "QGWA",
  "type": "session",
  "mode": "summary",
  "data": {
    "id": "QGWA",
    "title": "Test with multiple turns and tools",
    "model": {
      "name": "Gemma 4 (lms1)",
      "key": "google/gemma-4-e4b"
    },
    "mcp": {
      "name": "HA Sanzay",
      "strategy": "per-turn"
    },
    "context_window": {
      "available": 65496,
      "used": 16466
    },
    "setup": {
      "id": "QGWA.S",
      "parts": [
        {
          "id": "QGWA.S.1-SP",
          "type": "system_prompt",
          "token_count": 167,
          "context_state": "included"
        },
        {
          "id": "QGWA.S.2-MI",
          "type": "mcp_instructions",
          "token_count": 373,
          "context_state": "included"
        },
        {
          "id": "QGWA.S.3-TD",
          "type": "tool_definitions",
          "token_count": 4175,
          "context_state": "included"
        }
      ]
    },
    "turns": [
      {
        "id": "QGWA.1",
        "number": 1,
        "status": "complete",
        "rounds": [
          {
            "id": "QGWA.1.1",
            "number": 1,
            "status": "complete",
            "parts": [
              {
                "id": "QGWA.1.1.1-U",
                "type": "user_prompt",
                "token_count": 21,
                "context_state": "included"
              },
              {
                "id": "QGWA.1.1.2-T",
                "type": "tool_call",
                "token_count": 106,
                "context_state": "historical_only",
                "tool_name": "ha_history_get_current_time"
              }
            ]
          },
          {
            "id": "QGWA.1.2",
            "number": 2,
            "status": "complete",
            "parts": [
              {
                "id": "QGWA.1.2.1-A",
                "type": "assistant_answer",
                "token_count": 32,
                "context_state": "included"
              }
            ]
          }
        ]
      }
    ]
  }
}
```

## Example: session full

```json
{
  "id": "QGWA",
  "type": "session",
  "mode": "full",
  "data": {
    "id": "QGWA",
    "title": "Test with multiple turns and tools",
    "model": {
      "name": "Gemma 4 (lms1)",
      "key": "google/gemma-4-e4b"
    },
    "mcp": {
      "name": "HA Sanzay",
      "strategy": "per-turn"
    },
    "context_window": {
      "available": 65496,
      "used": 16466
    },
    "setup": {
      "id": "QGWA.S",
      "parts": [
        {
          "id": "QGWA.S.1-SP",
          "type": "system_prompt",
          "token_count": 167,
          "context_state": "included"
        },
        {
          "id": "QGWA.S.2-MI",
          "type": "mcp_instructions",
          "token_count": 373,
          "context_state": "included"
        },
        {
          "id": "QGWA.S.3-TD",
          "type": "tool_definitions",
          "token_count": 4175,
          "context_state": "included"
        }
      ]
    },
    "turns": [
      {
        "id": "QGWA.1",
        "number": 1,
        "status": "complete",
        "rounds": [
          {
            "id": "QGWA.1.1",
            "number": 1,
            "status": "complete",
            "parts": [
              {
                "id": "QGWA.1.1.1-U",
                "type": "user_prompt",
                "token_count": 21,
                "context_state": "included",
                "content": {
                  "text": "Hello! how are you doing? Can you give me that time and date?"
                }
              },
              {
                "id": "QGWA.1.1.2-T",
                "type": "tool_call",
                "token_count": 106,
                "context_state": "historical_only",
                "tool_name": "ha_history_get_current_time"
              }
            ]
          },
          {
            "id": "QGWA.1.2",
            "number": 2,
            "status": "complete",
            "parts": [
              {
                "id": "QGWA.1.2.1-A",
                "type": "assistant_answer",
                "token_count": 32,
                "context_state": "included",
                "content": {
                  "text": "The current time in Sanzay is 12:32 PM on Friday, May 15, 2026."
                }
              }
            ]
          }
        ]
      }
    ]
  }
}
```

## Example: direct tool-call part full

```json
{
  "id": "QGWA.1.1.2-T",
  "type": "part",
  "mode": "full",
  "data": {
    "id": "QGWA.1.1.2-T",
    "type": "tool_call",
    "token_count": 106,
    "context_state": "historical_only",
    "tool_name": "ha_history_get_current_time",
    "tool_payload": {
      "call": {},
      "result": {
        "text": "Current time:  2026-05-15T12:32:31+02:00\nDate:          Friday 15 May 2026\nUTC offset:    +02:00\nWeek:          20 of 2026\nHome:          Sanzay"
      }
    }
  }
}
```

## Example: setup full

```json
{
  "id": "QGWA.S",
  "type": "setup",
  "mode": "full",
  "data": {
    "id": "QGWA.S",
    "parts": [
      {
        "id": "QGWA.S.1-SP",
        "type": "system_prompt",
        "token_count": 167,
        "context_state": "included"
      },
      {
        "id": "QGWA.S.2-MI",
        "type": "mcp_instructions",
        "token_count": 373,
        "context_state": "included"
      },
      {
        "id": "QGWA.S.3-TD",
        "type": "tool_definitions",
        "token_count": 4175,
        "context_state": "included"
      }
    ]
  }
}
```

## Example: direct system-prompt part full

```json
{
  "id": "QGWA.S.1-SP",
  "type": "part",
  "mode": "full",
  "data": {
    "id": "QGWA.S.1-SP",
    "type": "system_prompt",
    "token_count": 167,
    "context_state": "included",
    "content": {
      "text": "You are an analyst agent for Home Assistant data.\n\nUse the available tools to find answers. Do not guess when a tool can verify the fact."
    }
  }
}
```

## Example: direct mcp-instructions part full

```json
{
  "id": "QGWA.S.2-MI",
  "type": "part",
  "mode": "full",
  "data": {
    "id": "QGWA.S.2-MI",
    "type": "mcp_instructions",
    "token_count": 373,
    "context_state": "included",
    "content": {
      "text": "[MCP Server Instructions]\nYou are a data analyst for Sanzay home automation data.\n\n## Responding\n- Always state what was measured: which sensor, what period, and what aggregation.\n- Give the finding with its basis."
    }
  }
}
```

## Example: direct tool-definitions part full

```json
{
  "id": "QGWA.S.3-TD",
  "type": "part",
  "mode": "full",
  "data": {
    "id": "QGWA.S.3-TD",
    "type": "tool_definitions",
    "token_count": 4175,
    "context_state": "included",
    "content": {
      "json": [
        {
          "name": "ha_history_get_current_time",
          "description": "Returns the current date and time from the Home Assistant server (Sanzay). Call this before making any time-based query when the user uses a relative or named time expression.",
          "inputSchema": {
            "type": "object",
            "properties": {},
            "required": []
          }
        },
        {
          "name": "ha_history_get_sensor_stats",
          "description": "Computes statistics for a Sanzay sensor measuring instantaneous values such as temperature, humidity, CO2, pressure, illuminance, or power draw in Watts.",
          "inputSchema": {
            "type": "object",
            "properties": {
              "entity": {
                "type": "string",
                "description": "Exact entity_id from ha_history_list_entities."
              },
              "aggregation": {
                "type": "string",
                "enum": ["mean", "min", "max", "median", "count"]
              },
              "start_time": {
                "type": "string"
              },
              "end_time": {
                "type": "string"
              }
            },
            "required": ["entity", "aggregation"]
          }
        }
      ]
    }
  }
}
```

## Example: errors

Invalid ID:

```json
{
  "error": {
    "type": "validation",
    "message": "Invalid hierarchical ID: not-an-id",
    "code": "invalid_hierarchical_id"
  }
}
```

Not found:

```json
{
  "error": {
    "type": "not_found",
    "message": "Part not found: QGWA.9.9.9-T",
    "code": "hierarchical_id_not_found"
  }
}
```
