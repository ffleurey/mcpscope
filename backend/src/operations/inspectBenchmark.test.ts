import crypto from 'node:crypto'
import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { openBackendDatabase, type BackendDatabase } from '../persistence/db.js'
import {
  createBenchmark,
  createBenchmarkCase,
  createBenchmarkRun,
  createBenchmarkEvaluation,
} from '../persistence/benchmarkRepository.js'
import type {
  BenchmarkCaseRecord,
  BenchmarkRunRecord,
  BenchmarkEvaluationRecord,
  RubricCriterion,
} from '../domain/model.js'
import type { OperationContext } from './context.js'
import { inspectOperation } from './inspect.js'
import { resolveBenchmarkInspect } from './benchmarkOperations.js'

// inspect is the single operation shared by the UI id-pill lookup (/api/lookup),
// the CLI, and the MCP tool — so resolving these IDs here proves all three surfaces
// inspect benchmark objects identically.

let dataDir: string | undefined
let db: BackendDatabase | undefined

afterEach(() => {
  db?.connection.close()
  db = undefined
  if (dataDir) {
    fs.rmSync(dataDir, { recursive: true, force: true })
    dataDir = undefined
  }
})

const RUBRIC: RubricCriterion[] = [
  { id: 1, description: 'Correct temperature returned', points: 2 },
  { id: 2, description: 'Sensor resolved in one discovery call', points: 1 },
]

function seed(): BackendDatabase {
  dataDir = `.tmp-test-data/${crypto.randomUUID()}`
  fs.mkdirSync(dataDir, { recursive: true })
  db = openBackendDatabase(`${dataDir}/test.db`)
  const c = db.connection

  createBenchmark(c, { id: 'B-TEST', name: 'Bench', description: null, createdAt: 1, updatedAt: 1 })
  const caseRecord: BenchmarkCaseRecord = {
    id: 'B-TEST.1',
    benchmarkId: 'B-TEST',
    name: 'temp',
    prompt: 'What is the outdoor temperature?',
    orderIndex: 0,
    expectedToolsCalled: [],
    expectedToolsNotCalled: [],
    rubric: RUBRIC,
    sourceSessionId: null,
    createdAt: 1,
    updatedAt: 1,
  }
  createBenchmarkCase(c, caseRecord)
  const run: BenchmarkRunRecord = {
    id: 'R-TEST',
    benchmarkId: 'B-TEST',
    benchmarkName: 'Bench',
    status: 'complete',
    modelConfigId: 'mc-1',
    mcpProfileIds: [],
    cases: [
      {
        sourceCaseId: 'B-TEST.1',
        name: 'temp',
        prompt: 'What is the outdoor temperature?',
        expectedToolsCalled: [],
        expectedToolsNotCalled: [],
        rubric: RUBRIC,
      },
    ],
    repetitions: 1,
    maxToolRounds: 50,
    sessions: [
      { sessionId: 'AB12', sourceCaseId: 'B-TEST.1', repetition: 0, status: 'complete', error: null },
    ],
    error: null,
    createdAt: 1,
    updatedAt: 1,
    startedAt: null,
    completedAt: null,
  }
  createBenchmarkRun(c, run)
  const evaluation: BenchmarkEvaluationRecord = {
    id: 'E-TEST',
    runId: 'R-TEST',
    judgeModelConfigId: 'judge-1',
    judgeTemperature: 0,
    status: 'complete',
    sessions: [{ runSessionId: 'AB12', analysisSessionId: 'CD34', status: 'complete' }],
    error: null,
    createdAt: 1,
    updatedAt: 1,
  }
  createBenchmarkEvaluation(c, evaluation)
  return db
}

function ctxFor(d: BackendDatabase): OperationContext {
  return { db: d } as unknown as OperationContext
}

