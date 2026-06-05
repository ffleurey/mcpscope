import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import type { BackendDatabase } from '../persistence/db.js'
import { openBackendDatabase } from '../persistence/db.js'
import {
  createSessionRecord,
  getPartRecord,
  insertPartRecord,
  insertRoundRecord,
  insertStepRecord,
  insertTurnRecord,
} from '../persistence/repository.js'
import type { PartRecord, RoundRecord, SessionRecord, TurnRecord } from '../domain/model.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import { runBootstrapStep } from './bootstrapStep.js'
import { getLatestArtifactBySchemaKey, insertJsonArtifact } from './artifactRepository.js'
import { runContextMutationStep } from './fullSession/contextMutationStep.js'
import { runCoverageValidationStep } from './coverageValidationStep.js'
import { runFinalAggregationTurn } from './fullSession/finalAggregationTurn.js'
import { buildRepeatedAttemptGuidance } from './fullSession/turnSummaryTurn.js'
import { SCHEMA_KEY, type AnalysisSessionState, type EvidencePacketIndex } from './schemas.js'
import type { StepPersistenceRecord } from '../domain/persistenceContract.js'

function makeTestDatabase(): BackendDatabase {
  const dataDir = `.tmp-test-data/${crypto.randomUUID()}`
  return openBackendDatabase(`${dataDir}/test.db`)
}

function makeSessionRecord(overrides: Partial<SessionRecord> & Pick<SessionRecord, 'id'>): SessionRecord {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    status: overrides.status ?? 'ready',
    initStatus: overrides.initStatus ?? 'ready',
    sessionType: overrides.sessionType ?? 'primary',
    parentKind: overrides.parentKind ?? null,
    parentId: overrides.parentId ?? null,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    modelProfileSnapshot: overrides.modelProfileSnapshot ?? {
      id: 'model-1',
      name: 'Model 1',
      connectionBaseUrl: 'https://example.invalid/v1',
      apiKey: null,
      modelKey: 'model-1',
      modelDisplayName: 'Model 1',
      systemPrompt: 'Reply exactly.',
      temperature: 0,
      reasoning: 'on',
      createdAt: 1,
      updatedAt: 1,
    },
    mcpProfileSnapshot: overrides.mcpProfileSnapshot ?? null,
    loadedContextLength: overrides.loadedContextLength ?? null,
    systemPromptTokens: overrides.systemPromptTokens ?? null,
    toolDefinitionsTokens: overrides.toolDefinitionsTokens ?? null,
    isContextExhausted: overrides.isContextExhausted ?? false,
    compactionStrategy: overrides.compactionStrategy ?? 'strip-reasoning',
  }
}

function makeTurnRecord(overrides: Partial<TurnRecord> & Pick<TurnRecord, 'id' | 'sessionId' | 'turnNumber'>): TurnRecord {
  return {
    id: overrides.id,
    sessionId: overrides.sessionId,
    ownerStepId: overrides.ownerStepId ?? null,
    turnNumber: overrides.turnNumber,
    status: overrides.status ?? 'complete',
    createdAt: overrides.createdAt ?? 1,
    completedAt: overrides.completedAt ?? 2,
    outcome: overrides.outcome ?? null,
    usage: overrides.usage ?? {
      promptTokens: null,
      completionTokens: null,
      reasoningTokens: null,
      totalTokens: null,
    },
    contextTokensAtTurnEnd: overrides.contextTokensAtTurnEnd ?? null,
    contextTokensAfterCompaction: overrides.contextTokensAfterCompaction ?? null,
    compactionApplied: overrides.compactionApplied ?? null,
    compactionTokensRemoved: overrides.compactionTokensRemoved ?? null,
  }
}

function makeRoundRecord(overrides: Partial<RoundRecord> & Pick<RoundRecord, 'id' | 'turnId' | 'roundIndex'>): RoundRecord {
  return {
    id: overrides.id,
    turnId: overrides.turnId,
    roundIndex: overrides.roundIndex,
    status: overrides.status ?? 'complete',
    finishReason: overrides.finishReason ?? 'stop',
    startedAt: overrides.startedAt ?? 1,
    completedAt: overrides.completedAt ?? 2,
    usage: overrides.usage ?? {
      promptTokens: null,
      completionTokens: null,
      reasoningTokens: null,
      totalTokens: null,
    },
    requestPayloadJson: overrides.requestPayloadJson ?? null,
    responseTraceJson: overrides.responseTraceJson ?? null,
  }
}

function makePartRecord(overrides: Partial<PartRecord> & Pick<PartRecord, 'id' | 'sessionId' | 'ordinal' | 'partType'>): PartRecord {
  return {
    id: overrides.id,
    sessionId: overrides.sessionId,
    turnId: overrides.turnId ?? null,
    roundId: overrides.roundId ?? null,
    parentPartId: overrides.parentPartId ?? null,
    ordinal: overrides.ordinal,
    partType: overrides.partType,
    roleLabel: overrides.roleLabel ?? null,
    payload: overrides.payload ?? {
      text: null,
      json: null,
      mimeType: null,
      summary: null,
    },
    display: overrides.display ?? {
      state: 'transcript',
      collapsedByDefault: false,
    },
    context: overrides.context ?? {
      state: 'included',
      note: null,
      strippedByCompactionAtTurnId: null,
    },
    tokens: overrides.tokens ?? {
      count: null,
      source: 'unknown',
      confidence: 'unknown',
      note: null,
    },
    provenanceJson: overrides.provenanceJson ?? null,
    createdAt: overrides.createdAt ?? overrides.ordinal,
    updatedAt: overrides.updatedAt ?? overrides.ordinal,
  }
}

