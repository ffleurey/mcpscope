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
  BenchmarkDetailResult,
  BenchmarkAddCaseResult,
  BenchmarkRunLaunchResult,
  BenchmarkRunReportResult,
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

/** GET /api/lookup/:id?mode=... → InspectResult */
export async function cliInspect(
  baseUrl: string,
  input: InspectInput,
): Promise<InspectResult> {
  const mode = input.short === true ? "summary" : "full";
  return request<InspectResult>(
    baseUrl,
    `/api/lookup/${encodeURIComponent(input.id)}?mode=${mode}`,
  );
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

// ─── Benchmark endpoints (camelCase JSON) ─────────────────────────────────────

/** POST /api/benchmarks → BenchmarkCreateResult */
export async function cliBenchmarkCreate(
  baseUrl: string,
  body: { name: string; description?: string },
): Promise<BenchmarkCreateResult> {
  return post<BenchmarkCreateResult>(baseUrl, "/api/benchmarks", body);
}

/** GET /api/benchmarks → BenchmarkListResult */
export async function cliBenchmarkList(
  baseUrl: string,
): Promise<BenchmarkListResult> {
  return request<BenchmarkListResult>(baseUrl, "/api/benchmarks");
}

/** GET /api/benchmarks/:id → BenchmarkDetailResult */
export async function cliBenchmarkShow(
  baseUrl: string,
  benchmarkId: string,
): Promise<BenchmarkDetailResult> {
  return request<BenchmarkDetailResult>(
    baseUrl,
    `/api/benchmarks/${encodeURIComponent(benchmarkId)}`,
  );
}

/** POST /api/benchmarks/:id/cases → BenchmarkAddCaseResult */
export async function cliBenchmarkAddCase(
  baseUrl: string,
  benchmarkId: string,
  body: {
    prompt: string;
    name?: string;
    expectedToolsCalled?: string[];
    expectedToolsNotCalled?: string[];
  },
): Promise<BenchmarkAddCaseResult> {
  return post<BenchmarkAddCaseResult>(
    baseUrl,
    `/api/benchmarks/${encodeURIComponent(benchmarkId)}/cases`,
    body,
  );
}

/** POST /api/benchmarks/:id/cases/from-session → BenchmarkAddCaseResult */
export async function cliBenchmarkAddCaseFromSession(
  baseUrl: string,
  benchmarkId: string,
  body: { sessionId: string; name?: string },
): Promise<BenchmarkAddCaseResult> {
  return post<BenchmarkAddCaseResult>(
    baseUrl,
    `/api/benchmarks/${encodeURIComponent(benchmarkId)}/cases/from-session`,
    body,
  );
}

/** POST /api/benchmarks/:id/runs → BenchmarkRunLaunchResult */
export async function cliBenchmarkRun(
  baseUrl: string,
  benchmarkId: string,
  body: {
    caseIds?: string[];
    repetitions?: number;
    modelConfigId?: string;
    mcpProfileIds?: string[];
  },
): Promise<BenchmarkRunLaunchResult> {
  return post<BenchmarkRunLaunchResult>(
    baseUrl,
    `/api/benchmarks/${encodeURIComponent(benchmarkId)}/runs`,
    body,
  );
}

/** GET /api/benchmark-runs/:runId → BenchmarkRunReportResult */
export async function cliBenchmarkReport(
  baseUrl: string,
  runId: string,
): Promise<BenchmarkRunReportResult> {
  return request<BenchmarkRunReportResult>(
    baseUrl,
    `/api/benchmark-runs/${encodeURIComponent(runId)}`,
  );
}