describe('inspect — benchmark-family IDs', () => {
  it('resolves a benchmark (B-): case shapes + minimal run digests + drill IDs, no results', async () => {
    const ctx = ctxFor(seed())
    const out = await inspectOperation.execute(ctx, { id: 'B-TEST' })
    expect(out.type).toBe('benchmark')
    expect((out.data.benchmark as { id: string }).id).toBe('B-TEST')

    const cases = out.data.cases as Array<Record<string, unknown>>
    expect(cases.length).toBe(1)
    // Suite view carries the rubric *count* (scorability hint), not the rubric itself.
    expect(cases[0]!.rubric_criteria_count).toBe(2)
    expect(cases[0]!.rubric).toBeUndefined()

    const runs = out.data.runs as Array<Record<string, unknown>>
    expect(runs.length).toBe(1)
    expect(runs[0]!.evaluation_ids).toEqual(['E-TEST'])
    expect(runs[0]!.total_sessions).toBe(1)
  })

  it('benchmark (B-) summary is a lean router: case/run nav ids only, no per-case detail', async () => {
    const ctx = ctxFor(seed())
    const out = await inspectOperation.execute(ctx, { id: 'B-TEST', short: true })
    expect(out.mode).toBe('summary')
    const cases = out.data.cases as Array<Record<string, unknown>>
    expect(cases[0]).toEqual({ id: 'B-TEST.1', name: 'temp' })
    // Summary omits the prompt, rubric size, and per-run completion (full adds them).
    expect(cases[0]!.rubric_criteria_count).toBeUndefined()
    const runs = out.data.runs as Array<Record<string, unknown>>
    expect(runs[0]).toEqual({ id: 'R-TEST', status: 'complete' })
    expect(runs[0]!.total_sessions).toBeUndefined()
  })

  it('resolves a case (B-.N) to its snake payload incl. rubric', async () => {
    const ctx = ctxFor(seed())
    const out = await inspectOperation.execute(ctx, { id: 'B-TEST.1' })
    expect(out.type).toBe('benchmark_case')
    expect(out.data.id).toBe('B-TEST.1')
    expect((out.data.rubric as unknown[]).length).toBe(2)
  })

  it('resolves a run (R-): summary = status + drillable sessions; full adds metrics', async () => {
    const ctx = ctxFor(seed())
    const summary = await inspectOperation.execute(ctx, { id: 'R-TEST', short: true })
    expect(summary.type).toBe('benchmark_run')
    expect((summary.data.run as { id: string }).id).toBe('R-TEST')
    // Drillable session list with id + status; no heavy per-case/per-tool metrics.
    const sessions = summary.data.sessions as Array<Record<string, unknown>>
    expect(sessions.length).toBe(1)
    expect(sessions[0]!.session_id).toBe('AB12')
    expect(summary.data.per_case).toBeUndefined()
    expect(summary.data.per_tool).toBeUndefined()
    // Evaluations are listed for progress monitoring (judged/expected).
    const evals = summary.data.evaluations as Array<Record<string, unknown>>
    expect(evals[0]!.id).toBe('E-TEST')
    expect(evals[0]!.expected_sessions).toBe(1)

    const full = await inspectOperation.execute(ctx, { id: 'R-TEST' })
    expect(full.data.per_case).toBeDefined()
    expect(full.data.per_tool).toBeDefined()
  })

  it('resolves an evaluation (E-): status + scores + drillable judged sessions', async () => {
    const ctx = ctxFor(seed())
    const summary = await inspectOperation.execute(ctx, { id: 'E-TEST', short: true })
    expect(summary.type).toBe('benchmark_evaluation')
    const ev = summary.data.evaluation as Record<string, unknown>
    expect(ev.id).toBe('E-TEST')
    expect(ev.expected_sessions).toBe(1)
    expect(ev).toHaveProperty('overall_pct')
    expect(ev).toHaveProperty('incomplete')
    // Flat, drillable session list; no per-criterion grid in summary.
    const sessions = summary.data.sessions as Array<Record<string, unknown>>
    expect(sessions[0]!.analysis_session_id).toBe('CD34')
    expect(sessions[0]!.criteria).toBeUndefined()

    const full = await inspectOperation.execute(ctx, { id: 'E-TEST' })
    const fullSessions = full.data.sessions as Array<Record<string, unknown>>
    expect(fullSessions[0]!.criteria).toBeDefined()
  })

  it('throws not-found for an unknown benchmark ID', async () => {
    const ctx = ctxFor(seed())
    await expect(inspectOperation.execute(ctx, { id: 'B-NOPE' })).rejects.toThrow(/not found/i)
  })

  it('returns null for non-benchmark IDs so runtime resolution takes over', () => {
    const ctx = ctxFor(seed())
    expect(resolveBenchmarkInspect(ctx, 'QGWA', 'full')).toBeNull()
    expect(resolveBenchmarkInspect(ctx, 'QGWA.1T', 'full')).toBeNull()
  })
})