function makeAnalysisState(overrides: Partial<AnalysisSessionState>): AnalysisSessionState {
  return {
    phase: overrides.phase ?? 'bootstrap',
    bootstrapComplete: overrides.bootstrapComplete ?? false,
    nextPacketIndex: overrides.nextPacketIndex ?? 0,
    packetCount: overrides.packetCount ?? 0,
    currentTurnId: overrides.currentTurnId ?? null,
    coverageValidated: overrides.coverageValidated ?? false,
    finalAggregationComplete: overrides.finalAggregationComplete ?? false,
    analysisSessionId: overrides.analysisSessionId ?? 'ANLY',
    targetSessionId: overrides.targetSessionId ?? 'TARG',
    targetTurnId: overrides.targetTurnId ?? 'TARG.1',
    analysisGoal: overrides.analysisGoal ?? 'Evaluate tool usage.',
    selectedToolNames: overrides.selectedToolNames ?? [],
    onlyFailedToolCalls: overrides.onlyFailedToolCalls ?? false,
    evaluationCriteria: overrides.evaluationCriteria ?? [],
  }
}

function makeStepRecord(overrides: Partial<StepPersistenceRecord> & Pick<StepPersistenceRecord, 'id' | 'sessionId' | 'stepTypeKey' | 'childIndex'>): StepPersistenceRecord {
  return {
    id: overrides.id,
    sessionId: overrides.sessionId,
    stepTypeKey: overrides.stepTypeKey as StepPersistenceRecord['stepTypeKey'],
    parentStepId: null,
    childIndex: overrides.childIndex,
    status: overrides.status ?? 'complete',
    params: overrides.params ?? {},
    state: overrides.state ?? {},
    createdAt: overrides.createdAt ?? 1,
    completedAt: overrides.completedAt ?? 1,
  }
}

const fakeRawExchange = {
  requestUrl: 'http://localhost:3030/mcp/analysis',
  requestMethod: 'POST',
  requestHeaders: {},
  requestBodyText: '{}',
  responseStatus: 200,
  responseHeaders: {},
  responseBodyText: '{}',
  responseBody: {},
}

const bootstrapInspectIds: string[] = []

const fakeMcpGateway: McpGateway = {
  async initializeSession() {
    return { sessionId: 'analysis-session', instructions: 'Inspect only.', rawExchange: fakeRawExchange }
  },
  async listTools() {
    return {
      tools: [{ name: 'mcpscope_inspect', description: 'Inspect', inputSchema: { type: 'object' } }],
      rawResult: {},
      rawExchange: fakeRawExchange,
    }
  },
  async callTool(_serverUrl, _sessionId, name, args) {
    bootstrapInspectIds.push(String(args.id))
    return {
      content: JSON.stringify({ id: args.id, tool: name }),
      structuredContent: { id: args.id, tool: name },
      isError: false,
      rawResult: {},
      rawExchange: fakeRawExchange,
    }
  },
}

