import { describe, expect, it } from 'vitest'
import { describeStreamFailure, recoverAnswerFromReasoning } from './turnAssembly.js'
import { StreamReadError } from '../services/openai/client.js'
import type { AssistantSegment } from '../services/openai/client.js'

describe('recoverAnswerFromReasoning', () => {
  it('appends a content segment carrying the reasoning when there is no content', () => {
    const segments: AssistantSegment[] = [
      { kind: 'reasoning', text: '**Conclusion:** uptime was 90.7%.' },
    ]
    const out = recoverAnswerFromReasoning(segments)
    expect(out.recovered).toBe(true)
    const content = out.segments.filter((s) => s.kind === 'content')
    expect(content).toEqual([{ kind: 'content', text: '**Conclusion:** uptime was 90.7%.' }])
    // The reasoning segment is preserved, not replaced.
    expect(out.segments.some((s) => s.kind === 'reasoning')).toBe(true)
  })

  it('joins multiple reasoning segments in order', () => {
    const out = recoverAnswerFromReasoning([
      { kind: 'reasoning', text: 'first' },
      { kind: 'reasoning', text: 'second' },
    ])
    expect(out.recovered).toBe(true)
    expect(out.segments.at(-1)).toEqual({ kind: 'content', text: 'first\n\nsecond' })
  })

  it('does nothing when the round already has content', () => {
    const segments: AssistantSegment[] = [
      { kind: 'reasoning', text: 'thinking...' },
      { kind: 'content', text: 'The answer is 42.' },
    ]
    const out = recoverAnswerFromReasoning(segments)
    expect(out.recovered).toBe(false)
    expect(out.segments).toBe(segments)
  })

  it('does nothing when there is neither content nor reasoning', () => {
    const out = recoverAnswerFromReasoning([{ kind: 'tool-call', toolCallIndex: 0 }])
    expect(out.recovered).toBe(false)
  })
})

describe('describeStreamFailure error classification', () => {
  it('classifies an AbortError as aborted', () => {
    const err = new DOMException('This operation was aborted', 'AbortError')
    expect(describeStreamFailure(err).errorType).toBe('aborted')
  })

  it('unwraps a StreamReadError cause to detect an abort', () => {
    const err = new StreamReadError(
      'stream read failed',
      42,
      {
        completion: { id: 'cmpl-x', model: 'model-key', created: 1, choices: [] },
        segments: [],
        rawResponseBody: '',
        chunks: [],
      },
      { cause: new DOMException('This operation was aborted', 'AbortError') },
    )
    expect(describeStreamFailure(err).errorType).toBe('aborted')
  })

  it('classifies connection failures as provider_unreachable', () => {
    expect(describeStreamFailure(new TypeError('fetch failed')).errorType).toBe(
      'provider_unreachable',
    )
    expect(
      describeStreamFailure(new Error('connect ECONNREFUSED 127.0.0.1:1234')).errorType,
    ).toBe('provider_unreachable')
    expect(
      describeStreamFailure(new Error('getaddrinfo ENOTFOUND lmstudio.local')).errorType,
    ).toBe('provider_unreachable')
  })

  it('falls back to internal for unrecognized errors', () => {
    expect(describeStreamFailure(new Error('boom')).errorType).toBe('internal')
    expect(describeStreamFailure('string error').errorType).toBe('internal')
  })
})
