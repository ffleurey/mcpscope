import type { ZodType } from 'zod'
import {
  createSessionResponseSchema,
  hierarchicalLookupResponseSchema,
  listLmConnectionsResponseSchema,
  listMcpProfilesResponseSchema,
  listModelConfigsResponseSchema,
  listSessionsResponseSchema,
  sessionTraceBundleSchema,
  sessionCreationDefaultsResponseSchema,
  upsertLmConnectionResponseSchema,
  upsertMcpProfileResponseSchema,
  upsertModelConfigResponseSchema,
  launchAnalysisResponseSchema,
  analysisSystemPromptResponseSchema,
  executionSnapshotSchema,
  schedulerEventSchema,
  listBenchmarksResponseSchema,
  benchmarkDetailResponseSchema,
  benchmarkResponseSchema,
  benchmarkCaseResponseSchema,
  benchmarkRunResponseSchema,
  benchmarkRunReportResponseSchema,
  benchmarkEvaluationResponseSchema,
  benchmarkEvaluationsResponseSchema,
  type RubricCriterion,
  type LmStudioConnection,
  type McpServerProfile,
  type ModelConfig,
  type SessionCreationDefaults,
  type SessionTraceBundle,
  type HierarchicalLookupResponse,
  type ExecutionSnapshot,
  type SchedulerEvent,
  type ExecutionJob,
} from '../backendTypes'
import { AppError } from '../errors'

const apiBase = (import.meta.env.VITE_BACKEND_API_BASE ?? '').replace(/\/$/, '')

function buildUrl(path: string): string {
  return `${apiBase}${path}`
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    body?: unknown
    schema?: ZodType<T>
  } = {},
): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  if (response.status === 204) {
    return undefined as T
  }

  const text = await response.text()
  const payload = text.length > 0 ? JSON.parse(text) : null

  if (!response.ok) {
    // Parse the new structured error shape { error: { type, message, code?, details? } }
    const errorObj =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      payload.error !== null &&
      typeof payload.error === 'object'
        ? (payload.error as {
            type?: string
            message?: string
            code?: string
            details?: unknown
          })
        : null

    const message =
      errorObj?.message ??
      (typeof payload?.error === 'string'
        ? payload.error
        : `Backend request failed (${response.status})`)
    const errorType = (errorObj?.type as AppError['errorType']) ?? 'internal'
    throw new AppError(message, errorType, response.status, {
      code: errorObj?.code,
      details: errorObj?.details,
    })
  }

  return options.schema ? options.schema.parse(payload) : (payload as T)
}

import { z } from 'zod'

const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  sqlitePath: z.string(),
})

export function fetchHealth() {
  return request('/api/health', { schema: healthResponseSchema })
}

export function listSessions(options?: { includeChildren?: boolean }) {
  const url = options?.includeChildren ? '/api/sessions?include_children=true' : '/api/sessions'
  return request(url, {
    schema: listSessionsResponseSchema,
  })
}

export function getSessionTrace(sessionId: string) {
  return request(`/api/sessions/${sessionId}/trace`, {
    schema: sessionTraceBundleSchema,
  })
}

export function createPrimarySession(input: {
  session_id?: string
  title?: string
  model_config_id?: string
  mcp_profile_ids?: string[]
  compaction_strategy?: 'none' | 'strip-reasoning'
  max_tool_rounds?: number
}) {
  return request('/api/session-constructors/primary', {
    method: 'POST',
    body: input,
    schema: createSessionResponseSchema,
  })
}

export function lookupByHierarchicalId(
  id: string,
  mode: 'summary' | 'full',
): Promise<HierarchicalLookupResponse> {
  const encodedId = encodeURIComponent(id)
  return request(`/api/lookup/${encodedId}?mode=${mode}`, {
    schema: hierarchicalLookupResponseSchema,
  })
}

/**
 * Fetch the backend-rendered text view of an inspect payload (the same renderer
 * the CLI and MCP use). Returns plain text, so it bypasses the JSON `request`
 * helper but mirrors its structured-error handling.
 */
export async function lookupTextByHierarchicalId(
  id: string,
  mode: 'summary' | 'full',
): Promise<string> {
  const encodedId = encodeURIComponent(id)
  const response = await fetch(buildUrl(`/api/lookup/${encodedId}?mode=${mode}&format=text`))
  const body = await response.text()
  if (!response.ok) {
    let message = `Backend request failed (${response.status})`
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } }
      message = parsed?.error?.message ?? message
    } catch {
      // Non-JSON error body; keep the default message.
    }
    throw new AppError(message, 'internal', response.status, {})
  }
  return body
}

