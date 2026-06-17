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
  connection_name: string;
  model_key: string;
  provider_type: string | null;
}

export interface ListModelConfigsResult {
  model_configs: ModelConfigSummary[];
}

export interface McpProfileSummary {
  id: string;
  name: string;
  url: string;
  default_enabled: boolean;
}

export interface ListMcpProfilesResult {
  mcp_profiles: McpProfileSummary[];
}

// ─── Benchmark result shapes (camelCase — distinct from the snake_case above) ──

export interface BenchmarkRecord {
  id: string;
  name: string;
  description: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface BenchmarkCaseRecord {
  id: string;
  benchmarkId: string;
  name: string | null;
  prompt: string;
  orderIndex: number;
  expectedToolsCalled: string[];
  expectedToolsNotCalled: string[];
  sourceSessionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface BenchmarkRunSession {
  sessionId: string;
  caseId: string;
  repetition: number;
}

export interface BenchmarkRunRecord {
  id: string;
  benchmarkId: string;
  status: string;
  modelConfigId: string | null;
  mcpProfileIds: string[] | null;
  caseIds: string[];
  repetitions: number;
  sessions: BenchmarkRunSession[];
  error: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface BenchmarkListEntry extends BenchmarkRecord {
  caseCount: number;
  runCount: number;
}

export interface BenchmarkCreateResult {
  benchmark: BenchmarkRecord;
}

export interface BenchmarkListResult {
  benchmarks: BenchmarkListEntry[];
}

export interface BenchmarkDetailResult {
  benchmark: BenchmarkRecord;
  cases: BenchmarkCaseRecord[];
  runs: BenchmarkRunRecord[];
}

export interface BenchmarkAddCaseResult {
  case: BenchmarkCaseRecord;
}

export interface BenchmarkRunLaunchResult {
  run: BenchmarkRunRecord;
}

export interface NumberStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  stddev: number;
}

export interface PerToolCounts {
  calls: number;
  errors: number;
  resultPayloadChars: number;
}

export interface SessionMetrics {
  sessionId: string;
  terminalStatus: string | null;
  completed: boolean;
  toolCallCount: number;
  toolErrorCount: number;
  toolsCalled: string[];
  perTool: Record<string, PerToolCounts>;
  tokens: {
    prompt: number | null;
    completion: number | null;
    reasoning: number | null;
    total: number | null;
  };
  finalAnswer: string | null;
}

export interface CaseReport {
  caseId: string;
  prompt: string;
  repetitions: number;
  sessionCount: number;
  hasChecks: boolean;
  passCount: number | null;
  passAtK: boolean | null;
  passHatK: boolean | null;
  successRate: number | null;
  completedCount: number;
  toolErrorCount: number;
  toolCallStats: NumberStats | null;
  totalTokenStats: NumberStats | null;
  perTool: Record<string, PerToolCounts>;
  sessions: SessionMetrics[];
}

export interface PerToolRollup {
  calls: number;
  errors: number;
  errorRate: number;
  resultPayloadChars: number;
  casesUsedIn: number;
}

export interface RunReport {
  runId: string;
  benchmarkId: string;
  status: string;
  repetitions: number;
  caseCount: number;
  sessionCount: number;
  cases: CaseReport[];
  perTool: Record<string, PerToolRollup>;
}

export interface BenchmarkRunReportResult {
  run: BenchmarkRunRecord;
  report: RunReport;
}
