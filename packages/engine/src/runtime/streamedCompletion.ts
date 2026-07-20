import type {
  AssistantSegment,
  OaiChatCompletionResponse,
  StreamCallbacks,
  OaiStreamedChatCompletionResult,
} from '../services/openai/client.js'
import type { ChatCompletionGateway } from './modelTurns.js'

function segmentsFromCompletion(completion: OaiChatCompletionResponse): AssistantSegment[] {
  const responseMessage = completion.choices[0]?.message
  const segments: AssistantSegment[] = []

  // Mirror extractReasoningContent's per-provider fields (reasoning_content /
  // reasoning / thinking) with the same string-only guard — a non-string
  // `reasoning` value must not render as "[object Object]".
  const rawReasoning = (responseMessage as Record<string, unknown> | undefined)?.reasoning
  const rawThinking = (responseMessage as Record<string, unknown> | undefined)?.thinking
  const reasoningText = responseMessage?.reasoning_content?.length
    ? responseMessage.reasoning_content
    : typeof rawReasoning === 'string' && rawReasoning.length > 0
      ? rawReasoning
      : typeof rawThinking === 'string'
        ? rawThinking
        : undefined
  if (reasoningText?.length) {
    segments.push({
      kind: 'reasoning',
      text: reasoningText,
    })
  }

  if (responseMessage?.content?.length) {
    segments.push({
      kind: 'content',
      text: responseMessage.content,
    })
  }

  responseMessage?.tool_calls?.forEach((_toolCall, index) => {
    segments.push({
      kind: 'tool-call',
      toolCallIndex: index,
    })
  })

  return segments
}

export async function executeChatCompletion(
  chatCompletionGateway: ChatCompletionGateway,
  baseUrl: string,
  apiKey: string | undefined,
  body: Record<string, unknown>,
  callbacks?: StreamCallbacks,
): Promise<OaiStreamedChatCompletionResult> {
  if (chatCompletionGateway.streamChatCompletion) {
    return chatCompletionGateway.streamChatCompletion(baseUrl, apiKey, body, callbacks)
  }

  const completion = await chatCompletionGateway.createChatCompletion(baseUrl, apiKey, {
    ...body,
    stream: false,
  })

  return {
    completion,
    segments: segmentsFromCompletion(completion),
    rawResponseBody: JSON.stringify(completion),
    chunks: [],
  }
}

/**
 * A completion is "degenerately empty" when the model ended the round — with a
 * finish reason of anything but `length` — having emitted no tool call, no
 * content, and no reasoning text. There is nothing to record, recover, or act
 * on. This is an observed intermittent provider/connection failure: Gemini 2.5
 * Flash Lite via OpenRouter, for instance, sometimes burns its whole output
 * budget on hidden reasoning and returns empty content with finish_reason
 * "stop" (the usage still reports reasoning_tokens, but no reasoning text is
 * delivered, so reasoning-channel recovery has nothing to surface). Such a turn
 * has not really succeeded, so callers treat it as an error the operator can
 * manually retry rather than silently marking it complete.
 *
 * Truncation (`length`) is deliberately excluded: it is a legitimate signal
 * that a capped-but-real answer exists, which the caller surfaces instead.
 */
export function isDegenerateEmptyCompletion(result: OaiStreamedChatCompletionResult): boolean {
  const finishReason = result.completion.choices[0]?.finish_reason
  if (finishReason === 'length') return false
  return !result.segments.some((segment) =>
    segment.kind === 'tool-call' ? true : segment.text.trim().length > 0,
  )
}
