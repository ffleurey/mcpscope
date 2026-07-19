import { afterEach, describe, expect, it, vi } from 'vitest'
import { StreamReadError, parseChatCompletionStream, streamChatCompletion } from './client.js'

function sse(...payloads: string[]): string {
  return payloads.map((p) => `data: ${p}\n\n`).join('') + 'data: [DONE]\n\n'
}

describe('parseChatCompletionStream', () => {
  it('assembles content, finish reason, and usage from a chunked stream', () => {
    const raw = sse(
      '{"id":"c1","model":"m","created":1,"choices":[{"index":0,"delta":{"role":"assistant","content":"Hel"}}]}',
      '{"choices":[{"index":0,"delta":{"content":"lo."},"finish_reason":"stop"}]}',
      '{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}',
    )
    const result = parseChatCompletionStream(raw)
    expect(result.completion.choices[0]?.message?.content).toBe('Hello.')
    expect(result.completion.choices[0]?.finish_reason).toBe('stop')
    expect(result.completion.usage?.total_tokens).toBe(13)
  })

  it('skips a malformed chunk without discarding the rest of the stream', () => {
    const raw = sse(
      '{"choices":[{"index":0,"delta":{"content":"keep "}}]}',
      '{"choices":[{"index":0,"delta":{"content":"TRUNCATED', // corrupt payload
      '{"choices":[{"index":0,"delta":{"content":"this"},"finish_reason":"stop"}]}',
    )
    const result = parseChatCompletionStream(raw)
    expect(result.completion.choices[0]?.message?.content).toBe('keep this')
    expect(result.completion.choices[0]?.finish_reason).toBe('stop')
  })

  it('ignores SSE comment lines (OpenRouter keep-alive prefix)', () => {
    const raw =
      ': OPENROUTER PROCESSING\n\n' +
      sse('{"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}')
    const result = parseChatCompletionStream(raw)
    expect(result.completion.choices[0]?.message?.content).toBe('ok')
  })

  it('uses first-wins for tool-call ids repeated across chunks', () => {
    const raw = sse(
      '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"get_","arguments":"{\\"a\\""}}]}}]}',
      '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"time","arguments":":1}"}}]}}]}',
      '{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
    )
    const result = parseChatCompletionStream(raw)
    const toolCall = result.completion.choices[0]?.message?.tool_calls?.[0]
    expect(toolCall?.id).toBe('call-1')
    expect(toolCall?.function?.name).toBe('get_time')
    expect(toolCall?.function?.arguments).toBe('{"a":1}')
  })
})

// Mocks fetch to return a body whose reader yields `chunks` one at a time,
// then throws on the (0-indexed) `failAt` read — simulating a mid-stream
// network drop after the model has already streamed some real content.
function mockStreamingFetch(chunks: string[], failAt: number) {
  return vi.fn(async () => {
    const encoder = new TextEncoder()
    let index = 0
    return {
      ok: true,
      body: {
        getReader: () => ({
          async read() {
            if (index === failAt) {
              throw new Error('socket hang up')
            }
            if (index >= chunks.length) {
              return { done: true, value: undefined }
            }
            const value = encoder.encode(chunks[index])
            index += 1
            return { done: false, value }
          },
          async cancel() {
            /* no-op */
          },
        }),
      },
      async text() {
        return ''
      },
    } as unknown as Response
  })
}

describe('streamChatCompletion — mid-stream failure recovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws StreamReadError carrying the partial segments and byte count instead of a bare error', async () => {
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'Thinking...' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Partial answer' } }] })}\n\n`,
    ]
    vi.stubGlobal('fetch', mockStreamingFetch(chunks, 2))

    let caught: unknown
    try {
      await streamChatCompletion('https://example.com/v1', undefined, { model: 'm' })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(StreamReadError)
    const streamErr = caught as StreamReadError
    expect(streamErr.receivedBytes).toBeGreaterThan(0)
    expect(streamErr.message).toMatch(/Stream reading failed after \d+ bytes?: socket hang up/)
    expect(streamErr.cause).toBeInstanceOf(Error)
    expect(streamErr.partial.segments).toEqual([
      { kind: 'reasoning', text: 'Thinking...' },
      { kind: 'content', text: 'Partial answer' },
    ])
  })

  it('reports zero received bytes when the connection drops before any data arrives', async () => {
    vi.stubGlobal('fetch', mockStreamingFetch([], 0))

    let caught: unknown
    try {
      await streamChatCompletion('https://example.com/v1', undefined, { model: 'm' })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(StreamReadError)
    const streamErr = caught as StreamReadError
    expect(streamErr.receivedBytes).toBe(0)
    expect(streamErr.partial.segments).toEqual([])
    expect(streamErr.message).toMatch(/Stream reading failed after 0 bytes:/)
  })
})