function parseSseBlock(
  block: string,
): { eventName: string | null; dataText: string | null } | null {
  const lines = block.split(/\r?\n/)
  let eventName: string | null = null
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
      continue
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (dataLines.length === 0) {
    return null
  }

  return {
    eventName,
    dataText: dataLines.join('\n'),
  }
}

export function importTrace(trace: SessionTraceBundle) {
  return request('/api/traces/import', {
    method: 'POST',
    body: trace,
    schema: createSessionResponseSchema,
  })
}

export function deleteSession(sessionId: string) {
  return request<void>(`/api/sessions/${sessionId}`, {
    method: 'DELETE',
  })
}

export function patchSessionTitle(sessionId: string, title: string) {
  return request(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    body: { title },
    schema: createSessionResponseSchema,
  })
}

const retryAnalysisStepResponseSchema = z.object({
  api_version: z.literal(1),
  session_id: z.string(),
  failed_step_id: z.string(),
  retry_phase: z.string(),
  latest_error: z
    .object({
      step_id: z.string().nullable(),
      error_kind: z.string().nullable(),
      message: z.string(),
    })
    .optional(),
})

export function retryFailedAnalysisStep(sessionId: string) {
  return request(`/api/sessions/${sessionId}/retry-failed-step`, {
    method: 'POST',
    schema: retryAnalysisStepResponseSchema,
  })
}

export function listLmConnections() {
  return request('/api/lm-connections', {
    schema: listLmConnectionsResponseSchema,
  })
}

export function upsertLmConnection(connection: LmStudioConnection) {
  return request(`/api/lm-connections/${connection.id}`, {
    method: 'PUT',
    body: connection,
    schema: upsertLmConnectionResponseSchema,
  })
}

export function deleteLmConnection(connectionId: string) {
  return request<void>(`/api/lm-connections/${connectionId}`, {
    method: 'DELETE',
  })
}

export function listModelConfigs() {
  return request('/api/model-configs', {
    schema: listModelConfigsResponseSchema,
  })
}

export function upsertModelConfig(modelConfig: ModelConfig) {
  return request(`/api/model-configs/${modelConfig.id}`, {
    method: 'PUT',
    body: modelConfig,
    schema: upsertModelConfigResponseSchema,
  })
}

export function deleteModelConfig(modelConfigId: string) {
  return request<void>(`/api/model-configs/${modelConfigId}`, {
    method: 'DELETE',
  })
}

export function listMcpProfiles() {
  return request('/api/mcp-profiles', {
    schema: listMcpProfilesResponseSchema,
  })
}

export function upsertMcpProfile(mcpProfile: McpServerProfile) {
  return request(`/api/mcp-profiles/${mcpProfile.id}`, {
    method: 'PUT',
    body: mcpProfile,
    schema: upsertMcpProfileResponseSchema,
  })
}

export function deleteMcpProfile(mcpProfileId: string) {
  return request<void>(`/api/mcp-profiles/${mcpProfileId}`, {
    method: 'DELETE',
  })
}

const lmConnectionTestResponseSchema = z.object({
  models: z.array(z.string()),
})

export function testLmConnection(
  baseUrl: string,
  apiKey?: string | null,
  providerType?: 'lmstudio' | 'openrouter' | 'ollama',
) {
  return request('/api/lm-connections/test', {
    method: 'POST',
    body: { baseUrl, apiKey: apiKey ?? null, providerType },
    schema: lmConnectionTestResponseSchema,
  })
}

const lmConnectionModelSchema = z.object({
  uid: z.string(),
  key: z.string(),
  displayName: z.string(),
  maxContextLength: z.number().nullable(),
  loadedContextLength: z.number().nullable(),
  isLoaded: z.boolean(),
  supportsReasoning: z.boolean(),
  defaultReasoningOn: z.boolean(),
  raw: z.unknown(),
})

const lmConnectionModelsResponseSchema = z.object({
  models: z.array(lmConnectionModelSchema),
})

export type LmConnectionModel = z.infer<typeof lmConnectionModelSchema>

