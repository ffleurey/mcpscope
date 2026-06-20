import { get, writable } from 'svelte/store'
import {
  createBenchmark as createBackendBenchmark,
  createCase as createBackendCase,
  createCaseFromSession as createBackendCaseFromSession,
  deleteBenchmark as deleteBackendBenchmark,
  deleteBenchmarkRun as deleteBackendBenchmarkRun,
  deleteCase as deleteBackendCase,
  getBenchmark,
  getBenchmarkRun,
  getEvaluations as getBackendEvaluations,
  launchEvaluation as launchBackendEvaluation,
  launchRun as launchBackendRun,
  listBenchmarks,
  patchBenchmark as patchBackendBenchmark,
  patchCase as patchBackendCase,
} from './api/backendClient'
import type {
  Benchmark,
  BenchmarkCase,
  BenchmarkDetailResponse,
  BenchmarkEvaluationReport,
  BenchmarkRun,
  BenchmarkSummary,
  RubricCriterion,
  RunReport,
} from './backendTypes'
import { refreshSessions } from './sessionStore'

export const benchmarks = writable<BenchmarkSummary[]>([])
export const runs = writable<BenchmarkRun[]>([])
export const activeRunId = writable<string | null>(null)
export const activeRunReport = writable<RunReport | null>(null)
export const activeRun = writable<BenchmarkRun | null>(null)
/** Evaluation passes for the active run, each with computed scores. */
export const activeRunEvaluations = writable<BenchmarkEvaluationReport[]>([])

// Active benchmark detail view (mutually exclusive with run/chat selection).
export const activeBenchmarkId = writable<string | null>(null)
export const activeBenchmarkDetail = writable<BenchmarkDetailResponse | null>(null)

const TERMINAL_STATUSES = new Set(['complete', 'error'])
const POLL_INTERVAL_MS = 700

let pollTimer: ReturnType<typeof setTimeout> | null = null
let evalPollTimer: ReturnType<typeof setTimeout> | null = null

function sortByUpdatedAtDesc<T extends { updatedAt: number }>(records: T[]): T[] {
  return [...records].sort((left, right) => right.updatedAt - left.updatedAt)
}

function upsertRun(run: BenchmarkRun): void {
  runs.update((list) => sortByUpdatedAtDesc([run, ...list.filter((r) => r.id !== run.id)]))
}

export async function refreshBenchmarks(): Promise<void> {
  const { benchmarks: list } = await listBenchmarks()
  benchmarks.set(sortByUpdatedAtDesc(list))
}

/**
 * Load benchmarks and every benchmark's runs so the sidebar run list can be
 * populated up front. Runs are first-class (flat) but the listing endpoint is
 * per-benchmark detail, so we fan out across benchmarks.
 */
export async function initBenchmarkStore(): Promise<void> {
  const { benchmarks: list } = await listBenchmarks()
  benchmarks.set(sortByUpdatedAtDesc(list))

  const details = await Promise.all(list.map((b) => getBenchmark(b.id).catch(() => null)))
  const allRuns = details.flatMap((d) => d?.runs ?? [])
  runs.set(sortByUpdatedAtDesc(allRuns))
}

