import { describe, expect, it } from 'vitest'
import type { PartRecord, SessionRecord } from './backendTypes'
import {
  applyStreamingDelta,
  clearRoundStreamingState,
  clearCommittedStreamingDelta,
  createEmptyTrace,
  createTurnStreamingState,
  insertStreamingUserPart,
  type TurnStreamingState,
  upsertPart,
} from './traceStreaming'

function makeSession(): SessionRecord {
  return {
    id: 'session-1',
    title: 'Session',
    status: 'ready',
    initStatus: 'ready',
    createdAt: 1,
    updatedAt: 1,
    modelProfileSnapshot: {
      id: 'model-1',
      name: 'Model',
      connectionBaseUrl: 'http://localhost:1234/v1',
      apiKey: null,
      modelKey: 'model-key',
      modelDisplayName: 'Model',
      systemPrompt: 'Reply helpfully.',
      temperature: 0.7,
      reasoning: 'on',
      createdAt: 1,
      updatedAt: 1,
    },
    mcpProfileSnapshot: null,
    loadedContextLength: null,
    systemPromptTokens: null,
    toolDefinitionsTokens: null,
    isContextExhausted: false,
  }
}

function makePart(overrides: Partial<PartRecord>): PartRecord {
  return {
    id: 'part-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    roundId: 'round-1',
    parentPartId: null,
    ordinal: 1,
    partType: 'assistant-content',
    roleLabel: 'assistant',
    payload: {
      text: 'Done',
      json: null,
      mimeType: null,
      summary: null,
    },
    display: {
      state: 'transcript',
      collapsedByDefault: false,
    },
    context: {
      state: 'included',
      note: null,
    },
    tokens: {
      count: null,
      source: 'unknown',
      confidence: 'unknown',
      note: null,
    },
    provenanceJson: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('traceStreaming', () => {
  it('injects a synthetic streaming user part into transcript and context', () => {
    const trace = insertStreamingUserPart(createEmptyTrace(makeSession()), {
      turnId: 'turn-1',
      roundId: 'round-1',
      userContent: 'Hello there',
      createdAt: 10,
    })

    expect(trace.parts).toHaveLength(1)
    expect(trace.parts[0]?.partType).toBe('user-message')
    expect(trace.transcript[0]?.text).toBe('Hello there')
    expect(trace.context[0]?.text).toBe('Hello there')
  })

  it('accumulates streaming deltas and clears them when committed parts arrive', () => {
    let state: TurnStreamingState | null = createTurnStreamingState('session-1', 'Hello')
    state = applyStreamingDelta(state, 'turn-1', 'round-1', {
      kind: 'reasoning',
      textDelta: 'Think',
    })
    const firstRoundRef = state?.rounds[0] ?? null
    state = applyStreamingDelta(state, 'turn-1', 'round-1', {
      kind: 'content',
      textDelta: 'Answer',
    })
    expect(state?.rounds[0]).not.toBe(firstRoundRef)
    expect(state?.rounds[0]?.reasoningText).toBe('')
    expect(state?.rounds[0]?.completedReasoningText).toBe('Think')
    state = applyStreamingDelta(state, 'turn-1', 'round-1', {
      kind: 'tool-call',
      toolCallIndex: 0,
      nameDelta: 'search',
      argumentsDelta: '{"q":"x"}',
    })

    expect(state?.rounds[0]?.contentText).toBe('Answer')
    expect(state?.rounds[0]?.toolCalls[0]?.name).toBe('search')

    state = clearCommittedStreamingDelta(state, makePart({
      id: 'reasoning-1',
      partType: 'assistant-reasoning',
      payload: { text: 'Think', json: null, mimeType: null, summary: null },
      roleLabel: 'assistant',
    }))
    expect(state?.rounds[0]?.reasoningText).toBe('')
    expect(state?.rounds[0]?.completedReasoningText).toBe('')

    state = clearCommittedStreamingDelta(state, makePart({
      id: 'tool-call-1',
      partType: 'tool-call',
      roleLabel: 'assistant',
      payload: { text: null, json: { name: 'search' }, mimeType: 'application/json', summary: 'search' },
    }))
    expect(state?.rounds[0]?.toolCalls).toHaveLength(0)

    state = clearCommittedStreamingDelta(state, makePart({
      id: 'content-1',
      partType: 'assistant-content',
      payload: { text: 'Answer', json: null, mimeType: null, summary: null },
      roleLabel: 'assistant',
    }))
    expect(state?.rounds).toHaveLength(0)
  })

  it('clears live reasoning when tool activity starts', () => {
    let state: TurnStreamingState | null = createTurnStreamingState('session-1', 'Hello')

    state = applyStreamingDelta(state, 'turn-1', 'round-1', {
      kind: 'reasoning',
      textDelta: 'Plan',
    })
    state = applyStreamingDelta(state, 'turn-1', 'round-1', {
      kind: 'tool-call',
      toolCallIndex: 0,
      nameDelta: 'search',
      argumentsDelta: '{"q":"x"}',
    })

    expect(state?.rounds[0]?.reasoningText).toBe('')
    expect(state?.rounds[0]?.completedReasoningText).toBe('Plan')
    expect(state?.rounds[0]?.toolCalls[0]?.name).toBe('search')
  })

  it('drops transient round state when the round is committed', () => {
    let state: TurnStreamingState | null = createTurnStreamingState('session-1', 'Hello')

    state = applyStreamingDelta(state, 'turn-1', 'round-1', {
      kind: 'content',
      textDelta: '\n\n',
    })
    state = applyStreamingDelta(state, 'turn-1', 'round-2', {
      kind: 'reasoning',
      textDelta: 'Next step',
    })

    state = clearRoundStreamingState(state, 'round-1')

    expect(state?.rounds).toHaveLength(1)
    expect(state?.rounds[0]?.roundId).toBe('round-2')
  })

  it('recomputes transcript and context when committed parts are added', () => {
    const trace = upsertPart(createEmptyTrace(makeSession()), makePart({
      id: 'assistant-1',
      payload: { text: 'Hello', json: null, mimeType: null, summary: null },
    }))

    expect(trace.transcript).toHaveLength(1)
    expect(trace.context).toHaveLength(1)
    expect(trace.transcript[0]?.text).toBe('Hello')
  })
})
