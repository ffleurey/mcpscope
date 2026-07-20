import { describe, expect, it } from 'vitest'
import { openBackendDatabase } from './db.js'
import { createSessionRecord, listTopLevelSessionSummaries } from './repositoryRuntime.js'
import type { SessionRecord } from '../domain/model.js'

function makeSession(overrides: Partial<SessionRecord>): SessionRecord {
  const ts = overrides.updatedAt ?? 1
  return {
    id: 'AAAA',
    title: 'Session',
    status: 'ready',
    initStatus: 'ready',
    sessionType: 'primary',
    parentKind: null,
    parentId: null,
    createdAt: ts,
    updatedAt: ts,
    modelProfileSnapshot: {
      id: 'model-1',
      name: 'Model',
      connectionBaseUrl: 'https://example.com/v1',
      apiKey: null,
      modelKey: 'model-key',
      modelDisplayName: 'Model Key',
      systemPrompt: 'You are exact.',
      temperature: 0,
      reasoning: 'on',
      createdAt: 1,
      updatedAt: 1,
    },
    mcpProfileSnapshots: [],
    loadedContextLength: null,
    systemPromptTokens: null,
    toolDefinitionsTokens: null,
    isContextExhausted: false,
    compactionStrategy: 'strip-reasoning',
    ...overrides,
  }
}

describe('listTopLevelSessionSummaries', () => {
  it('returns only standalone primary sessions, newest first, excluding benchmark and judge children', () => {
    const db = openBackendDatabase(':memory:')
    try {
      // Two standalone top-level primaries (the only rows `list` should surface).
      createSessionRecord(db.connection, makeSession({ id: 'TOP1', updatedAt: 100 }))
      createSessionRecord(db.connection, makeSession({ id: 'TOP2', updatedAt: 200 }))
      // A benchmark-run child (primary under a run) — must be excluded.
      createSessionRecord(db.connection, makeSession({
        id: 'BENC', updatedAt: 300, parentKind: 'benchmark', parentId: 'R-XXXX',
      }))
      // A judge/analysis session — must be excluded.
      createSessionRecord(db.connection, makeSession({
        id: 'JUDG', updatedAt: 400, sessionType: 'session_analysis',
        parentKind: 'session', parentId: 'TOP1',
      }))

      const { rows, total } = listTopLevelSessionSummaries(db.connection, { limit: 50, offset: 0 })
      expect(rows.map(r => r.id)).toEqual(['TOP2', 'TOP1'])
      expect(total).toBe(2)
    } finally {
      db.connection.close()
    }
  })

  it('paginates with limit/offset while reporting the full total', () => {
    const db = openBackendDatabase(':memory:')
    try {
      createSessionRecord(db.connection, makeSession({ id: 'S1', updatedAt: 10 }))
      createSessionRecord(db.connection, makeSession({ id: 'S2', updatedAt: 20 }))
      createSessionRecord(db.connection, makeSession({ id: 'S3', updatedAt: 30 }))

      const page1 = listTopLevelSessionSummaries(db.connection, { limit: 2, offset: 0 })
      expect(page1.rows.map(r => r.id)).toEqual(['S3', 'S2'])
      expect(page1.total).toBe(3)

      const page2 = listTopLevelSessionSummaries(db.connection, { limit: 2, offset: 2 })
      expect(page2.rows.map(r => r.id)).toEqual(['S1'])
      expect(page2.total).toBe(3)
    } finally {
      db.connection.close()
    }
  })
})
