# Database Schema

This document describes the current SQLite storage layout used by mcpscope.

Source of truth:

- all table initialization (shared + runtime) lives in `backend/src/persistence/schema.ts`
- runtime record read/write behavior lives in `backend/src/persistence/repositoryRuntime.ts`
- configuration (LM connections, model configs, MCP profiles) is stored in a JSON file at `backend-data/mcpscope.config.json`, not in SQLite (see `backend/src/config/configStore.ts`)

This is intentionally separate from [DATA-MODEL.md](DATA-MODEL.md):

- [DATA-MODEL.md](DATA-MODEL.md) describes the canonical runtime tree exposed across the product
- this file describes the backing SQL tables, foreign keys, snapshot catalogs, and config/default tables

## Startup ownership

Normal startup creates:

- shared tables: `schema_meta`, snapshot catalogs (`model_profiles`, `mcp_profiles`)
- canonical runtime tables: `sessions`, `steps`, `turns`, `rounds`, `parts`, `raw_exchanges`, and `artifacts`

All tables are created fresh by `initializeSchema(...)` in `backend/src/persistence/schema.ts`. There is no migration path and no legacy table set.

## Mermaid ER Diagram

```mermaid
erDiagram
  schema_meta {
    TEXT key PK
    TEXT value
  }

  model_profiles {
    TEXT id PK
    TEXT name
    TEXT snapshot_json
    INTEGER created_at
    INTEGER updated_at
  }

  mcp_profiles {
    TEXT id PK
    TEXT name
    TEXT snapshot_json
    INTEGER created_at
    INTEGER updated_at
  }

  sessions {
    TEXT id PK
    TEXT title
    TEXT session_type_key
    TEXT parent_container_type_key
    TEXT parent_container_id
    TEXT status
    TEXT init_status
    TEXT params_json
    TEXT state_json
    TEXT analysis_state_json     // for analysis workflow state
    INTEGER created_at
    INTEGER updated_at
  }

  steps {
    TEXT id PK
    TEXT session_id FK
    TEXT step_type_key
    TEXT parent_step_id FK       // NULL for session-level children
    INTEGER child_index          // position within parent
    TEXT status
    TEXT params_json
    TEXT state_json
    INTEGER created_at
    INTEGER completed_at
    UNIQUE (session_id, parent_step_id, child_index)
  }

  turns {
    TEXT id PK                   // canonical turn ID, not a FK
    TEXT session_id FK
    TEXT owner_step_id FK
    INTEGER turn_number          // position within parent (or session)
    TEXT status
    TEXT outcome
    INTEGER prompt_tokens
    INTEGER completion_tokens
    INTEGER reasoning_tokens
    INTEGER total_tokens
    INTEGER context_tokens_at_turn_end
    INTEGER context_tokens_after_compaction
    TEXT compaction_applied
    INTEGER compaction_tokens_removed
    INTEGER created_at
    INTEGER completed_at
  }

  rounds {
    TEXT id PK
    TEXT turn_id FK
    TEXT session_id FK
    INTEGER round_index
    TEXT status
    TEXT finish_reason
    INTEGER prompt_tokens
    INTEGER completion_tokens
    INTEGER reasoning_tokens
    INTEGER total_tokens
    TEXT request_payload_json
    TEXT response_trace_json
    INTEGER started_at
    INTEGER completed_at
  }

  parts {
    TEXT id PK
    TEXT session_id FK
    TEXT turn_id FK
    TEXT round_id FK
    TEXT parent_part_id FK
    INTEGER ordinal
    TEXT part_type
    TEXT role_label
    TEXT payload_text
    TEXT payload_json
    TEXT payload_mime_type
    TEXT payload_summary
    TEXT display_state
    INTEGER collapsed_by_default
    TEXT context_state
    TEXT context_note
    TEXT stripped_by_compaction_at_step_id FK
    INTEGER token_count
    TEXT token_source
    TEXT token_confidence
    TEXT token_note
    TEXT provenance_json
    INTEGER created_at
    INTEGER updated_at
  }

  raw_exchanges {
    TEXT id PK
    TEXT session_id FK
    TEXT turn_id FK
    TEXT round_id FK
    TEXT kind
    TEXT request_url
    TEXT request_method
    TEXT request_headers_json
    TEXT request_body
    INTEGER response_status
    TEXT response_headers_json
    TEXT response_body
    INTEGER created_at
  }

  artifacts {
    TEXT id PK
    TEXT session_id FK
    TEXT step_id FK
    TEXT artifact_type_key
    TEXT content_text
    TEXT content_json
    TEXT content_data
    TEXT mime_type
    TEXT metadata_json
    INTEGER created_at
  }

  sessions ||--o{ sessions : owns_via_parent_columns
  sessions ||--o{ steps : executes
  steps o|--o{ turns : owns_turns
  turns ||--o{ rounds : iterates
  sessions ||--o{ parts : scopes
  turns o|--o{ parts : owns
  rounds o|--o{ parts : groups
  parts o|--o{ parts : parent_part
  steps o|--o{ parts : strips_by_compaction
  sessions ||--o{ raw_exchanges : records
  turns o|--o{ raw_exchanges : during_turn
  rounds o|--o{ raw_exchanges : during_round
  sessions o|--o{ artifacts : session_artifacts
  steps o|--o{ artifacts : step_artifacts
```