export function listLmConnectionModels(
  baseUrl: string,
  apiKey?: string | null,
  providerType?: 'lmstudio' | 'openrouter' | 'ollama',
) {
  return request('/api/lm-connections/models', {
    method: 'POST',
    body: { baseUrl, apiKey: apiKey ?? null, providerType },
    schema: lmConnectionModelsResponseSchema,
  })
}

const lmConnectionModelMutationResponseSchema = z.object({
  ok: z.literal(true),
})

export function loadLmConnectionModel(
  baseUrl: string,
  modelKey: string,
  apiKey?: string | null,
  contextSize?: number,
  providerType?: string,
) {
  return request('/api/lm-connections/models/load', {
    method: 'POST',
    body: {
      baseUrl,
      modelKey,
      apiKey: apiKey ?? null,
      contextSize,
      providerType,
    },
    schema: lmConnectionModelMutationResponseSchema,
  })
}

export function unloadLmConnectionModel(
  baseUrl: string,
  instanceId: string,
  apiKey?: string | null,
  providerType?: string,
) {
  return request('/api/lm-connections/models/unload', {
    method: 'POST',
    body: { baseUrl, instanceId, apiKey: apiKey ?? null, providerType },
    schema: lmConnectionModelMutationResponseSchema,
  })
}

const lmConnectionModelDetailsResponseSchema = z.object({
  details: z.unknown(),
})

export function fetchLmConnectionModelDetails(
  baseUrl: string,
  modelKey: string,
  providerType?: 'lmstudio' | 'openrouter' | 'ollama',
) {
  return request('/api/lm-connections/models/details', {
    method: 'POST',
    body: { baseUrl, modelKey, providerType },
    schema: lmConnectionModelDetailsResponseSchema,
  })
}

const mcpTestResponseSchema = z.object({
  serverName: z.string(),
  serverVersion: z.string(),
  tools: z.array(z.string()),
})

export function testMcpProfile(url: string) {
  return request('/api/mcp-profiles/test', {
    method: 'POST',
    body: { url },
    schema: mcpTestResponseSchema,
  })
}

const preflightResponseSchema = z.object({ ok: z.literal(true) })

export function preflightSession(input: {
  lmConnectionSnapshot: { baseUrl: string; apiKey?: string | null }
  mcpProfileSnapshots?: { url: string }[]
  selectedModel: { modelKey: string; modelDisplayName?: string }
  providerType?: 'lmstudio' | 'openrouter' | 'ollama'
}) {
  return request('/api/sessions/preflight', {
    method: 'POST',
    body: input,
    schema: preflightResponseSchema,
  })
}

export function getSessionCreationDefaults() {
  return request('/api/session-creation-defaults', {
    schema: sessionCreationDefaultsResponseSchema,
  })
}

export function putSessionCreationDefaults(input: {
  defaultModelConfigId: string | null
}): Promise<{ sessionCreationDefaults: SessionCreationDefaults }> {
  return request('/api/session-creation-defaults', {
    method: 'PUT',
    body: input,
    schema: sessionCreationDefaultsResponseSchema,
  })
}

export function launchAnalysis(input: {
  target_session_id: string
  target_turn_id: string
  workflow_kind?: 'full_session_analysis' | 'fast_session_analysis' | 'fast_tool_analysis'
  analysis_goal?: string
  model_config_id?: string
  additional_instructions?: string
  system_prompt_override?: string
  temperature?: number | null
  max_tool_rounds?: number
  selected_tool_names?: string[]
  only_failed_tool_calls?: boolean
  evaluation_criteria?: string[]
}) {
  return request('/api/session-constructors/session-analysis', {
    method: 'POST',
    body: input,
    schema: launchAnalysisResponseSchema,
  })
}

export function getDefaultAnalysisSystemPrompt(
  input: {
    analysis_goal?: string
    additional_instructions?: string
    workflow_kind?: 'full_session_analysis' | 'fast_session_analysis' | 'fast_tool_analysis'
  } = {},
) {
  const params = new URLSearchParams()
  if (input.analysis_goal) {
    params.set('analysis_goal', input.analysis_goal)
  }
  if (input.additional_instructions) {
    params.set('additional_instructions', input.additional_instructions)
  }
  if (input.workflow_kind) {
    params.set('workflow_kind', input.workflow_kind)
  }
  const query = params.size > 0 ? `?${params.toString()}` : ''
  return request(`/api/analysis/system-prompt-default${query}`, {
    schema: analysisSystemPromptResponseSchema,
  })
}

// ─── Scheduler API ──────────────────────────────────────────────────────────

