/**
 * Canonical result types for the CLI HTTP adapter.
 *
 * These match the canonical snake_case result shapes produced by the backend
 * operation layer (backend/src/operations/) and returned directly by the HTTP API.
 * CLI rendering code imports from here; no external shared package is needed.
 */

export interface SessionSummary {
  id: string;
  title: string;
  status: string;
  init_status: string;
  created_at: number;
  updated_at: number;
  is_context_exhausted: boolean;
  loaded_context_length: number | null;
  compaction_strategy: string;
  model_profile_snapshot: { name: string };
  mcp_profile_snapshots: { name: string }[];
}

export interface ListResult {
  api_version: 1;
  sessions: SessionSummary[];
}

export interface CreateInput {
  title: string;
  id?: string;
  compaction?: "none" | "strip-reasoning";
  model_config_id?: string;
  mcp_profile_ids?: string[];
}

export interface CreateResult {
  api_version: 1;
  session: {
    id: string;
    title: string;
    status: string;
    init_status: string;
    model: { id: string; name: string };
    mcp: { id: string; name: string }[];
    compaction_strategy: string;
    created_at: number;
    updated_at: number;
  };
}

export interface SendInput {
  session_id: string;
  prompt: string;
}

export interface SendResult {
  api_version: 1;
  session_id: string;
  turn: { id: string; status: string };
}

export interface StatusInput {
  session_id: string;
}

export interface StatusResult {
  api_version: 1;
  session: {
    id: string;
    state: "initializing" | "ready" | "running" | "error";
  };
  active_turn: { id: string; status: string } | null;
}

export interface InspectInput {
  id: string;
  short?: boolean;
}

export interface InspectResult {
  id: string;
  type: string;
  mode: string;
  data: Record<string, unknown>;
}

export interface ModelConfigSummary {
  id: string;
  name: string;
  connectionId: string;
  connectionName: string;
  modelKey: string;
  providerType: string | null;
}

export interface ListModelConfigsResult {
  modelConfigs: ModelConfigSummary[];
}

export interface McpProfileSummary {
  id: string;
  name: string;
  url: string;
  defaultEnabled: boolean;
}

export interface ListMcpProfilesResult {
  mcpProfiles: McpProfileSummary[];
}