## Relationship Notes

- `steps.session_id`, `turns.session_id`, `rounds.turn_id`, `rounds.session_id`, `parts.session_id`, and `raw_exchanges.session_id` are required foreign keys with `ON DELETE CASCADE`.
- `turns.id` is the canonical turn ID; turns are their own rows (not an extension of a `steps` row).
- `turns.owner_step_id` is optional and links a turn to its owning non-turn step when workflow grouping is needed (`ON DELETE SET NULL`).
- `parts.turn_id` and `parts.round_id` are optional because setup parts live at the session level.
- `parts.parent_part_id` is a self-reference with `ON DELETE SET NULL`.
- `parts.stripped_by_compaction_at_step_id` points at the step that removed a part from active context and also uses `ON DELETE SET NULL`.
- `artifacts` may belong to a session, a step, or both, depending on how a workflow persists them.

## Snapshot Tables

- `model_profiles` and `mcp_profiles` are snapshot catalogs written alongside session creation for historical inspectability.
- session runtime rows persist model/MCP snapshots inside `sessions.params_json`; they do not foreign-key to snapshot catalogs.

## Runtime Tables

The canonical runtime path is:

- `sessions` for generic session rows, including container ownership via the `parent_container_type_key` / `parent_container_id` columns (a non-null `parent_container_type_key = 'benchmark'` means the session belongs to a `Benchmark` container; there is no separate container table)
- `steps` for generic non-turn execution-unit rows (workflow, compaction)
- `turns` for LLM turn rows, including optional `owner_step_id` workflow grouping
- `rounds` for turn-owned iterations
- `parts` for canonical setup/round parts
- `raw_exchanges` for diagnostics and replay payloads
- `artifacts` for content-oriented persisted artifacts

### Record-to-table mapping

The persistence-layer record types map to the canonical tables as follows:

| Record type | Table(s) |
|---|---|
| `SessionRecord` | `sessions` (container ownership via `parent_container_type_key` / `parent_container_id` columns) |
| `TurnRecord` | `turns` (optionally grouped under a `steps` row via `owner_step_id`) |
| `RoundRecord` | `rounds` |
| `PartRecord` | `parts` |
| `RawExchangeRecord` | `raw_exchanges` |

