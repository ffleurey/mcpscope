/**
 * CLI HTTP client — calls the mcpscope backend API.
 *
 * The backend HTTP API returns canonical snake_case result shapes (matching the
 * backend operation layer), so no field mapping is required here. This module
 * is the CLI's only place for HTTP calls to the backend.
 */
import { OperationError } from "./errors.js";
import type {
  ListResult,
  CreateInput,
  CreateResult,
  SendInput,
  SendResult,
  StatusInput,
  StatusResult,
  InspectInput,
  InspectResult,
  ListModelConfigsResult,
  ListMcpProfilesResult,
  BenchmarkCreateResult,
  BenchmarkListResult,
  BenchmarkInspectResult,
  BenchmarkAddCaseResult,
  BenchmarkRunLaunchResult,
  BenchmarkRunStatusResult,
  BenchmarkRunReportResult,
  BenchmarkEvaluateResult,
  BenchmarkRunEvaluationsResult,
  BenchmarkDeleteCaseResult,
  RubricCriterion,
} from "./types.js";

// ─── HTTP primitives ──────────────────────────────────────────────────────────

interface ApiErrorPayload {
  error?:
    | {
        message?: string;
        code?: string;
        active_session?: { id: string; state: string };
      }
    | string;
}

async function request<T>(baseUrl: string, path: string): Promise<T> {
  const url = `${baseUrl}${path}`;
  let response: Response;

  try {
    response = await fetch(url);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new OperationError(`Cannot reach backend at ${baseUrl}: ${message}`);
  }

  return parseResponse<T>(response, baseUrl);
}

async function post<T>(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<T> {
  const url = `${baseUrl}${path}`;
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new OperationError(`Cannot reach backend at ${baseUrl}: ${message}`);
  }

  return parseResponse<T>(response, baseUrl);
}

async function parseResponse<T>(
  response: Response,
  _baseUrl: string,
): Promise<T> {
  let payload: unknown;
  try {
    const text = await response.text();
    payload = text.length > 0 ? JSON.parse(text) : null;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new OperationError(`Backend returned invalid JSON: ${message}`);
  }

  if (!response.ok) {
    const errPayload = payload as ApiErrorPayload | null;
    const errorObj =
      errPayload &&
      typeof errPayload === "object" &&
      "error" in errPayload &&
      errPayload.error !== null &&
      typeof errPayload.error === "object"
        ? errPayload.error
        : null;

    const message =
      errorObj?.message ??
      (typeof errPayload?.error === "string"
        ? errPayload.error
        : `Backend request failed (${response.status})`);
    const activeSession = errorObj?.active_session;
    const code = errorObj?.code;
    const fullMessage = activeSession
      ? `${message}\n  Blocking session: ${activeSession.id}  (${activeSession.state})`
      : message;
    throw new OperationError(fullMessage, code, activeSession);
  }

  return payload as T;
}

// ─── Operation call functions — pass-through to canonical HTTP result shapes ──

/** GET /api/sessions → ListResult */
export async function cliList(baseUrl: string): Promise<ListResult> {
  return request<ListResult>(baseUrl, "/api/sessions");
}

/** POST /api/sessions/from-defaults → CreateResult */
export async function cliCreate(
  baseUrl: string,
  input: CreateInput,
): Promise<CreateResult> {
  return post<CreateResult>(baseUrl, "/api/sessions/from-defaults", {
    title: input.title,
    ...(input.id !== undefined ? { sessionId: input.id } : {}),
    ...(input.compaction !== undefined
      ? { compactionStrategy: input.compaction }
      : {}),
    ...(input.model_config_id !== undefined
      ? { modelConfigId: input.model_config_id }
      : {}),
    ...(input.mcp_profile_ids !== undefined
      ? { mcpProfileIds: input.mcp_profile_ids }
      : {}),
    ...(input.max_tool_rounds !== undefined
      ? { maxToolRounds: input.max_tool_rounds }
      : {}),
  });
}

/** POST /api/sessions/:id/turns/start → SendResult */
export async function cliSend(
  baseUrl: string,
  input: SendInput,
): Promise<SendResult> {
  return post<SendResult>(
    baseUrl,
    `/api/sessions/${encodeURIComponent(input.session_id)}/turns/start`,
    { userContent: input.prompt },
  );
}

