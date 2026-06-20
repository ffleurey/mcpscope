import crypto from 'node:crypto'
import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { openBackendDatabase, type BackendDatabase } from './db.js'
import {
  createBenchmark,
  createBenchmarkCase,
  getBenchmarkCase,
  updateBenchmarkCase,
  createBenchmarkRun,
  getBenchmarkRun,
} from './benchmarkRepository.js'
import type { BenchmarkCaseRecord, BenchmarkRunRecord, RubricCriterion } from '../domain/model.js'

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

function openTempDb(): BackendDatabase {
  dataDir = `.tmp-test-data/${crypto.randomUUID()}`
  fs.mkdirSync(dataDir, { recursive: true })
  db = openBackendDatabase(`${dataDir}/test.db`)
  return db
}

const RUBRIC: RubricCriterion[] = [
  { id: 1, description: 'Correct temperature returned', points: 2 },
  { id: 2, description: 'Sensor resolved in one discovery call', points: 1 },
]

function caseRecord(overrides: Partial<BenchmarkCaseRecord> = {}): BenchmarkCaseRecord {
  return {
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
    ...overrides,
  }
}

describe('benchmark case rubric persistence', () => {
  it('round-trips a case rubric through create + get', () => {
    const d = openTempDb()
    createBenchmark(d.connection, { id: 'B-TEST', name: 'B', description: null, createdAt: 1, updatedAt: 1 })
    createBenchmarkCase(d.connection, caseRecord())

    const reloaded = getBenchmarkCase(d.connection, 'B-TEST.1')
    expect(reloaded?.rubric).toEqual(RUBRIC)
  })

  it('updates a case rubric', () => {
    const d = openTempDb()
    createBenchmark(d.connection, { id: 'B-TEST', name: 'B', description: null, createdAt: 1, updatedAt: 1 })
    createBenchmarkCase(d.connection, caseRecord())

    const next: RubricCriterion[] = [{ id: 1, description: 'only one now', points: 5 }]
    updateBenchmarkCase(d.connection, caseRecord({ rubric: next, updatedAt: 2 }))

    expect(getBenchmarkCase(d.connection, 'B-TEST.1')?.rubric).toEqual(next)
  })

  it('defaults to an empty rubric when none is stored', () => {
    const d = openTempDb()
    createBenchmark(d.connection, { id: 'B-TEST', name: 'B', description: null, createdAt: 1, updatedAt: 1 })
    createBenchmarkCase(d.connection, caseRecord({ rubric: [] }))
    expect(getBenchmarkCase(d.connection, 'B-TEST.1')?.rubric).toEqual([])
  })
})

describe('benchmark run rubric snapshot', () => {
  it('preserves the rubric inside the run case snapshot (cases_json)', () => {
    const d = openTempDb()
    const run: BenchmarkRunRecord = {
      id: 'R-TEST',
      benchmarkId: 'B-TEST',
      benchmarkName: 'B',
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
      sessions: [],
      error: null,
      createdAt: 1,
      updatedAt: 1,
      startedAt: null,
      completedAt: null,
    }
    createBenchmarkRun(d.connection, run)

    const reloaded = getBenchmarkRun(d.connection, 'R-TEST')
    expect(reloaded?.cases[0]?.rubric).toEqual(RUBRIC)
  })
})