describe('analysis workflow helpers', () => {
  let db: BackendDatabase | undefined

  afterEach(() => {
    if (!db) return
    const dataDir = db.path.split('/').slice(0, -1).join('/')
    db.connection.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
    bootstrapInspectIds.length = 0
    db = undefined
  })

  it('bootstrap indexes tool-call packets with reasoning before and cross-round reasoning after', async () => {
    db = makeTestDatabase()

    createSessionRecord(db.connection, makeSessionRecord({ id: 'TARG', sessionType: 'primary' }))
    createSessionRecord(db.connection, makeSessionRecord({
      id: 'ANLY',
      sessionType: 'session_analysis',
      parentKind: 'session',
      parentId: 'TARG',
      mcpProfileSnapshot: {
        id: 'analysis-mcp',
        name: 'mcpscope-analysis',
        url: 'http://localhost:3030/mcp/analysis',
        transport: 'streamable-http',
        authType: null,
        authValue: null,
        createdAt: 1,
        updatedAt: 1,
      },
    }))
    insertStepRecord(db.connection, makeStepRecord({
      id: 'ANLY.step.bootstrap',
      sessionId: 'ANLY',
      stepTypeKey: 'analysis_v2_cursor' as StepPersistenceRecord['stepTypeKey'],
      childIndex: 0,
    }))

    insertPartRecord(db.connection, makePartRecord({
      id: 'TARG.S.1-MI',
      sessionId: 'TARG',
      ordinal: 1,
      partType: 'mcp-instructions',
      payload: { text: 'Inspect tools.', json: null, mimeType: 'text/plain', summary: null },
    }))
    insertPartRecord(db.connection, makePartRecord({
      id: 'TARG.S.2-TD',
      sessionId: 'TARG',
      ordinal: 2,
      partType: 'tool-definitions',
      payload: { text: null, json: { tools: ['weather_get'] }, mimeType: 'application/json', summary: null },
    }))

    insertTurnRecord(db.connection, makeTurnRecord({ id: 'TARG.1', sessionId: 'TARG', turnNumber: 1 }))
    insertRoundRecord(db.connection, makeRoundRecord({ id: 'TARG.1.1', turnId: 'TARG.1', roundIndex: 0, finishReason: 'tool_calls' }))
    insertRoundRecord(db.connection, makeRoundRecord({ id: 'TARG.1.2', turnId: 'TARG.1', roundIndex: 1 }))

    insertPartRecord(db.connection, makePartRecord({
      id: 'TARG.1.1.1-U',
      sessionId: 'TARG',
      turnId: 'TARG.1',
      roundId: 'TARG.1.1',
      ordinal: 1,
      partType: 'user-message',
      roleLabel: 'user',
      payload: { text: 'What is the weather?', json: null, mimeType: 'text/plain', summary: null },
    }))
    insertPartRecord(db.connection, makePartRecord({
      id: 'TARG.1.1.2-R',
      sessionId: 'TARG',
      turnId: 'TARG.1',
      roundId: 'TARG.1.1',
      ordinal: 2,
      partType: 'assistant-reasoning',
      roleLabel: 'assistant',
      payload: { text: 'I should call the tool.', json: null, mimeType: 'text/plain', summary: null },
    }))
    insertPartRecord(db.connection, makePartRecord({
      id: 'TARG.1.1.3-T',
      sessionId: 'TARG',
      turnId: 'TARG.1',
      roundId: 'TARG.1.1',
      ordinal: 3,
      partType: 'tool-call',
      roleLabel: 'assistant',
      payload: { text: null, json: { id: 'call-1', name: 'weather_get', arguments: '{}' }, mimeType: 'application/json', summary: null },
    }))
    insertPartRecord(db.connection, makePartRecord({
      id: 'TARG.1.1.4-TR',
      sessionId: 'TARG',
      turnId: 'TARG.1',
      roundId: 'TARG.1.1',
      ordinal: 4,
      partType: 'tool-result',
      roleLabel: 'tool',
      payload: { text: null, json: { tool_call_id: 'call-1', temperature_c: 21 }, mimeType: 'application/json', summary: null },
    }))
    insertPartRecord(db.connection, makePartRecord({
      id: 'TARG.1.2.5-R',
      sessionId: 'TARG',
      turnId: 'TARG.1',
      roundId: 'TARG.1.2',
      ordinal: 5,
      partType: 'assistant-reasoning',
      roleLabel: 'assistant',
      payload: { text: 'The result answers the question.', json: null, mimeType: 'text/plain', summary: null },
    }))

    const result = await runBootstrapStep(db, fakeMcpGateway, {
      state: makeAnalysisState({ analysisSessionId: 'ANLY', targetSessionId: 'TARG', targetTurnId: 'TARG.1' }),
      stepId: 'ANLY.step.bootstrap',
    })

    expect(result.packetCount).toBe(1)
    const packetIndexArtifact = getLatestArtifactBySchemaKey(db.connection, 'ANLY', SCHEMA_KEY.EVIDENCE_PACKET_INDEX)
    const packetIndex = packetIndexArtifact?.content as EvidencePacketIndex
    expect(packetIndex.packets).toHaveLength(1)
    expect(packetIndex.packets[0]).toMatchObject({
      tool_call_part_id: 'TARG.1.1.3-T',
      reasoning_before_part_id: 'TARG.1.1.2-R',
      reasoning_after_part_id: 'TARG.1.2.5-R',
    })
    expect(bootstrapInspectIds).toEqual(['TARG', 'TARG.S.1-MI', 'TARG.S.2-TD'])
  })

  it('bootstrap filters packets by selected tool names and failed-only mode', async () => {
    db = makeTestDatabase()

    createSessionRecord(db.connection, makeSessionRecord({ id: 'TARG', sessionType: 'primary' }))
    createSessionRecord(db.connection, makeSessionRecord({
      id: 'ANLY',
      sessionType: 'session_analysis',
      parentKind: 'session',
      parentId: 'TARG',
      mcpProfileSnapshot: {
        id: 'analysis-mcp',
        name: 'mcpscope-analysis',
        url: 'http://localhost:3030/mcp/analysis',
        transport: 'streamable-http',
        authType: null,
        authValue: null,
        createdAt: 1,
        updatedAt: 1,
      },
    }))
    insertStepRecord(db.connection, makeStepRecord({
      id: 'ANLY.step.bootstrap',
      sessionId: 'ANLY',
      stepTypeKey: 'analysis_v2_cursor' as StepPersistenceRecord['stepTypeKey'],
      childIndex: 0,
    }))

    insertTurnRecord(db.connection, makeTurnRecord({ id: 'TARG.1', sessionId: 'TARG', turnNumber: 1 }))
    insertRoundRecord(db.connection, makeRoundRecord({ id: 'TARG.1.1', turnId: 'TARG.1', roundIndex: 0, finishReason: 'tool_calls' }))

    insertPartRecord(db.connection, makePartRecord({
      id: 'TARG.1.1.1-T',
      sessionId: 'TARG',
      turnId: 'TARG.1',
      roundId: 'TARG.1.1',
      ordinal: 1,
      partType: 'tool-call',
      roleLabel: 'assistant',
      payload: { text: null, json: { id: 'call-1', name: 'weather_get', arguments: '{}' }, mimeType: 'application/json', summary: null },
    }))
    insertPartRecord(db.connection, makePartRecord({
      id: 'TARG.1.1.2-TR',
      sessionId: 'TARG',
      turnId: 'TARG.1',
      roundId: 'TARG.1.1',
      ordinal: 2,
      partType: 'tool-result',
      roleLabel: 'tool',
      payload: { text: null, json: { tool_call_id: 'call-1', ok: true }, mimeType: 'application/json', summary: null },
      provenanceJson: { isError: false },
    }))
    insertPartRecord(db.connection, makePartRecord({
      id: 'TARG.1.1.3-T',
      sessionId: 'TARG',
      turnId: 'TARG.1',
      roundId: 'TARG.1.1',
      ordinal: 3,
      partType: 'tool-call',
      roleLabel: 'assistant',
      payload: { text: null, json: { id: 'call-2', name: 'calendar_lookup', arguments: '{}' }, mimeType: 'application/json', summary: null },
    }))
    insertPartRecord(db.connection, makePartRecord({
      id: 'TARG.1.1.4-TR',
      sessionId: 'TARG',
      turnId: 'TARG.1',
      roundId: 'TARG.1.1',
      ordinal: 4,
      partType: 'tool-result',
      roleLabel: 'tool',
      payload: { text: null, json: { tool_call_id: 'call-2', error: 'boom' }, mimeType: 'application/json', summary: null },
      provenanceJson: { isError: true },
    }))

    const result = await runBootstrapStep(db, fakeMcpGateway, {
      state: makeAnalysisState({
        analysisSessionId: 'ANLY',
        targetSessionId: 'TARG',
        targetTurnId: 'TARG.1',
        selectedToolNames: ['calendar_lookup'],
        onlyFailedToolCalls: true,
        evaluationCriteria: ['Focus on actual runtime failures'],
      }),
      stepId: 'ANLY.step.bootstrap',
    })

    expect(result.packetCount).toBe(1)
    const packetIndexArtifact = getLatestArtifactBySchemaKey(db.connection, 'ANLY', SCHEMA_KEY.EVIDENCE_PACKET_INDEX)
    const packetIndex = packetIndexArtifact?.content as EvidencePacketIndex
    expect(packetIndex.packets).toHaveLength(1)
    expect(packetIndex.packets[0]?.tool_call_part_id).toBe('TARG.1.1.3-T')

    const targetArtifact = getLatestArtifactBySchemaKey(db.connection, 'ANLY', SCHEMA_KEY.ANALYSIS_TARGET)
    expect(targetArtifact?.content).toMatchObject({
      selected_tool_names: ['calendar_lookup'],
      only_failed_tool_calls: true,
      evaluation_criteria: ['Focus on actual runtime failures'],
    })
  })

  it('context mutation excludes packet-local evidence and transitions to turn_summary at a turn boundary', () => {
    db = makeTestDatabase()

    createSessionRecord(db.connection, makeSessionRecord({
      id: 'ANLY',
      sessionType: 'session_analysis',
      parentKind: 'session',
      parentId: 'TARG',
      mcpProfileSnapshot: {
        id: 'analysis-mcp',
        name: 'mcpscope-analysis',
        url: 'http://localhost:3030/mcp/analysis',
        transport: 'streamable-http',
        authType: null,
        authValue: null,
        createdAt: 1,
        updatedAt: 1,
      },
    }))
    insertTurnRecord(db.connection, makeTurnRecord({ id: 'ANLY.1', sessionId: 'ANLY', turnNumber: 1 }))
    insertRoundRecord(db.connection, makeRoundRecord({ id: 'ANLY.1.1', turnId: 'ANLY.1', roundIndex: 0 }))
    insertTurnRecord(db.connection, makeTurnRecord({ id: 'ANLY.2', sessionId: 'ANLY', turnNumber: 2 }))
    insertRoundRecord(db.connection, makeRoundRecord({ id: 'ANLY.2.1', turnId: 'ANLY.2', roundIndex: 0 }))
    insertPartRecord(db.connection, makePartRecord({ id: 'ANLY.2.1.1-U', sessionId: 'ANLY', turnId: 'ANLY.2', roundId: 'ANLY.2.1', ordinal: 1, partType: 'user-message' }))
    insertPartRecord(db.connection, makePartRecord({ id: 'INJECT-1', sessionId: 'ANLY', turnId: 'ANLY.1', roundId: 'ANLY.1.1', ordinal: 2, partType: 'tool-call' }))
    insertPartRecord(db.connection, makePartRecord({ id: 'REASON-1', sessionId: 'ANLY', turnId: 'ANLY.2', roundId: 'ANLY.2.1', ordinal: 3, partType: 'assistant-reasoning' }))

    insertJsonArtifact(db.connection, {
      id: 'artifact-packets',
      sessionId: 'ANLY',
      stepId: 'ANLY.2',
      content: {
        packets: [
          { turn_id: 'TURN-1', round_id: 'TURN-1.1', tool_call_part_id: 'TC-1', tool_name: 'test_tool', reasoning_before_part_id: null, tool_result_part_id: null, reasoning_after_part_id: null },
          { turn_id: 'TURN-2', round_id: 'TURN-2.1', tool_call_part_id: 'TC-2', tool_name: 'test_tool', reasoning_before_part_id: null, tool_result_part_id: null, reasoning_after_part_id: null },
        ],
      },
      metadata: { schema_key: SCHEMA_KEY.EVIDENCE_PACKET_INDEX },
      createdAt: 1,
    })

    const result = runContextMutationStep(db, {
      analysisSessionId: 'ANLY',
      currentTurnId: 'TURN-1',
      nextPacketIndex: 1,
      userTurnId: 'ANLY.2',
      injectPartIds: ['INJECT-1'],
      reasoningPartIds: ['REASON-1'],
    })

    expect(getPartRecord(db.connection, 'INJECT-1')?.context.state).toBe('excluded')
    expect(getPartRecord(db.connection, 'REASON-1')?.context.state).toBe('excluded')
    expect(getPartRecord(db.connection, 'ANLY.2.1.1-U')?.context.state).toBe('historical-only')
    expect(result.nextPhase).toBe('turn_summary')
  })

  it('coverage validation derives completion from tool call ids plus accepted assessments', () => {
    db = makeTestDatabase()

    createSessionRecord(db.connection, makeSessionRecord({ id: 'ANLY', sessionType: 'session_analysis', parentKind: 'session', parentId: 'TARG' }))
    insertStepRecord(db.connection, makeStepRecord({ id: 'step-1', sessionId: 'ANLY', stepTypeKey: 'analysis_v2_cursor' as StepPersistenceRecord['stepTypeKey'], childIndex: 0 }))
    insertStepRecord(db.connection, makeStepRecord({ id: 'step-2', sessionId: 'ANLY', stepTypeKey: 'analysis_v2_cursor' as StepPersistenceRecord['stepTypeKey'], childIndex: 1 }))
    insertStepRecord(db.connection, makeStepRecord({ id: 'step-3', sessionId: 'ANLY', stepTypeKey: 'analysis_v2_cursor' as StepPersistenceRecord['stepTypeKey'], childIndex: 2 }))
    insertJsonArtifact(db.connection, {
      id: 'artifact-packets',
      sessionId: 'ANLY',
      stepId: 'step-1',
      content: {
        packets: [
          { turn_id: 'TURN-1', round_id: 'TURN-1.1', tool_call_part_id: 'TC-1', tool_name: 'test_tool', reasoning_before_part_id: null, tool_result_part_id: null, reasoning_after_part_id: null },
        ],
      },
      metadata: { schema_key: SCHEMA_KEY.EVIDENCE_PACKET_INDEX },
      createdAt: 1,
    })
    insertJsonArtifact(db.connection, {
      id: 'artifact-assessment',
      sessionId: 'ANLY',
      stepId: 'step-2',
      content: { ok: true },
      metadata: { schema_key: SCHEMA_KEY.TOOL_CALL_ASSESSMENT, tool_call_part_id: 'TC-1' },
      createdAt: 2,
    })

    const result = runCoverageValidationStep(db, {
      state: makeAnalysisState({ analysisSessionId: 'ANLY', phase: 'coverage_validation' }),
      stepId: 'step-3',
    })

    expect(result.passed).toBe(true)
    expect(result.updatedState.phase).toBe('final_aggregation')
    expect(result.updatedState.coverageValidated).toBe(true)
  })

  it('final aggregation still uses the LLM when multiple turn summaries need consolidation', async () => {
    db = makeTestDatabase()

    createSessionRecord(db.connection, makeSessionRecord({
      id: 'ANLY',
      sessionType: 'session_analysis',
      parentKind: 'session',
      parentId: 'TARG',
      mcpProfileSnapshot: {
        id: 'analysis-mcp',
        name: 'mcpscope-analysis',
        url: 'http://localhost:3030/mcp/analysis',
        transport: 'streamable-http',
        authType: null,
        authValue: null,
        createdAt: 1,
        updatedAt: 1,
      },
    }))
    insertStepRecord(db.connection, makeStepRecord({
      id: 'step-final',
      sessionId: 'ANLY',
      stepTypeKey: 'analysis_final_aggregation' as StepPersistenceRecord['stepTypeKey'],
      childIndex: 0,
      status: 'running',
    }))
    insertJsonArtifact(db.connection, {
      id: 'artifact-target',
      sessionId: 'ANLY',
      stepId: null,
      content: {
        target_session_id: 'TARG',
        target_turn_id: 'TARG.2',
        analysis_goal: 'Evaluate tool usage.',
        selected_tool_names: [],
        only_failed_tool_calls: false,
        evaluation_criteria: [],
        analyzed_turn_ids: ['TURN-1', 'TURN-2'],
        target_mcp_instructions_part_id: null,
        target_tool_definitions_part_id: null,
        user_request_part_id: null,
        final_answer_part_id: null,
      },
      metadata: { schema_key: SCHEMA_KEY.ANALYSIS_TARGET },
      createdAt: 1,
    })
    insertJsonArtifact(db.connection, {
      id: 'assessment-1',
      sessionId: 'ANLY',
      stepId: null,
      content: {
        turn_id: 'TURN-1',
        round_id: 'TURN-1.1',
        tool_call_part_id: 'TC-1',
        tool_name: 'test_tool',
        expectation_match: 'mismatch',
        tool_call_assessment: 'The tool call failed because the payload shape had to be corrected before success.',
        most_direct_cause: 'wrong_parameters',
        parameter_or_call_issues: ['aggregation changed from array to scalar before success'],
        post_call_assessment: null,
      },
      metadata: { schema_key: SCHEMA_KEY.TOOL_CALL_ASSESSMENT, turn_id: 'TURN-1', tool_call_part_id: 'TC-1' },
      createdAt: 2,
    })
    insertJsonArtifact(db.connection, {
      id: 'assessment-2',
      sessionId: 'ANLY',
      stepId: null,
      content: {
        turn_id: 'TURN-2',
        round_id: 'TURN-2.1',
        tool_call_part_id: 'TC-2',
        tool_name: 'test_tool',
        expectation_match: 'match',
        tool_call_assessment: 'The tool call correctly requested the needed values.',
        most_direct_cause: null,
        parameter_or_call_issues: [],
        post_call_assessment: null,
      },
      metadata: { schema_key: SCHEMA_KEY.TOOL_CALL_ASSESSMENT, turn_id: 'TURN-2', tool_call_part_id: 'TC-2' },
      createdAt: 3,
    })
    insertJsonArtifact(db.connection, {
      id: 'summary-1',
      sessionId: 'ANLY',
      stepId: null,
      content: {
        turn_id: 'TURN-1',
        total_tool_calls_assessed: 1,
        turn_outcome: 'successful',
        turn_outcome_rationale: 'The turn answered the user request after a corrected retry path.',
        per_tool_findings: [{ tool_call_part_id: 'TC-1', tool_name: 'test_tool', brief_finding: 'The payload shape had to be corrected before success.' }],
        cross_attempt_reconciliation: 'The first turn only succeeded after correcting the payload shape from an array to a scalar value.',
      },
      metadata: { schema_key: SCHEMA_KEY.TURN_SUMMARY, turn_id: 'TURN-1' },
      createdAt: 4,
    })
    insertJsonArtifact(db.connection, {
      id: 'summary-2',
      sessionId: 'ANLY',
      stepId: null,
      content: {
        turn_id: 'TURN-2',
        total_tool_calls_assessed: 1,
        turn_outcome: 'successful',
        turn_outcome_rationale: 'The second turn was a clean success.',
        per_tool_findings: [{ tool_call_part_id: 'TC-2', tool_name: 'test_tool', brief_finding: 'The follow-up turn correctly requested the needed values.' }],
        cross_attempt_reconciliation: null,
      },
      metadata: { schema_key: SCHEMA_KEY.TURN_SUMMARY, turn_id: 'TURN-2' },
      createdAt: 5,
    })

    let callCount = 0
    const lmGateway: LmStudioGateway = {
      async createChatCompletion() {
        callCount += 1
        return {
          id: 'cmpl-final',
          object: 'chat.completion',
          created: Date.now(),
          model: 'test-model',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                outcome: 'answered',
                outcome_rationale: 'The workflow answered the request after consolidating both analyzed turns.',
                primary_issue: 'wrong_parameters',
                primary_issue_rationale: 'The first turn required correcting the payload shape before succeeding.',
                path_efficiency: 'mixed',
                path_efficiency_rationale: 'The workflow succeeded, but one turn required a corrective retry path.',
                findings: ['The first turn required correcting the payload shape before success.', 'The second turn was a clean success.'],
                tool_description_findings: [],
                improvement_suggestions: [],
                tool_description_improvement_suggestions: [],
                total_tool_calls_assessed: 2,
              }),
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }
      },
      async probePromptTokensDetailed(_baseUrl: string, _apiKey: string | undefined, body: Record<string, unknown>) {
        const messages = (body.messages as unknown[]) ?? []
        const promptTokens = messages.length * 5
        return {
          promptTokens,
          completion: {
            id: 'probe-test',
            object: 'chat.completion',
            created: Date.now(),
            model: 'test-model',
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '' } }],
            usage: { prompt_tokens: promptTokens, completion_tokens: 1, total_tokens: promptTokens + 1 },
          },
          rawExchange: {
            requestUrl: 'https://example.com/v1/chat/completions',
            requestMethod: 'POST',
            requestHeadersJson: {},
            requestBody: JSON.stringify(body),
            responseStatus: 200,
            responseHeadersJson: {},
            responseBody: '{}',
          },
        }
      },
    }

    const result = await runFinalAggregationTurn(db, lmGateway, fakeMcpGateway, {
      state: makeAnalysisState({
        analysisSessionId: 'ANLY',
        targetSessionId: 'TARG',
        targetTurnId: 'TARG.2',
        phase: 'final_aggregation',
      }),
      stepId: 'step-final',
    })

    expect(result.success).toBe(true)
    expect(callCount).toBe(1)

    const finalArtifact = getLatestArtifactBySchemaKey(db.connection, 'ANLY', SCHEMA_KEY.FINAL_ANALYSIS_REPORT)
    expect(finalArtifact?.metadata['synthesis_mode']).toBeUndefined()
    expect(finalArtifact?.content).toMatchObject({
      outcome: 'answered',
      primary_issue: 'wrong_parameters',
      total_tool_calls_assessed: 2,
    })
  })

  it('final aggregation fills total_tool_calls_assessed deterministically when omitted by the model', async () => {
    db = makeTestDatabase()

    createSessionRecord(db.connection, makeSessionRecord({ id: 'TARG' }))
    createSessionRecord(db.connection, makeSessionRecord({
      id: 'ANLY',
      sessionType: 'session_analysis',
      parentKind: 'session',
      parentId: 'TARG',
      mcpProfileSnapshot: {
        id: 'analysis-mcp',
        name: 'analysis-mcp',
        url: 'http://localhost:3030/mcp/analysis',
        transport: 'streamable-http',
        authType: null,
        authValue: null,
        createdAt: 1,
        updatedAt: 1,
      },
    }))
    insertStepRecord(db.connection, makeStepRecord({
      id: 'step-final',
      sessionId: 'ANLY',
      stepTypeKey: 'analysis_final_aggregation' as StepPersistenceRecord['stepTypeKey'],
      childIndex: 0,
      status: 'running',
    }))

    insertJsonArtifact(db.connection, {
      id: 'target',
      sessionId: 'ANLY',
      stepId: null,
      content: {
        target_session_id: 'TARG',
        target_turn_id: 'TURN-2',
        analysis_goal: 'Evaluate tool usage.',
        selected_tool_names: [],
        only_failed_tool_calls: false,
        evaluation_criteria: [],
        analyzed_turn_ids: ['TURN-1', 'TURN-2'],
        target_mcp_instructions_part_id: null,
        target_tool_definitions_part_id: null,
        user_request_part_id: null,
        final_answer_part_id: null,
      },
      metadata: { schema_key: SCHEMA_KEY.ANALYSIS_TARGET },
      createdAt: 1,
    })
    insertJsonArtifact(db.connection, {
      id: 'assessment-1',
      sessionId: 'ANLY',
      stepId: null,
      content: {
        turn_id: 'TURN-1',
        round_id: 'TURN-1.1',
        tool_call_part_id: 'TC-1',
        tool_name: 'test_tool',
        expectation_match: 'match',
        tool_call_assessment: 'The tool call correctly requested the needed values.',
        most_direct_cause: null,
        parameter_or_call_issues: [],
        post_call_assessment: null,
      },
      metadata: { schema_key: SCHEMA_KEY.TOOL_CALL_ASSESSMENT, turn_id: 'TURN-1', tool_call_part_id: 'TC-1' },
      createdAt: 2,
    })
    insertJsonArtifact(db.connection, {
      id: 'assessment-2',
      sessionId: 'ANLY',
      stepId: null,
      content: {
        turn_id: 'TURN-2',
        round_id: 'TURN-2.1',
        tool_call_part_id: 'TC-2',
        tool_name: 'test_tool',
        expectation_match: 'match',
        tool_call_assessment: 'The tool call correctly requested the needed values.',
        most_direct_cause: null,
        parameter_or_call_issues: [],
        post_call_assessment: null,
      },
      metadata: { schema_key: SCHEMA_KEY.TOOL_CALL_ASSESSMENT, turn_id: 'TURN-2', tool_call_part_id: 'TC-2' },
      createdAt: 3,
    })
    insertJsonArtifact(db.connection, {
      id: 'summary-1',
      sessionId: 'ANLY',
      stepId: null,
      content: {
        turn_id: 'TURN-1',
        total_tool_calls_assessed: 1,
        turn_outcome: 'successful',
        turn_outcome_rationale: 'The first turn succeeded.',
        per_tool_findings: [{ tool_call_part_id: 'TC-1', tool_name: 'test_tool', brief_finding: 'The first turn was a clean success.' }],
        cross_attempt_reconciliation: null,
      },
      metadata: { schema_key: SCHEMA_KEY.TURN_SUMMARY, turn_id: 'TURN-1' },
      createdAt: 4,
    })
    insertJsonArtifact(db.connection, {
      id: 'summary-2',
      sessionId: 'ANLY',
      stepId: null,
      content: {
        turn_id: 'TURN-2',
        total_tool_calls_assessed: 1,
        turn_outcome: 'successful',
        turn_outcome_rationale: 'The second turn succeeded.',
        per_tool_findings: [{ tool_call_part_id: 'TC-2', tool_name: 'test_tool', brief_finding: 'The second turn was a clean success.' }],
        cross_attempt_reconciliation: null,
      },
      metadata: { schema_key: SCHEMA_KEY.TURN_SUMMARY, turn_id: 'TURN-2' },
      createdAt: 5,
    })

    const lmGateway: LmStudioGateway = {
      async createChatCompletion() {
        return {
          id: 'cmpl-final-omitted-total',
          object: 'chat.completion',
          created: Date.now(),
          model: 'test-model',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                outcome: 'answered',
                outcome_rationale: 'The workflow answered the request after consolidating both analyzed turns.',
                primary_issue: 'none',
                primary_issue_rationale: null,
                path_efficiency: 'efficient',
                path_efficiency_rationale: 'The workflow succeeded without corrective retries.',
                findings: ['The first turn was a clean success.', 'The second turn was a clean success.'],
                tool_description_findings: [],
                improvement_suggestions: [],
                tool_description_improvement_suggestions: [],
              }),
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }
      },
      async probePromptTokensDetailed(_baseUrl: string, _apiKey: string | undefined, body: Record<string, unknown>) {
        const messages = (body.messages as unknown[]) ?? []
        const promptTokens = messages.length * 5
        return {
          promptTokens,
          completion: {
            id: 'probe-test',
            object: 'chat.completion',
            created: Date.now(),
            model: 'test-model',
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '' } }],
            usage: { prompt_tokens: promptTokens, completion_tokens: 1, total_tokens: promptTokens + 1 },
          },
          rawExchange: {
            requestUrl: 'https://example.com/v1/chat/completions',
            requestMethod: 'POST',
            requestHeadersJson: {},
            requestBody: JSON.stringify(body),
            responseStatus: 200,
            responseHeadersJson: {},
            responseBody: '{}',
          },
        }
      },
    }

    const result = await runFinalAggregationTurn(db, lmGateway, fakeMcpGateway, {
      state: makeAnalysisState({
        analysisSessionId: 'ANLY',
        targetSessionId: 'TARG',
        targetTurnId: 'TURN-2',
        phase: 'final_aggregation',
      }),
      stepId: 'step-final',
    })

    expect(result.success).toBe(true)

    const finalArtifact = getLatestArtifactBySchemaKey(db.connection, 'ANLY', SCHEMA_KEY.FINAL_ANALYSIS_REPORT)
    expect(finalArtifact?.content).toMatchObject({
      outcome: 'answered',
      primary_issue: 'none',
      total_tool_calls_assessed: 2,
    })
  })

  it('repeated-attempt guidance avoids raw quoted JSON snippets', () => {
    db = makeTestDatabase()

    createSessionRecord(db.connection, makeSessionRecord({ id: 'TARG' }))
    insertTurnRecord(db.connection, makeTurnRecord({ id: 'TARG.1', sessionId: 'TARG', turnNumber: 1 }))
    insertRoundRecord(db.connection, makeRoundRecord({ id: 'TARG.1.1', turnId: 'TARG.1', roundIndex: 0 }))
    insertRoundRecord(db.connection, makeRoundRecord({ id: 'TARG.1.2', turnId: 'TARG.1', roundIndex: 1 }))

    insertPartRecord(db.connection, makePartRecord({
      id: 'TARG.1.1.1-T',
      sessionId: 'TARG',
      turnId: 'TARG.1',
      roundId: 'TARG.1.1',
      ordinal: 1,
      partType: 'tool-call',
      payload: {
        text: null,
        json: { arguments: JSON.stringify({ aggregation: ['max'], interval: 'day' }) },
        mimeType: null,
        summary: null,
      },
    }))
    insertPartRecord(db.connection, makePartRecord({
      id: 'TARG.1.1.2-TR',
      sessionId: 'TARG',
      turnId: 'TARG.1',
      roundId: 'TARG.1.1',
      ordinal: 2,
      partType: 'tool-result',
    }))
    insertPartRecord(db.connection, makePartRecord({
      id: 'TARG.1.2.1-T',
      sessionId: 'TARG',
      turnId: 'TARG.1',
      roundId: 'TARG.1.2',
      ordinal: 2,
      partType: 'tool-call',
      payload: {
        text: null,
        json: { arguments: JSON.stringify({ aggregation: 'max', interval: 'day' }) },
        mimeType: null,
        summary: null,
      },
    }))
    insertPartRecord(db.connection, makePartRecord({
      id: 'TARG.1.2.2-TR',
      sessionId: 'TARG',
      turnId: 'TARG.1',
      roundId: 'TARG.1.2',
      ordinal: 4,
      partType: 'tool-result',
    }))

    const guidance = buildRepeatedAttemptGuidance(db, [
      {
        turn_id: 'TARG.1',
        round_id: 'TARG.1.1',
        tool_call_part_id: 'TARG.1.1.1-T',
        tool_name: 'ha_history_get_sensor_stats',
        tool_call_parameters: '{"entity_ids":["sensor.temperature"],"interval":"hour"}',
        reasoning_before_part_id: null,
        tool_result_part_id: 'TARG.1.1.2-TR',
        reasoning_after_part_id: null,
      },
      {
        turn_id: 'TARG.1',
        round_id: 'TARG.1.2',
        tool_call_part_id: 'TARG.1.2.1-T',
        tool_name: 'ha_history_get_sensor_stats',
        tool_call_parameters: '{"entity_ids":["sensor.temperature"],"interval":"hour"}',
        reasoning_before_part_id: null,
        tool_result_part_id: 'TARG.1.2.2-TR',
        reasoning_after_part_id: null,
      },
    ])

    expect(guidance).toContain('aggregation: array(string(max)) -> string(max)')
    expect(guidance).not.toContain('["max"]')
    expect(guidance).not.toContain('"max"')
  })
})