/** GET /api/sessions/:id/status → StatusResult */
export async function cliStatus(
  baseUrl: string,
  input: StatusInput,
): Promise<StatusResult> {
  return request<StatusResult>(
    baseUrl,
    `/api/sessions/${encodeURIComponent(input.session_id)}/status`,
  );
}

/** GET /api/lookup/:id?mode=...&format=json → InspectResult */
export async function cliInspect(
  baseUrl: string,
  input: InspectInput,
): Promise<InspectResult> {
  const mode = input.short === true ? "summary" : "full";
  return request<InspectResult>(
    baseUrl,
    `/api/lookup/${encodeURIComponent(input.id)}?mode=${mode}&format=json`,
  );
}

/**
 * GET /api/lookup/:id?mode=...&format=text → pre-rendered text.
 * Rendering is a backend domain feature; the CLI just prints what it returns.
 */
export async function cliInspectText(
  baseUrl: string,
  input: InspectInput,
): Promise<string> {
  const mode = input.short === true ? "summary" : "full";
  const url = `${baseUrl}/api/lookup/${encodeURIComponent(input.id)}?mode=${mode}&format=text`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new OperationError(`Cannot reach backend at ${baseUrl}: ${message}`);
  }
  // Errors come back as JSON (the route's error handler); reuse the JSON path.
  if (!response.ok) {
    return parseResponse<string>(response, baseUrl);
  }
  return response.text();
}

/** GET /api/operations/model-configs → ListModelConfigsResult */
export async function cliListModelConfigs(
  baseUrl: string,
): Promise<ListModelConfigsResult> {
  return request<ListModelConfigsResult>(
    baseUrl,
    "/api/operations/model-configs",
  );
}

/** GET /api/operations/mcp-profiles → ListMcpProfilesResult */
export async function cliListMcpProfiles(
  baseUrl: string,
): Promise<ListMcpProfilesResult> {
  return request<ListMcpProfilesResult>(
    baseUrl,
    "/api/operations/mcp-profiles",
  );
}

// ─── Benchmark endpoints (operation-backed, canonical snake_case) ─────────────

/** POST /api/operations/benchmark-create → BenchmarkCreateResult */
export async function cliBenchmarkCreate(
  baseUrl: string,
  body: { name: string; description?: string },
): Promise<BenchmarkCreateResult> {
  return post<BenchmarkCreateResult>(
    baseUrl,
    "/api/operations/benchmark-create",
    body,
  );
}

/** GET /api/operations/benchmarks → BenchmarkListResult */
export async function cliBenchmarkList(
  baseUrl: string,
): Promise<BenchmarkListResult> {
  return request<BenchmarkListResult>(baseUrl, "/api/operations/benchmarks");
}

/** GET /api/operations/benchmarks/:benchmarkId → BenchmarkInspectResult */
export async function cliBenchmarkInspect(
  baseUrl: string,
  benchmarkId: string,
): Promise<BenchmarkInspectResult> {
  return request<BenchmarkInspectResult>(
    baseUrl,
    `/api/operations/benchmarks/${encodeURIComponent(benchmarkId)}`,
  );
}

/** POST /api/operations/benchmark-add-case → BenchmarkAddCaseResult */
export async function cliBenchmarkAddCase(
  baseUrl: string,
  body: {
    benchmark_id: string;
    prompt: string;
    name?: string;
    expected_tools_called?: string[];
    expected_tools_not_called?: string[];
  },
): Promise<BenchmarkAddCaseResult> {
  return post<BenchmarkAddCaseResult>(
    baseUrl,
    "/api/operations/benchmark-add-case",
    body,
  );
}

/** POST /api/operations/benchmark-add-case-from-session → BenchmarkAddCaseResult */
export async function cliBenchmarkAddCaseFromSession(
  baseUrl: string,
  body: { benchmark_id: string; session_id: string; name?: string },
): Promise<BenchmarkAddCaseResult> {
  return post<BenchmarkAddCaseResult>(
    baseUrl,
    "/api/operations/benchmark-add-case-from-session",
    body,
  );
}

