import { describe, expect, it } from 'vitest'
import { isDegenerateEmptyCompletion } from './streamedCompletion.js'
import type { OaiChatCompletionResponse } from '../services/openai/client.js'

function completion(
  overrides: Partial<OaiChatCompletionResponse['choices'][number]['message']> & {
    finish_reason?: string
  } = {},
): OaiChatCompletionResponse {
  const { finish_reason = 'stop', ...message } = overrides
  return {
    id: 'c1',
    model: 'model-key',
    created: 1,
    choices: [
      {
        index: 0,
        finish_reason: finish_reason as never,
        message: { role: 'assistant', content: null, ...message },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, reasoning_tokens: 5, total_tokens: 15 },
  } as OaiChatCompletionResponse
}

describe('isDegenerateEmptyCompletion', () => {
  it('flags a stop-finish response with no content, tool call, or reasoning', () => {
    // The Gemini-via-OpenRouter glitch: all output tokens went to hidden
    // reasoning, delivered content is empty, finish_reason is "stop".
    const result = {
      completion: completion({ content: '' }),
      segments: [],
      rawResponseBody: '',
      chunks: [],
    }
    expect(isDegenerateEmptyCompletion(result)).toBe(true)
  })

  it('does not flag a response that carries content', () => {
    const result = {
      completion: completion({ content: 'Here is the answer.' }),
      segments: [{ kind: 'content' as const, text: 'Here is the answer.' }],
      rawResponseBody: '',
      chunks: [],
    }
    expect(isDegenerateEmptyCompletion(result)).toBe(false)
  })

  it('does not flag a response that carries recoverable reasoning text', () => {
    const result = {
      completion: completion({ reasoning_content: 'The answer is 42.' }),
      segments: [{ kind: 'reasoning' as const, text: 'The answer is 42.' }],
      rawResponseBody: '',
      chunks: [],
    }
    expect(isDegenerateEmptyCompletion(result)).toBe(false)
  })

  it('does not flag a tool-call response', () => {
    const result = {
      completion: completion({ finish_reason: 'tool_calls' }),
      segments: [{ kind: 'tool-call' as const, toolCallIndex: 0 }],
      rawResponseBody: '',
      chunks: [],
    }
    expect(isDegenerateEmptyCompletion(result)).toBe(false)
  })

  it('does not flag a truncated (length) response — that is a real capped answer', () => {
    // A length-truncated round with no captured segment is still a legitimate
    // signal to surface, not a glitch to treat as an empty-response error.
    const result = {
      completion: completion({ finish_reason: 'length', content: '' }),
      segments: [],
      rawResponseBody: '',
      chunks: [],
    }
    expect(isDegenerateEmptyCompletion(result)).toBe(false)
  })
})
