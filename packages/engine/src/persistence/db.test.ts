import { describe, expect, it } from 'vitest'
import { openBackendDatabase } from './db.js'
import { createSessionRecord, getSessionRecord } from './repositoryRuntime.js'

describe('openBackendDatabase', () => {
  it("supports ':memory:' — initializes a working schema without touching the filesystem", () => {
    const db = openBackendDatabase(':memory:')
    try {
      expect(db.path).toBe(':memory:')
      expect(db.schema.tables).toContain('sessions')
      expect(db.schema.meta).toHaveProperty('schema_version')

      const ts = Date.now()
      createSessionRecord(db.connection, {
        id: 'MEMT',
        title: 'In-memory session',
        status: 'ready',
        initStatus: 'pending',
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
      })

      const roundTripped = getSessionRecord(db.connection, 'MEMT')
      expect(roundTripped?.id).toBe('MEMT')
      expect(roundTripped?.title).toBe('In-memory session')
    } finally {
      db.connection.close()
    }
  })
})