/** POST /api/operations/benchmark-update-case → BenchmarkAddCaseResult */
export async function cliBenchmarkUpdateCase(
  baseUrl: string,
  body: {
    case_id: string;
    name?: string | null;
    prompt?: string;
    order_index?: number;
    expected_tools_called?: string[];
    expected_tools_not_called?: string[];
    rubric?: RubricCriterion[];
  },
): Promise<BenchmarkAddCaseResult> {
  return post<BenchmarkAddCaseResult>(
    baseUrl,
    "/api/operations/benchmark-update-case",
    body,
  );
}

/** POST /api/operations/benchmark-delete-case → BenchmarkDeleteCaseResult */
export async function cliBenchmarkDeleteCase(
  baseUrl: string,
  body: { case_id: string },
): Promise<BenchmarkDeleteCaseResult> {
  return post<BenchmarkDeleteCaseResult>(
    baseUrl,
    "/api/operations/benchmark-delete-case",
    body,
  );
}

/** POST /api/operations/benchmark-run → BenchmarkRunLaunchResult */
export async function cliBenchmarkRun(
  baseUrl: string,
  body: {
    benchmark_id: string;
    case_ids?: string[];
    repetitions?: number;
    model_config_id?: string;
    mcp_profile_ids?: string[];
    max_tool_rounds?: number;
  },
): Promise<BenchmarkRunLaunchResult> {
  return post<BenchmarkRunLaunchResult>(
    baseUrl,
    "/api/operations/benchmark-run",
    body,
  );
}

/** GET /api/operations/benchmark-runs/:runId/status → BenchmarkRunStatusResult */
export async function cliBenchmarkRunStatus(
  baseUrl: string,
  runId: string,
): Promise<BenchmarkRunStatusResult> {
  return request<BenchmarkRunStatusResult>(
    baseUrl,
    `/api/operations/benchmark-runs/${encodeURIComponent(runId)}/status`,
  );
}

/** GET /api/operations/benchmark-runs/:runId/report → BenchmarkRunReportResult */
export async function cliBenchmarkRunReport(
  baseUrl: string,
  runId: string,
): Promise<BenchmarkRunReportResult> {
  return request<BenchmarkRunReportResult>(
    baseUrl,
    `/api/operations/benchmark-runs/${encodeURIComponent(runId)}/report`,
  );
}

/** POST /api/operations/benchmark-evaluate → BenchmarkEvaluateResult */
export async function cliBenchmarkEvaluate(
  baseUrl: string,
  body: { run_id: string; judge_model_config_id: string; temperature?: number | null },
): Promise<BenchmarkEvaluateResult> {
  return post<BenchmarkEvaluateResult>(
    baseUrl,
    "/api/operations/benchmark-evaluate",
    body,
  );
}

/** GET /api/operations/benchmark-runs/:runId/evaluations → BenchmarkRunEvaluationsResult */
export async function cliBenchmarkRunEvaluations(
  baseUrl: string,
  runId: string,
): Promise<BenchmarkRunEvaluationsResult> {
  return request<BenchmarkRunEvaluationsResult>(
    baseUrl,
    `/api/operations/benchmark-runs/${encodeURIComponent(runId)}/evaluations`,
  );
}

/** POST /api/operations/benchmark-run-control → BenchmarkRunLaunchResult */
export async function cliBenchmarkRunControl(
  baseUrl: string,
  body: { run_id: string; action: "pause" | "resume" | "stop"; mode?: "continue" | "retry" },
): Promise<BenchmarkRunLaunchResult> {
  return post<BenchmarkRunLaunchResult>(
    baseUrl,
    "/api/operations/benchmark-run-control",
    body,
  );
}

/** POST /api/operations/benchmark-evaluation-control → BenchmarkEvaluateResult */
export async function cliBenchmarkEvaluationControl(
  baseUrl: string,
  body: {
    evaluation_id: string;
    action: "pause" | "resume" | "stop";
    mode?: "continue" | "retry";
  },
): Promise<BenchmarkEvaluateResult> {
  return post<BenchmarkEvaluateResult>(
    baseUrl,
    "/api/operations/benchmark-evaluation-control",
    body,
  );
}
