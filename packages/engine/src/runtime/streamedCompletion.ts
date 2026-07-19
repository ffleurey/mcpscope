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
