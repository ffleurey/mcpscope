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
  model: string;
  updated_at: number;
}

export interface ListResult {
  api_version: 1;
  sessions: SessionSummary[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface CreateInput {
  title?: string;
  id?: string;
  compaction?: "none" | "strip-reasoning";
  model_config_id?: string;
  mcp_profile_ids?: string[];
  max_tool_rounds?: number;
  wait?: boolean;
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
    max_tool_rounds: number | null;
    created_at: number;
    updated_at: number;
  };
}

export interface SendInput {
  session_id: string;
  prompt: string;
  wait?: boolean;
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
    state: "initializing" | "ready" | "running" | "queued" | "error";
  };
  active_turn: { id: string; status: string } | null;
  /** Present when the session has a pending job in the scheduler queue (1-based). */
  queue_position?: number;
}

export interface RenameSessionResult {
  api_version: 1;
  session_id: string;
  title: string;
}

export interface AbortSessionResult {
  api_version: 1;
  session_id: string;
  outcome: "aborted" | "dequeued" | "not-running";
}

export interface DeleteSessionResult {
  api_version: 1;
  // true if a session was deleted; false if no session with this id existed.
  deleted: boolean;
  session_id: string;
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
  is_default: boolean;
}

export interface ListModelConfigsResult {
  model_configs: ModelConfigSummary[];
}

export interface McpProfileSummary {
  id: string;
  name: string;
  url: string;
  default_enabled: boolean;
  /** "builtin" = bundled companion server (read-only); "user" = your own profile. */
  source: "builtin" | "user";
  /** Non-null when unavailable (e.g. a key-gated companion whose key is unset). */
  disabled_reason: string | null;
}

export interface ListMcpProfilesResult {
  mcp_profiles: McpProfileSummary[];
}

// ─── Benchmark result shapes (snake_case — mirror the backend op catalog) ─────

export interface BenchmarkSummary {
  id: string;
  name: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

export interface RubricCriterion {
  id: number;
  description: string;
  points: number;
}

export interface BenchmarkCaseRecord {
  id: string;
  benchmark_id: string;
  name: string | null;
  prompt: string;
  order_index: number;
  expected_tools_called: string[];
  expected_tools_not_called: string[];
  rubric: RubricCriterion[];
  source_session_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface BenchmarkRunSession {
  session_id: string;
  source_case_id: string;
  repetition: number;
  status: string;
}

export interface BenchmarkRunCaseSnapshot {
  source_case_id: string;
  name: string | null;
  prompt: string;
  expected_tools_called: string[];
  expected_tools_not_called: string[];
}

export interface BenchmarkRunRecord {
  id: string;
  benchmark_id: string;
  benchmark_name: string;
  status: string;
  model_config_id: string;
  mcp_profile_ids: string[];
  repetitions: number;
  cases: BenchmarkRunCaseSnapshot[];
  sessions: BenchmarkRunSession[];
  error: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}

export interface BenchmarkListEntry {
  id: string;
  name: string;
  description: string | null;
  case_count: number;
  run_count: number;
  created_at: number;
  updated_at: number;
}

export interface BenchmarkCreateResult {
  benchmark: BenchmarkSummary;
}

export interface BenchmarkListResult {
  benchmarks: BenchmarkListEntry[];
}

export interface BenchmarkInspectResult {
  benchmark: BenchmarkSummary;
  cases: BenchmarkCaseRecord[];
  runs: BenchmarkRunRecord[];
}

export interface BenchmarkAddCaseResult {
  case: BenchmarkCaseRecord;
}

export interface BenchmarkDeleteCaseResult {
  case_id: string;
  deleted: boolean;
}

export interface BenchmarkDeleteResult {
  benchmark_id: string;
  deleted: boolean;
}

export interface BenchmarkDeleteRunResult {
  run_id: string;
  deleted: boolean;
}

export interface BenchmarkDeleteEvaluationResult {
  evaluation_id: string;
  deleted: boolean;
}

export interface BenchmarkRunLaunchResult {
  run: BenchmarkRunRecord;
}

export interface BenchmarkRunProgressPerCase {
  source_case_id: string;
  name: string | null;
  completed: number;
  total: number;
}

export interface BenchmarkRunStatusResult {
  run_id: string;
  benchmark_id: string;
  benchmark_name: string;
  status: string;
  repetitions: number;
  total_cases: number;
  total_sessions: number;
  completed_sessions: number;
  failed_sessions: number;
  per_case: BenchmarkRunProgressPerCase[];
  current_session_id: string | null;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
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
  result_payload_chars: number;
}

export interface SessionMetrics {
  session_id: string;
  terminal_status: string | null;
  completed: boolean;
  tool_call_count: number;
  tool_error_count: number;
  tools_called: string[];
  per_tool: Record<string, PerToolCounts>;
  tokens: {
    prompt: number | null;
    completion: number | null;
    reasoning: number | null;
    total: number | null;
  };
  final_answer: string | null;
}

export interface CaseReport {
  case_id: string;
  prompt: string;
  repetitions: number;
  session_count: number;
  has_checks: boolean;
  pass_count: number | null;
  pass_at_k: boolean | null;
  pass_hat_k: boolean | null;
  success_rate: number | null;
  completed_count: number;
  tool_error_count: number;
  tool_call_stats: NumberStats | null;
  total_token_stats: NumberStats | null;
  per_tool: Record<string, PerToolCounts>;
  sessions: SessionMetrics[];
}

export interface PerToolRollup {
  calls: number;
  errors: number;
  error_rate: number;
  result_payload_chars: number;
  cases_used_in: number;
}

export interface RunReport {
  run_id: string;
  benchmark_id: string;
  status: string;
  repetitions: number;
  case_count: number;
  session_count: number;
  cases: CaseReport[];
  per_tool: Record<string, PerToolRollup>;
}

export interface BenchmarkRunReportResult {
  run: BenchmarkRunRecord;
  report: RunReport;
}

export interface BenchmarkEvaluationSession {
  run_session_id: string;
  analysis_session_id: string;
  status: string;
}

export interface BenchmarkEvaluationRecord {
  id: string;
  run_id: string;
  judge_model_config_id: string;
  // null => the judge ran at the provider's own default temperature.
  judge_temperature: number | null;
  status: string;
  error: string | null;
  sessions: BenchmarkEvaluationSession[];
  created_at: number;
  updated_at: number;
}

export interface BenchmarkEvaluateResult {
  evaluation: BenchmarkEvaluationRecord;
}

export interface EvaluationSessionScore {
  run_session_id: string;
  analysis_session_id: string;
  source_case_id: string;
  status: string;
  awarded: number | null;
  max: number | null;
  pct: number | null;
}

export interface EvaluationCaseScore {
  source_case_id: string;
  name: string | null;
  pct_stats: NumberStats | null;
  sessions: EvaluationSessionScore[];
}

export interface EvaluationScore {
  overall_pct: number | null;
  cases: EvaluationCaseScore[];
}

export interface BenchmarkEvaluationReport extends BenchmarkEvaluationRecord {
  score: EvaluationScore;
  expected_sessions?: number;
  judged_sessions?: number;
  skipped_no_rubric?: number;
  incomplete?: boolean;
}

export interface BenchmarkRunEvaluationsResult {
  evaluations: BenchmarkEvaluationReport[];
}