export function getSchedulerSnapshot(): Promise<ExecutionSnapshot> {
  return request('/api/scheduler/snapshot', {
    schema: executionSnapshotSchema,
  })
}

export function enqueueSession(sessionId: string, prompt?: string): Promise<{ job: ExecutionJob }> {
  return request('/api/scheduler/enqueue', {
    method: 'POST',
    body: {
      session_id: sessionId,
      ...(prompt !== undefined ? { prompt } : {}),
    },
  })
}

export function enqueueStep(sessionId: string): Promise<{ job: ExecutionJob }> {
  return request('/api/scheduler/enqueue-step', {
    method: 'POST',
    body: { session_id: sessionId },
  })
}

export function pauseScheduler(): Promise<{
  ok: boolean
  controlState: string
}> {
  return request('/api/scheduler/pause', { method: 'POST' })
}

export function resumeScheduler(): Promise<{
  ok: boolean
  controlState: string
}> {
  return request('/api/scheduler/resume', { method: 'POST' })
}

export function removeSchedulerJob(jobId: string): Promise<void> {
  return request<void>(`/api/scheduler/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  })
}

export function abortScheduler(): Promise<{ ok: boolean; aborted: boolean }> {
  return request('/api/scheduler/abort', { method: 'POST' })
}

export function retryInitSession(sessionId: string): Promise<{ ok: true }> {
  return request(`/api/sessions/${sessionId}/retry-init`, { method: 'POST' })
}

// ─── Benchmark API ────────────────────────────────────────────────────────

export function listBenchmarks() {
  return request('/api/benchmarks', { schema: listBenchmarksResponseSchema })
}

export function getBenchmark(id: string) {
  return request(`/api/benchmarks/${encodeURIComponent(id)}`, {
    schema: benchmarkDetailResponseSchema,
  })
}

export function createBenchmark(input: { name: string; description?: string | null }) {
  return request('/api/benchmarks', {
    method: 'POST',
    body: input,
    schema: benchmarkResponseSchema,
  })
}

export function patchBenchmark(id: string, input: { name?: string; description?: string | null }) {
  return request(`/api/benchmarks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
    schema: benchmarkResponseSchema,
  })
}