A benchmark **run** acts as the container: the sessions it produces reference it via `sessions.parent_container_type_key = 'benchmark'` / `parent_container_id = <run id>`. Benchmark *definitions* (suite, case, run) have their own tables — see [Benchmark Tables](#benchmark-tables) below.

Current deliberate limitations:

- deterministic workflow steps currently reuse the shared `steps` model; the shipped analysis flow does not require separate subtype tables
- parent/container relationships are still intentionally limited by the current session classification rules

## Benchmark Tables

Benchmarks add four tables (see [BENCHMARK.md](BENCHMARK.md) for the feature reference). IDs are type-tagged and hierarchical: `B-7K3M` (benchmark), `B-7K3M.3` (case 3), `R-9QX4` (run), `E-2F8P` (evaluation). A run produces one normal primary session per case × repetition, parented to the run id via the `sessions` parent columns above; an evaluation produces one `benchmark_evaluation` analysis session per run-session, parented to that run-session.

- `benchmarks` — a static suite (editable blueprint): `id`, `name`, `description`, `created_at`, `updated_at`.
- `benchmark_cases` — a case in a suite: `id`, `benchmark_id` (FK → `benchmarks`, `ON DELETE CASCADE`), `name` (optional), `prompt`, `order_index`, `expected_tools_called_json`, `expected_tools_not_called_json`, `rubric_json` (scored criteria `{id, description, points}[]` for LLM evaluation; `'[]'` default), `source_session_id` (the session a case was extracted from, if any), `created_at`, `updated_at`.
- `benchmark_runs` — an immutable execution snapshot, **independent** of its source benchmark (no FK / no cascade): `id`, `benchmark_id` (soft reference), `benchmark_name` (snapshot for display), `status` (`pending`/`running`/`complete`/`error`), `model_config_id`, `mcp_profile_ids_json` (effective selection, resolved at launch), `cases_json` (snapshot of the selected cases: `{sourceCaseId, name, prompt, expectedToolsCalled, expectedToolsNotCalled, rubric}` — the rubric is snapshotted too, so an evaluation judges against the run-time rubric), `repetitions`, `sessions_json` (the produced `{sessionId, sourceCaseId, repetition}` mapping), `error`, `created_at`, `updated_at`, `started_at`, `completed_at`.
- `benchmark_evaluations` — one LLM judging pass over a run (FK → `benchmark_runs`, `ON DELETE CASCADE`): `id`, `run_id`, `judge_model_config_id`, `judge_temperature` (the judge sampling temperature chosen for the pass; default `0`), `status` (`pending`/`running`/`complete`/`error`), `sessions_json` (per run-session: `{runSessionId, analysisSessionId, status}` — links each scored session to the `benchmark_evaluation` analysis session that judged it), `error`, `created_at`, `updated_at`. A thin grouping record holding the judge config (model + temperature); **scores are not stored** — they are computed on read from the judge sessions' verdict artifacts (in `artifacts`).

Indexes: `idx_benchmark_cases_benchmark`, `idx_benchmark_runs_benchmark`, `idx_benchmark_evaluations_run`. The report and evaluation scores are computed on read from the produced sessions (never the live cases). Lifecycles are decoupled: deleting a **benchmark** cascades to its **cases** but leaves its **runs** intact (they are self-contained snapshots); deleting a **run** removes its produced sessions explicitly (generic untyped parent → no cascade) and cascades to its `benchmark_evaluations`. Editing/deleting a benchmark or case therefore never alters a past run, its report, or its evaluations.

## Constraints and Indexes

- Enumerated lifecycle columns are enforced with `CHECK (...)` constraints in `backend/src/persistence/schema.ts`.
- `steps` enforces `UNIQUE (session_id, parent_step_id, child_index)`.
- `turns` has no UNIQUE constraint; turn position is tracked by the `turn_number` column.
- `rounds` enforces `UNIQUE (turn_id, round_index)`.
- `sessions` also enforces a `CHECK` that `parent_container_type_key` and `parent_container_id` are both null or both non-null.
- Secondary indexes exist on the main lookup and parent columns for `sessions`, `steps`, `turns`, `rounds`, `parts`, `raw_exchanges`, and `artifacts`.

## Current Schema Version

The schema version is `3`, stored in `schema_meta.schema_version` (defined as `SCHEMA_VERSION` in `backend/src/domain/model.ts`). History: `1` → `2` added `benchmark_cases.rubric_json` + the `benchmark_evaluations` table (LLM evaluation); `2` → `3` added `benchmark_evaluations.judge_temperature`. With no migration path the version is informational (surfaced on the `/api/system` endpoint); an out-of-date database is started empty rather than migrated.