function stopPolling(): void {
  if (pollTimer != null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

function stopEvalPolling(): void {
  if (evalPollTimer != null) {
    clearTimeout(evalPollTimer)
    evalPollTimer = null
  }
}

function evaluationsInFlight(evals: BenchmarkEvaluationReport[]): boolean {
  return evals.some((e) => e.status === 'pending' || e.status === 'running')
}

async function refreshActiveRunEvaluations(runId: string): Promise<BenchmarkEvaluationReport[]> {
  const { evaluations } = await getBackendEvaluations(runId)
  if (get(activeRunId) !== runId) return []
  activeRunEvaluations.set(evaluations)
  return evaluations
}

async function pollActiveRunEvaluations(runId: string): Promise<void> {
  if (get(activeRunId) !== runId) return
  try {
    const evals = await refreshActiveRunEvaluations(runId)
    // Surface the spawned judge child sessions in the sidebar as they appear.
    await refreshSessions().catch(() => undefined)
    if (!evaluationsInFlight(evals)) {
      stopEvalPolling()
      return
    }
  } catch {
    // transient — keep polling while this run stays active
  }
  if (get(activeRunId) !== runId) return
  evalPollTimer = setTimeout(() => void pollActiveRunEvaluations(runId), POLL_INTERVAL_MS)
}

async function pollActiveRun(runId: string): Promise<void> {
  if (get(activeRunId) !== runId) return
  try {
    const { run, report } = await getBenchmarkRun(runId)
    if (get(activeRunId) !== runId) return
    activeRun.set(run)
    activeRunReport.set(report)
    upsertRun(run)
    // Surface spawned child sessions in the sidebar tree as they appear.
    await refreshSessions().catch(() => undefined)
    if (TERMINAL_STATUSES.has(run.status)) {
      stopPolling()
      return
    }
  } catch {
    // transient — keep polling while this run stays active
  }
  if (get(activeRunId) !== runId) return
  pollTimer = setTimeout(() => void pollActiveRun(runId), POLL_INTERVAL_MS)
}

/** Open a run report. Clears chat + benchmark selection (mutual reset). */
export async function selectRun(runId: string): Promise<void> {
  stopPolling()
  stopEvalPolling()
  activeRunId.set(runId)
  activeRun.set(null)
  activeRunReport.set(null)
  activeRunEvaluations.set([])
  clearBenchmarkSelection()

  // Mutual reset: opening a run clears the chat selection.
  const { clearChatSelection } = await import('./sessionStore')
  clearChatSelection()

  const { run, report } = await getBenchmarkRun(runId)
  if (get(activeRunId) !== runId) return
  activeRun.set(run)
  activeRunReport.set(report)
  upsertRun(run)

  if (!TERMINAL_STATUSES.has(run.status)) {
    await refreshSessions().catch(() => undefined)
    pollTimer = setTimeout(() => void pollActiveRun(runId), POLL_INTERVAL_MS)
  }

  // Load any evaluation passes; keep polling while one is still judging.
  const evals = await refreshActiveRunEvaluations(runId).catch(
    () => [] as BenchmarkEvaluationReport[],
  )
  if (get(activeRunId) === runId && evaluationsInFlight(evals)) {
    evalPollTimer = setTimeout(() => void pollActiveRunEvaluations(runId), POLL_INTERVAL_MS)
  }
}

/** Clear the active run (called when a chat is selected). */
export function clearActiveRun(): void {
  stopPolling()
  stopEvalPolling()
  activeRunId.set(null)
  activeRun.set(null)
  activeRunReport.set(null)
  activeRunEvaluations.set([])
}

/** Clear the active benchmark detail (called when a run/chat is selected). */
export function clearBenchmarkSelection(): void {
  activeBenchmarkId.set(null)
  activeBenchmarkDetail.set(null)
}

/**
 * Open a benchmark detail view. Loads the full detail (cases + runs) and clears
 * the active run + chat selection so exactly one main-pane entity renders.
 */
export async function selectBenchmark(benchmarkId: string): Promise<void> {
  activeBenchmarkId.set(benchmarkId)
  activeBenchmarkDetail.set(null)

  // Mutual reset: opening a benchmark clears the run + chat selections.
  clearActiveRun()
  const { clearChatSelection } = await import('./sessionStore')
  clearChatSelection()

  const detail = await getBenchmark(benchmarkId)
  if (get(activeBenchmarkId) !== benchmarkId) return
  activeBenchmarkDetail.set(detail)
}

/** Reload the active benchmark's detail (after a case/run mutation). */
export async function refreshActiveBenchmarkDetail(): Promise<void> {
  const benchmarkId = get(activeBenchmarkId)
  if (!benchmarkId) return
  const detail = await getBenchmark(benchmarkId)
  if (get(activeBenchmarkId) !== benchmarkId) return
  activeBenchmarkDetail.set(detail)
}

// ── Mutations ────────────────────────────────────────────────────────────

export async function createBenchmark(input: {
  name: string
  description?: string | null
}): Promise<Benchmark> {
  const { benchmark } = await createBackendBenchmark(input)
  await refreshBenchmarks()
  return benchmark
}

export async function updateBenchmark(
  id: string,
  input: { name?: string; description?: string | null },
): Promise<void> {
  await patchBackendBenchmark(id, input)
  await refreshBenchmarks()
}

export async function removeBenchmark(id: string): Promise<void> {
  await deleteBackendBenchmark(id)
  if (get(activeBenchmarkId) === id) clearBenchmarkSelection()
  await refreshBenchmarks()
}

export async function createCase(
  benchmarkId: string,
  input: {
    prompt: string
    name?: string | null
    expectedToolsCalled?: string[]
    expectedToolsNotCalled?: string[]
    rubric?: RubricCriterion[]
  },
): Promise<BenchmarkCase> {
  const { case: created } = await createBackendCase(benchmarkId, input)
  await refreshBenchmarks()
  return created
}

export async function createCaseFromSession(
  benchmarkId: string,
  input: { sessionId: string; name?: string | null },
): Promise<BenchmarkCase> {
  const { case: created } = await createBackendCaseFromSession(benchmarkId, input)
  await refreshBenchmarks()
  return created
}

export async function updateCase(
  caseId: string,
  input: {
    name?: string | null
    prompt?: string
    expectedToolsCalled?: string[]
    expectedToolsNotCalled?: string[]
    rubric?: RubricCriterion[]
  },
): Promise<BenchmarkCase> {
  const { case: updated } = await patchBackendCase(caseId, input)
  return updated
}

export async function removeCase(caseId: string): Promise<void> {
  await deleteBackendCase(caseId)
  await refreshBenchmarks()
}

export async function launchRun(
  benchmarkId: string,
  input: {
    caseIds?: string[]
    repetitions?: number
    modelConfigId?: string
    mcpProfileIds?: string[]
  },
): Promise<BenchmarkRun> {
  const { run } = await launchBackendRun(benchmarkId, input)
  upsertRun(run)
  await refreshBenchmarks()
  return run
}

/**
 * Launch an evaluation pass over a completed run with the chosen judge model.
 * The pass runs in the background; we poll its scores until it settles.
 */
export async function launchEvaluation(runId: string, judgeModelConfigId: string): Promise<void> {
  await launchBackendEvaluation(runId, { judgeModelConfigId })
  if (get(activeRunId) !== runId) return
  await refreshActiveRunEvaluations(runId).catch(() => undefined)
  stopEvalPolling()
  if (get(activeRunId) === runId) {
    evalPollTimer = setTimeout(() => void pollActiveRunEvaluations(runId), POLL_INTERVAL_MS)
  }
}

export async function removeRun(runId: string): Promise<void> {
  await deleteBackendBenchmarkRun(runId)
  if (get(activeRunId) === runId) clearActiveRun()
  runs.update((list) => list.filter((r) => r.id !== runId))
  await refreshBenchmarks()
  await refreshSessions().catch(() => undefined)
}
