import { describe, expect, it } from 'vitest'
import type { PartRecord, SessionRecord } from './model.js'
import { buildApiMessages, buildModelMessages, deriveContextEntries, deriveTranscriptEntries } from './selectors.js'

function makeSession(): SessionRecord {
  return {
    id: 'session-1',
    title: 'Test session',
    status: 'ready',
    initStatus: 'ready',
    sessionType: 'primary',
    parentKind: null,
    parentId: null,
    createdAt: 1,
    updatedAt: 1,
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
  }
}

function makePart(overrides: Partial<PartRecord>): PartRecord {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    sessionId: overrides.sessionId ?? 'session-1',
    turnId: overrides.turnId ?? 'turn-1',
    roundId: overrides.roundId ?? null,
    parentPartId: overrides.parentPartId ?? null,
    ordinal: overrides.ordinal ?? 0,
    partType: overrides.partType ?? 'user-message',
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
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  }
}

describe('domain selectors', () => {
  it('builds model messages from included historical parts and the next user message', () => {
    const session = makeSession()
    const parts: PartRecord[] = [
      makePart({
        ordinal: 1,
        partType: 'user-message',
        payload: { text: 'First question', json: null, mimeType: null, summary: null },
      }),
      makePart({
        ordinal: 2,
        partType: 'assistant-reasoning',
        payload: { text: 'hidden reasoning', json: null, mimeType: null, summary: null },
        context: { state: 'stripped', note: 'not forwarded', strippedByCompactionAtTurnId: null },
      }),
      makePart({
        ordinal: 3,
        partType: 'assistant-content',
        payload: { text: 'First answer', json: null, mimeType: null, summary: null },
      }),
    ]

    expect(buildModelMessages(session, parts, 'Second question')).toEqual([
      { role: 'system', content: 'You are exact.' },
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Second question' },
    ])
  })

  it('derives transcript and context views from canonical parts', () => {
    const parts: PartRecord[] = [
      makePart({
        ordinal: 1,
        partType: 'user-message',
        roleLabel: 'user',
        payload: { text: 'Question', json: null, mimeType: null, summary: null },
      }),
      makePart({
        ordinal: 2,
        partType: 'assistant-reasoning',
        roleLabel: 'assistant',
        payload: { text: 'Reasoning', json: null, mimeType: null, summary: null },
        context: { state: 'stripped', note: 'historical only', strippedByCompactionAtTurnId: null },
      }),
      makePart({
        ordinal: 3,
        partType: 'assistant-content',
        roleLabel: 'assistant',
        payload: { text: 'Answer', json: null, mimeType: null, summary: null },
      }),
      makePart({
        ordinal: 4,
        partType: 'diagnostic-note',
        display: { state: 'diagnostic', collapsedByDefault: true },
        context: { state: 'excluded', note: 'not user-facing', strippedByCompactionAtTurnId: null },
        payload: { text: 'raw', json: null, mimeType: null, summary: null },
      }),
    ]

    expect(deriveTranscriptEntries(parts).map(entry => entry.type)).toEqual([
      'user-message',
      'assistant-reasoning',
      'assistant-content',
    ])
    expect(deriveContextEntries(parts).map(entry => entry.type)).toEqual([
      'user-message',
      'assistant-content',
    ])
  })

  it('reconstructs tool-call and tool-result history into API messages', () => {
    const session = makeSession()
    const parts: PartRecord[] = [
      makePart({
        ordinal: 1,
        partType: 'user-message',
        payload: { text: 'What time is it?', json: null, mimeType: null, summary: null },
      }),
      makePart({
        id: 'tool-call-part',
        ordinal: 2,
        roundId: 'round-1',
        partType: 'tool-call',
        payload: {
          text: null,
          json: {
            id: 'call-1',
            name: 'ha_history_get_current_time',
            arguments: '{}',
          },
          mimeType: 'application/json',
          summary: 'ha_history_get_current_time',
        },
      }),
      makePart({
        ordinal: 3,
        roundId: 'round-1',
        partType: 'tool-result',
        parentPartId: 'tool-call-part',
        roleLabel: 'tool',
        payload: {
          text: '2026-05-10T12:34:56+02:00',
          json: null,
          mimeType: 'text/plain',
          summary: null,
        },
        provenanceJson: {
          toolCallId: 'call-1',
        },
      }),
      makePart({
        ordinal: 4,
        roundId: 'round-2',
        partType: 'assistant-content',
        payload: { text: 'It is 12:34.', json: null, mimeType: null, summary: null },
      }),
    ]

    expect(buildApiMessages(session, parts)).toEqual([
      { role: 'system', content: 'You are exact.' },
      { role: 'user', content: 'What time is it?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'ha_history_get_current_time',
              arguments: '{}',
            },
          },
        ],
      },
      {
        role: 'tool',
        content: '2026-05-10T12:34:56+02:00',
        tool_call_id: 'call-1',
      },
      { role: 'assistant', content: 'It is 12:34.' },
    ])
  })

  it('reconstructs assistant content and tool calls into the same API message when they share a round', () => {
    const session = makeSession()
    const parts: PartRecord[] = [
      makePart({
        ordinal: 1,
        partType: 'user-message',
        payload: { text: 'Compare two things.', json: null, mimeType: null, summary: null },
      }),
      makePart({
        ordinal: 2,
        roundId: 'round-1',
        partType: 'assistant-content',
        payload: { text: 'I will check both.', json: null, mimeType: null, summary: null },
      }),
      makePart({
        ordinal: 3,
        roundId: 'round-1',
        partType: 'tool-call',
        payload: {
          text: null,
          json: { id: 'call-1', name: 'tool_one', arguments: '{}' },
          mimeType: 'application/json',
          summary: 'tool_one',
        },
      }),
      makePart({
        ordinal: 4,
        roundId: 'round-1',
        partType: 'tool-call',
        payload: {
          text: null,
          json: { id: 'call-2', name: 'tool_two', arguments: '{"x":1}' },
          mimeType: 'application/json',
          summary: 'tool_two',
        },
      }),
    ]

    expect(buildApiMessages(session, parts)).toEqual([
      { role: 'system', content: 'You are exact.' },
      { role: 'user', content: 'Compare two things.' },
      {
        role: 'assistant',
        content: 'I will check both.',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'tool_one', arguments: '{}' },
          },
          {
            id: 'call-2',
            type: 'function',
            function: { name: 'tool_two', arguments: '{"x":1}' },
          },
        ],
      },
    ])
  })

  it('merges multiple assistant content segments from the same round into one assistant message', () => {
    const session = makeSession()
    const parts: PartRecord[] = [
      makePart({
        ordinal: 1,
        partType: 'user-message',
        payload: { text: 'Say hello.', json: null, mimeType: null, summary: null },
      }),
      makePart({
        ordinal: 2,
        roundId: 'round-1',
        partType: 'assistant-content',
        payload: { text: 'Hello', json: null, mimeType: null, summary: null },
      }),
      makePart({
        ordinal: 3,
        roundId: 'round-1',
        partType: 'assistant-content',
        payload: { text: ' world', json: null, mimeType: null, summary: null },
      }),
    ]

    expect(buildApiMessages(session, parts)).toEqual([
      { role: 'system', content: 'You are exact.' },
      { role: 'user', content: 'Say hello.' },
      { role: 'assistant', content: 'Hello world' },
    ])
  })
})
