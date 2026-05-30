# Database Schema

This document describes the current SQLite storage layout used by mcpscope.

Source of truth:

- shared config/default table initialization lives in `backend/src/persistence/schema.ts`
- canonical runtime table initialization lives in `backend/src/persistence/schemaV2.ts`
- runtime record read/write behavior lives in `backend/src/persistence/repositoryRuntime.ts`
- config/default record read/write behavior lives in `backend/src/persistence/repository.ts`

This is intentionally separate from [DATA-MODEL.md](DATA-MODEL.md):

- [DATA-MODEL.md](DATA-MODEL.md) describes the canonical runtime tree exposed across the product
- this file describes the backing SQL tables, foreign keys, singleton defaults tables, and snapshot/config catalogs

## Startup ownership

Normal startup creates:

- shared tables from `schema.ts`: `schema_meta`, config catalogs, snapshot catalogs, and singleton default tables
- canonical runtime tables from `schemaV2.ts`: `session_containers`, `v2_sessions`, `v2_steps`, `v2_turns`, `v2_rounds`, `v2_parts`, `v2_raw_exchanges`, and `artifacts`

Normal startup does **not** create the obsolete legacy runtime tables `sessions`, `turns`, `rounds`, `parts`, or `raw_exchanges`.
Those legacy tables remain only behind the explicit `initializeBackendSchema(...)` path used for old-schema validation and related tests.

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

  lm_connections {
    TEXT id PK
    TEXT name
    TEXT record_json
    INTEGER created_at
    INTEGER updated_at
  }

  model_configs {
    TEXT id PK
    TEXT name
    TEXT record_json
    INTEGER created_at
    INTEGER updated_at
  }

  mcp_server_profiles {
    TEXT id PK
    TEXT name
    TEXT record_json
    INTEGER created_at
    INTEGER updated_at
  }

  session_creation_defaults {
    INTEGER id PK
    TEXT default_model_config_id
    TEXT default_mcp_profile_id
    INTEGER updated_at
  }

  analysis_profiles {
    TEXT id PK
    TEXT name
    TEXT record_json
    INTEGER created_at
    INTEGER updated_at
  }

  analysis_defaults {
    INTEGER id PK
    TEXT default_analysis_profile_id
    INTEGER updated_at
  }

  session_containers {
    TEXT id PK
    TEXT container_type_key
    TEXT title
    TEXT params_json
    TEXT state_json
    INTEGER created_at
    INTEGER updated_at
  }

  v2_sessions {
    TEXT id PK
    TEXT title
    TEXT session_type_key
    TEXT parent_container_type_key
    TEXT parent_container_id
    TEXT status
    TEXT init_status
    TEXT params_json
    TEXT state_json
    INTEGER created_at
    INTEGER updated_at
  }

  v2_steps {
    TEXT id PK
    TEXT session_id FK
    TEXT step_type_key
    INTEGER ordinal
    TEXT status
    TEXT params_json
    TEXT state_json
    INTEGER created_at
    INTEGER completed_at
  }

  v2_turns {
    TEXT step_id PK
    TEXT session_id FK
    INTEGER sequence_number
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

  v2_rounds {
    TEXT id PK
    TEXT step_id FK
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

  v2_parts {
    TEXT id PK
    TEXT session_id FK
    TEXT step_id FK
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

  v2_raw_exchanges {
    TEXT id PK
    TEXT session_id FK
    TEXT step_id FK
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
    INTEGER created_at
  }

  session_containers ||--o{ v2_sessions : owns
  v2_sessions ||--o{ v2_steps : executes
  v2_steps ||--|| v2_turns : turn_extension
  v2_steps ||--o{ v2_rounds : iterates
  v2_sessions ||--o{ v2_parts : scopes
  v2_steps o|--o{ v2_parts : owns
  v2_rounds o|--o{ v2_parts : groups
  v2_parts o|--o{ v2_parts : parent_part
  v2_steps o|--o{ v2_parts : strips_by_compaction
  v2_sessions ||--o{ v2_raw_exchanges : records
  v2_steps o|--o{ v2_raw_exchanges : during_step
  v2_rounds o|--o{ v2_raw_exchanges : during_round
  v2_sessions o|--o{ artifacts : session_artifacts
  v2_steps o|--o{ artifacts : step_artifacts
```

## Relationship Notes

- `v2_steps.session_id`, `v2_turns.session_id`, `v2_rounds.step_id`, `v2_rounds.session_id`, `v2_parts.session_id`, and `v2_raw_exchanges.session_id` are required foreign keys with `ON DELETE CASCADE`.
- `v2_turns.step_id` is the primary-key link from the generic step row to the turn-specific extension row.
- `v2_parts.step_id` and `v2_parts.round_id` are optional because setup parts live at the session level.
- `v2_parts.parent_part_id` is a self-reference with `ON DELETE SET NULL`.
- `v2_parts.stripped_by_compaction_at_step_id` points at the step that removed a part from active context and also uses `ON DELETE SET NULL`.
- `artifacts` may belong to a session, a step, or both, depending on how a workflow persists them.

## Singleton Tables

- `session_creation_defaults` is a one-row table enforced by `CHECK (id = 1)`.
- `analysis_defaults` is also a one-row table enforced by `CHECK (id = 1)`.

Those tables store selected default IDs, but the schema does not currently enforce foreign keys from them to `model_configs`, `mcp_server_profiles`, or `analysis_profiles`.

## Snapshot and Catalog Tables

- `model_configs`, `mcp_server_profiles`, `lm_connections`, and `analysis_profiles` are editable configuration catalogs.
- `model_profiles` and `mcp_profiles` are snapshot catalogs written alongside session creation for historical inspectability.
- session runtime rows persist model/MCP snapshots inside `v2_sessions.params_json`; they do not foreign-key to snapshot catalogs.

## Runtime Tables

The canonical runtime path is:

- `session_containers` for container ownership such as `Benchmark`
- `v2_sessions` for generic session rows and parent-container references
- `v2_steps` for generic execution-unit rows
- `v2_turns` for the LLM-specific step extension
- `v2_rounds` for turn-owned iterations
- `v2_parts` for canonical setup/round parts
- `v2_raw_exchanges` for diagnostics and replay payloads
- `artifacts` for content-oriented persisted artifacts

Current deliberate limitations:

- runtime table names still carry the `v2_` prefix even though they are the canonical shipped path
- deterministic non-LLM steps do not yet have additional subtype tables or broader workflow semantics
- parent/container relationships are still intentionally limited by the current session classification rules
- benchmark support is still limited to the minimal container model

## Constraints and Indexes

- Enumerated lifecycle columns are enforced with `CHECK (...)` constraints in `backend/src/persistence/schema.ts` and `backend/src/persistence/schemaV2.ts`.
- `v2_steps` enforces `UNIQUE (session_id, ordinal)`.
- `v2_turns` enforces `UNIQUE (session_id, sequence_number)`.
- `v2_rounds` enforces `UNIQUE (step_id, round_index)`.
- Secondary indexes exist on the main lookup and parent columns for `session_containers`, `v2_sessions`, `v2_steps`, `v2_turns`, `v2_rounds`, `v2_parts`, `v2_raw_exchanges`, and `artifacts`.

## Current Schema Version

The shared-table schema version is `7`, stored in `schema_meta.sqlite_schema_version`.
The canonical runtime schema version is `1`, stored in `schema_meta.new_schema_version`.