export function deleteBenchmark(id: string) {
  return request<void>(`/api/benchmarks/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function createCase(
  benchmarkId: string,
  input: {
    prompt: string
    name?: string | null
    expectedToolsCalled?: string[]
    expectedToolsNotCalled?: string[]
    rubric?: RubricCriterion[]
  },
) {
  return request(`/api/benchmarks/${encodeURIComponent(benchmarkId)}/cases`, {
    method: 'POST',
    body: input,
    schema: benchmarkCaseResponseSchema,
  })
}

export function createCaseFromSession(
  benchmarkId: string,
  input: { sessionId: string; name?: string | null },
) {
  return request(`/api/benchmarks/${encodeURIComponent(benchmarkId)}/cases/from-session`, {
    method: 'POST',
    body: input,
    schema: benchmarkCaseResponseSchema,
  })
}

export function patchCase(
  caseId: string,
  input: {
    name?: string | null
    prompt?: string
    orderIndex?: number
    expectedToolsCalled?: string[]
    expectedToolsNotCalled?: string[]
    rubric?: RubricCriterion[]
  },
) {
  return request(`/api/benchmark-cases/${encodeURIComponent(caseId)}`, {
    method: 'PATCH',
    body: input,
    schema: benchmarkCaseResponseSchema,
  })
}

export function deleteCase(caseId: string) {
  return request<void>(`/api/benchmark-cases/${encodeURIComponent(caseId)}`, {
    method: 'DELETE',
  })
}

export function launchRun(
  benchmarkId: string,
  input: {
    caseIds?: string[]
    repetitions?: number
    modelConfigId?: string
    mcpProfileIds?: string[]
    maxToolRounds?: number
  },
) {
  return request(`/api/benchmarks/${encodeURIComponent(benchmarkId)}/runs`, {
    method: 'POST',
    body: input,
    schema: benchmarkRunResponseSchema,
  })
}

export function getBenchmarkRun(runId: string) {
  return request(`/api/benchmark-runs/${encodeURIComponent(runId)}`, {
    schema: benchmarkRunReportResponseSchema,
  })
}

export function deleteBenchmarkRun(runId: string) {
  return request<void>(`/api/benchmark-runs/${encodeURIComponent(runId)}`, {
    method: 'DELETE',
  })
}

export function pauseBenchmarkRun(runId: string) {
  return request(`/api/benchmark-runs/${encodeURIComponent(runId)}/pause`, {
    method: 'POST',
    schema: benchmarkRunResponseSchema,
  })
}

/** mode 'continue' = run remaining tasks; 'retry' = also re-run cancelled/errored. */
export function resumeBenchmarkRun(runId: string, mode: 'continue' | 'retry' = 'continue') {
  return request(`/api/benchmark-runs/${encodeURIComponent(runId)}/resume`, {
    method: 'POST',
    body: { mode },
    schema: benchmarkRunResponseSchema,
  })
}

export function stopBenchmarkRun(runId: string) {
  return request(`/api/benchmark-runs/${encodeURIComponent(runId)}/stop`, {
    method: 'POST',
    schema: benchmarkRunResponseSchema,
  })
}

export function launchEvaluation(
  runId: string,
  input: { judgeModelConfigId: string; temperature?: number | null },
) {
  return request(`/api/benchmark-runs/${encodeURIComponent(runId)}/evaluations`, {
    method: 'POST',
    body: input,
    schema: benchmarkEvaluationResponseSchema,
  })
}

export function getEvaluations(runId: string) {
  return request(`/api/benchmark-runs/${encodeURIComponent(runId)}/evaluations`, {
    schema: benchmarkEvaluationsResponseSchema,
  })
}

export function deleteEvaluation(evaluationId: string) {
  return request<void>(`/api/benchmark-evaluations/${encodeURIComponent(evaluationId)}`, {
    method: 'DELETE',
  })
}

export function retryEvaluation(evaluationId: string) {
  return request(`/api/benchmark-evaluations/${encodeURIComponent(evaluationId)}/retry`, {
    method: 'POST',
    schema: benchmarkEvaluationResponseSchema,
  })
}

export function pauseEvaluation(evaluationId: string) {
  return request(`/api/benchmark-evaluations/${encodeURIComponent(evaluationId)}/pause`, {
    method: 'POST',
    schema: benchmarkEvaluationResponseSchema,
  })
}

export function resumeEvaluation(evaluationId: string, mode: 'continue' | 'retry' = 'continue') {
  return request(`/api/benchmark-evaluations/${encodeURIComponent(evaluationId)}/resume`, {
    method: 'POST',
    body: { mode },
    schema: benchmarkEvaluationResponseSchema,
  })
}

export function stopEvaluation(evaluationId: string) {
  return request(`/api/benchmark-evaluations/${encodeURIComponent(evaluationId)}/stop`, {
    method: 'POST',
    schema: benchmarkEvaluationResponseSchema,
  })
}

/**
 * Parse one SSE data payload into a SchedulerEvent, tolerantly: a malformed or
 * unrecognized event is skipped (and warned in dev) rather than thrown, so a
 * single bad event can't tear down the whole stream.
 */
function parseSchedulerEvent(dataText: string): SchedulerEvent | null {
  let json: unknown
  try {
    json = JSON.parse(dataText)
  } catch {
    return null
  }
  const result = schedulerEventSchema.safeParse(json)
  if (!result.success) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console -- dev-only diagnostic for schema drift
      console.warn(
        '[scheduler stream] skipping unrecognized event:',
        result.error.issues[0]?.message ?? 'invalid shape',
      )
    }
    return null
  }
  return result.data
}

export async function streamSchedulerEvents(
  onEvent: (event: SchedulerEvent) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(buildUrl('/api/scheduler/stream'), {
    headers: { Accept: 'text/event-stream' },
    signal,
  })

  if (!response.ok || !response.body) {
    throw new AppError('Failed to connect to scheduler stream', 'internal', response.status)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })

      let separatorIndex = buffer.search(/\r?\n\r?\n/)
      while (separatorIndex >= 0) {
        const block = buffer.slice(0, separatorIndex)
        buffer = buffer.slice(separatorIndex + (buffer[separatorIndex] === '\r' ? 4 : 2))
        const parsed = parseSseBlock(block)
        if (parsed?.dataText) {
          const event = parseSchedulerEvent(parsed.dataText)
          if (event) await onEvent(event)
        }
        separatorIndex = buffer.search(/\r?\n\r?\n/)
      }

      if (done) break
    }
  } catch (err) {
    if (signal?.aborted) return
    throw err
  }
}
