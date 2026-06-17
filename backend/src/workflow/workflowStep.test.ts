import { describe, expect, it } from 'vitest'
import { openBackendDatabase } from '../persistence/db.js'
import { createSessionRecord } from '../persistence/repository.js'
import { WorkflowStep } from './workflowStep.js'
import { stepTypeKey, type StepResult, type StepTypeKey } from '../domain/executionModel.js'
import type { BackendDatabase } from '../persistence/db.js'
import type { ChatCompletionGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'

// ── Inline helpers ──────────────────────────────────────────────────────────

function makeDb(): BackendDatabase {
  const dataDir = `.tmp-test-data/${crypto.randomUUID()}`
  return openBackendDatabase(`${dataDir}/test.db`)
}

function makeSession(db: BackendDatabase, id: string): void {
  createSessionRecord(db.connection, {
    id,
    title: id,
    status: 'ready',
    initStatus: 'ready',
    sessionType: 'primary',
    parentKind: null,
    parentId: null,
    createdAt: 1,
    updatedAt: 1,
    modelProfileSnapshot: {
      id: 'model-1', name: 'Model 1',
      modelKey: 'model-1', modelDisplayName: 'Model 1',
      connectionBaseUrl: 'https://example.invalid/v1', apiKey: null,
      systemPrompt: 'Reply exactly.', temperature: 0,
      reasoning: null,
      contextSize: null,
      createdAt: 1, updatedAt: 1,
    },
    mcpProfileSnapshots: [],
    loadedContextLength: null, systemPromptTokens: null,
    toolDefinitionsTokens: null, isContextExhausted: false,
    compactionStrategy: 'strip-reasoning',
  })
}

// ── Inline mock gateway (no-op, only needed to satisfy the constructor) ─────

const fakeLmGateway: ChatCompletionGateway = {
  createChatCompletion: async () => { throw new Error('unexpected') },
}

const fakeMcpGateway: McpGateway = {
  initializeSession: async () => ({
    sessionId: null,
    rawExchange: { requestUrl: '', requestMethod: 'GET', requestBodyText: '', responseStatus: 200, responseBody: null },
  }),
  listTools: async () => ({
    tools: [],
    rawResult: null,
    rawExchange: { requestUrl: '', requestMethod: 'GET', requestBodyText: '', responseStatus: 200, responseBody: null },
  }),
  callTool: async () => ({
    content: '',
    structuredContent: null,
    isError: false,
    rawResult: null,
    rawExchange: { requestUrl: '', requestMethod: 'POST', requestBodyText: '', responseStatus: 200, responseBody: null },
  }),
}

// ── Concrete mock step returning a configurable result ──────────────────────

class MockStep extends WorkflowStep {
  readonly stepLabel = 'Mock Step'
  readonly kind = 'test'
  readonly stepTypeKey: StepTypeKey = stepTypeKey('analysis_bootstrap')
  get semanticId(): string { return '' }
  isComplete(): boolean { return false }

  constructor(
    db: BackendDatabase,
    lm: ChatCompletionGateway,
    mcp: McpGateway,
    private readonly mockResult: StepResult,
  ) {
    super(db, lm, mcp)
  }
  protected async run(): Promise<StepResult> {
    return this.mockResult
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('WorkflowStep.execute() step status persistence', () => {

  it('persists status="error" when run() returns { status: "error" }', async () => {
    const db = makeDb()
    makeSession(db, 'TEST')

    const step = new MockStep(db, fakeLmGateway, fakeMcpGateway, {
      status: 'error',
      outputArtifacts: [],
      error: 'Intentional failure',
    })
    await step.execute({ sessionId: 'TEST', stepTypeKey: stepTypeKey('analysis_bootstrap') })

    const row = db.connection.prepare(
      'SELECT status, state_json FROM steps WHERE id = ?',
    ).get(step.stepId) as { status: string; state_json: string } | undefined

    expect(row?.status).toBe('error')
    expect(row?.state_json).toContain('Intentional failure')
  })

  it('persists status="complete" when run() returns { status: "complete" }', async () => {
    const db = makeDb()
    makeSession(db, 'TEST')

    const step = new MockStep(db, fakeLmGateway, fakeMcpGateway, {
      status: 'complete',
      outputArtifacts: [],
    })
    await step.execute({ sessionId: 'TEST', stepTypeKey: stepTypeKey('analysis_bootstrap') })

    const row = db.connection.prepare(
      'SELECT status FROM steps WHERE id = ?',
    ).get(step.stepId) as { status: string } | undefined

    expect(row?.status).toBe('complete')
  })

  it('persists status="error" when run() throws', async () => {
    const db = makeDb()
    makeSession(db, 'TEST')

    // A step that throws instead of returning
    class ThrowingStep extends WorkflowStep {
      readonly stepLabel = 'Throwing Step'
      readonly kind = 'test'
      readonly stepTypeKey: StepTypeKey = stepTypeKey('analysis_bootstrap')
      get semanticId(): string { return '' }
      isComplete(): boolean { return false }
      protected async run(): Promise<StepResult> {
        throw new Error('Runtime crash')
      }
    }

    const step = new ThrowingStep(db, fakeLmGateway, fakeMcpGateway)
    const result = await step.execute({ sessionId: 'TEST', stepTypeKey: stepTypeKey('analysis_bootstrap') })

    expect(result.status).toBe('error')

    const row = db.connection.prepare(
      'SELECT status FROM steps WHERE id = ?',
    ).get(step.stepId) as { status: string } | undefined

    expect(row?.status).toBe('error')
  })
})
