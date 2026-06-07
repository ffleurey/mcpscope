import type {
  AssistantSegment,
  OaiChatCompletionResponse,
  StreamCallbacks,
  OaiStreamedChatCompletionResult,
} from '../services/lmstudio/client.js'
import type { ChatCompletionGateway } from './modelTurns.js'

function segmentsFromCompletion(
  completion: OaiChatCompletionResponse,
): AssistantSegment[] {
  const responseMessage = completion.choices[0]?.message
  const segments: AssistantSegment[] = []

  if (responseMessage?.reasoning_content?.length) {
    segments.push({
      kind: 'reasoning',
      text: responseMessage.reasoning_content,
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
