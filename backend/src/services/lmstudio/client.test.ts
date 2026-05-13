import { describe, expect, it } from 'vitest'
import { parseChatCompletionStream } from './client.js'

describe('LM Studio streaming parser', () => {
  it('parses streamed reasoning, content, and usage for a model-only response', () => {
    const rawStream = [
      'data: {"id":"cmpl-1","model":"model-key","created":1,"choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"Plan"},"finish_reason":null}]}',
      '',
      'data: {"id":"cmpl-1","model":"model-key","created":1,"choices":[{"index":0,"delta":{"reasoning_content":" more"},"finish_reason":null}]}',
      '',
      'data: {"id":"cmpl-1","model":"model-key","created":1,"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}',
      '',
      'data: {"id":"cmpl-1","model":"model-key","created":1,"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      '',
      'data: {"id":"cmpl-1","model":"model-key","created":1,"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":6,"completion_tokens_details":{"reasoning_tokens":4},"total_tokens":16}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')

    const parsed = parseChatCompletionStream(rawStream)

    expect(parsed.segments).toEqual([
      { kind: 'reasoning', text: 'Plan more' },
      { kind: 'content', text: 'OK' },
    ])
    expect(parsed.completion.choices[0]?.message).toEqual({
      role: 'assistant',
      reasoning_content: 'Plan more',
      content: 'OK',
    })
    expect(parsed.completion.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 6,
      completion_tokens_details: {
        reasoning_tokens: 4,
      },
      total_tokens: 16,
    })
  })

  it('parses streamed reasoning and ordered tool calls from a tool response', () => {
    const rawStream = [
      'data: {"id":"cmpl-2","model":"model-key","created":2,"choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"First"},"finish_reason":null}]}',
      '',
      'data: {"id":"cmpl-2","model":"model-key","created":2,"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"tool_one","arguments":"{\\"a\\":"}}]},"finish_reason":null}]}',
      '',
      'data: {"id":"cmpl-2","model":"model-key","created":2,"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]},"finish_reason":null}]}',
      '',
      'data: {"id":"cmpl-2","model":"model-key","created":2,"choices":[{"index":0,"delta":{"reasoning_content":"Second"},"finish_reason":null}]}',
      '',
      'data: {"id":"cmpl-2","model":"model-key","created":2,"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call-2","type":"function","function":{"name":"tool_two","arguments":"{}"}}]},"finish_reason":null}]}',
      '',
      'data: {"id":"cmpl-2","model":"model-key","created":2,"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
      '',
      'data: {"id":"cmpl-2","model":"model-key","created":2,"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":9,"reasoning_tokens":5,"total_tokens":29}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')

    const parsed = parseChatCompletionStream(rawStream)

    expect(parsed.segments).toEqual([
      { kind: 'reasoning', text: 'First' },
      { kind: 'tool-call', toolCallIndex: 0 },
      { kind: 'reasoning', text: 'Second' },
      { kind: 'tool-call', toolCallIndex: 1 },
    ])
    expect(parsed.completion.choices[0]?.message?.tool_calls).toEqual([
      {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'tool_one',
          arguments: '{"a":1}',
        },
      },
      {
        id: 'call-2',
        type: 'function',
        function: {
          name: 'tool_two',
          arguments: '{}',
        },
      },
    ])
    expect(parsed.completion.usage?.reasoning_tokens).toBe(5)
  })
})
