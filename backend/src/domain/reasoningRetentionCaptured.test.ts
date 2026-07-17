import { describe, expect, it } from 'vitest'
import { buildApiMessages, deriveContextEntries, deriveTranscriptEntries } from 'mcpscope-engine/domain/selectors.js'
import {
  capturedReasoningThreeBatchParts,
  capturedReasoningThreeBatchRounds,
  capturedReasoningThreeBatchSession,
} from '../testing/fixtures/capturedReasoningThreeBatch.js'

function countToolCallsByRound() {
  const counts = new Map<string, number>()

  for (const part of capturedReasoningThreeBatchParts) {
    if (part.partType !== 'tool-call') continue
    counts.set(part.roundId ?? 'unknown', (counts.get(part.roundId ?? 'unknown') ?? 0) + 1)
  }

  return capturedReasoningThreeBatchRounds
    .filter(round => round.finishReason === 'tool_calls')
    .map(round => counts.get(round.id) ?? 0)
}

describe('captured reasoning retention', () => {
  it('preserves reasoning in transcript while stripping it from later model-visible context', () => {
    const transcript = deriveTranscriptEntries(capturedReasoningThreeBatchParts)
    const context = deriveContextEntries(capturedReasoningThreeBatchParts)
    const apiMessages = buildApiMessages(capturedReasoningThreeBatchSession, capturedReasoningThreeBatchParts)

    expect(capturedReasoningThreeBatchRounds.filter(round => round.finishReason === 'tool_calls')).toHaveLength(3)
    expect(countToolCallsByRound()).toEqual([2, 2, 2])

    expect(transcript.filter(entry => entry.type === 'assistant-reasoning')).toHaveLength(4)
    expect(context.filter(entry => entry.type === 'assistant-reasoning')).toHaveLength(0)

    const assistantToolMessages = apiMessages.filter(message => message.role === 'assistant' && Array.isArray(message.tool_calls))
    expect(assistantToolMessages).toHaveLength(3)
    expect(assistantToolMessages.every(message => message.content === null && message.tool_calls?.length === 2)).toBe(true)
    expect(apiMessages.some(message => 'reasoning_content' in message)).toBe(false)
  })

  it('keeps each captured reasoning token total attached to its original round', () => {
    const reasoningByRound = new Map(
      capturedReasoningThreeBatchParts
        .filter(part => part.partType === 'assistant-reasoning')
        .map(part => [part.roundId, part.tokens.count]),
    )

    expect(
      capturedReasoningThreeBatchRounds.map(round => reasoningByRound.get(round.id) ?? null),
    ).toEqual(
      capturedReasoningThreeBatchRounds.map(round => round.usage.reasoningTokens),
    )
  })
})
