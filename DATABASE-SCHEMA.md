# Database Schema

This document describes the current SQLite storage layout used by mcpscope.

Source of truth:

- runtime schema creation and additive migrations live in `backend/src/persistence/schema.ts`
- record read/write behavior lives in `backend/src/persistence/repository.ts`

This is intentionally separate from [DATA-MODEL.md](DATA-MODEL.md):

- [DATA-MODEL.md](DATA-MODEL.md) describes the canonical runtime tree exposed across the product
- this file describes the backing SQL tables, foreign keys, singleton defaults tables, and snapshot/config catalogs

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

  sessions {
    TEXT id PK
    TEXT title
    TEXT status
    TEXT init_status
    TEXT session_type
    TEXT parent_kind
    TEXT parent_id
    TEXT model_profile_snapshot_json
    TEXT mcp_profile_snapshot_json
    INTEGER loaded_context_length
    INTEGER system_prompt_tokens
    INTEGER tool_definitions_tokens
    INTEGER is_context_exhausted
    TEXT compaction_strategy
    INTEGER created_at
    INTEGER updated_at
  }

  turns {
    TEXT id PK
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

  rounds {
    TEXT id PK
    TEXT turn_id FK
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
    TEXT stripped_by_compaction_at_turn_id FK
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

  sessions ||--o{ turns : contains
  turns ||--o{ rounds : iterates
  sessions ||--o{ parts : scopes
  turns o|--o{ parts : owns
  rounds o|--o{ parts : groups
  parts o|--o{ parts : parent_part
  turns o|--o{ parts : strips_by_compaction
  sessions ||--o{ raw_exchanges : records
  turns o|--o{ raw_exchanges : during_turn
  rounds o|--o{ raw_exchanges : during_round
```

## Relationship Notes

- `turns.session_id`, `rounds.turn_id`, `parts.session_id`, `raw_exchanges.session_id` are required foreign keys with `ON DELETE CASCADE`.
- `parts.turn_id`, `parts.round_id`, `raw_exchanges.turn_id`, and `raw_exchanges.round_id` are optional foreign keys. Setup parts live at the session level, so not every part belongs to a turn or round.
- `parts.parent_part_id` is a self-reference with `ON DELETE SET NULL`.
- `parts.stripped_by_compaction_at_turn_id` points at the turn that removed a part from active context and also uses `ON DELETE SET NULL`.

## Singleton Tables

- `session_creation_defaults` is a one-row table enforced by `CHECK (id = 1)`.
- `analysis_defaults` is also a one-row table enforced by `CHECK (id = 1)`.

Those tables store default selected IDs, but the schema does not currently enforce foreign keys from them to `model_configs`, `mcp_server_profiles`, or `analysis_profiles`.

## Snapshot and Catalog Tables

- `model_configs`, `mcp_server_profiles`, `lm_connections`, and `analysis_profiles` are editable configuration catalogs.
- `model_profiles` and `mcp_profiles` are snapshot catalogs written alongside session creation for historical inspectability.
- `sessions` keeps embedded JSON snapshots in `model_profile_snapshot_json` and `mcp_profile_snapshot_json`; it does not foreign-key to those snapshot catalogs.

## Constraints and Indexes

- Enumerated lifecycle columns are enforced with `CHECK (...)` constraints in `backend/src/persistence/schema.ts`.
- `turns` enforces `UNIQUE (session_id, sequence_number)`.
- `rounds` enforces `UNIQUE (turn_id, round_index)`.
- Secondary indexes exist on `turns.session_id`, `rounds.turn_id`, `parts.session_id`, `parts.turn_id`, `parts.round_id`, `raw_exchanges.session_id`, `raw_exchanges.round_id`, `sessions.session_type`, and `sessions.parent_kind + parent_id`.

## Current Schema Version

The current SQLite schema version is `7`, stored in `schema_meta.sqlite_schema_version`.