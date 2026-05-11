import type {
  LmStudioAssistantSegment,
  LmStudioChatCompletionResponse,
  LmStudioStreamedChatCompletionResult,
} from '../services/lmstudio/client.js'
import type { LmStudioGateway } from './modelTurns.js'

function segmentsFromCompletion(
  completion: LmStudioChatCompletionResponse,
): LmStudioAssistantSegment[] {
  const responseMessage = completion.choices[0]?.message
  const segments: LmStudioAssistantSegment[] = []

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
  lmStudioGateway: LmStudioGateway,
  baseUrl: string,
  apiKey: string | undefined,
  body: Record<string, unknown>,
): Promise<LmStudioStreamedChatCompletionResult> {
  if (lmStudioGateway.streamChatCompletion) {
    return lmStudioGateway.streamChatCompletion(baseUrl, apiKey, body)
  }

  const completion = await lmStudioGateway.createChatCompletion(baseUrl, apiKey, {
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
