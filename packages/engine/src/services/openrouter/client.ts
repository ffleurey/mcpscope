/**
 * OpenRouter-specific client.
 *
 * OpenRouter extends the standard OAI API with user-specific endpoints.
 * This module provides functions that are unique to OpenRouter, such as
 * fetching only the models available to the current API key.
 */

import { rootUrl, authHeaders } from '../openai/client.js'
import type { LmStudioModelStatus } from '../lmstudio/client.js'

/** OpenRouter's native model listing shape. */
interface OpenRouterModelEntry {
  id: string
  object?: string
  created?: number
  owned_by?: string
  context_length?: number
  supported_parameters?: string[]
}

interface OpenRouterModelsResponse {
  data: OpenRouterModelEntry[]
}

/**
 * Fetches the list of models available to the current API key.
 *
 * Uses OpenRouter's /api/v1/models/user endpoint which respects workspace
 * guardrails, ZDR policies, provider preferences, and EU routing.
 *
 * https://openrouter.ai/docs/api-reference/models-user
 */
export async function listUserModels(
  baseUrl: string,
  apiKey?: string,
): Promise<LmStudioModelStatus[]> {
  // For OpenRouter, the user-specific endpoint is always at
  // /api/v1/models/user relative to the root (not the OAI compat base).
  const root = rootUrl(baseUrl)
  const url = `${root}/api/v1/models/user`

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...authHeaders(apiKey),
    },
  })

  if (!response.ok) {
    throw new Error(
      `OpenRouter user models request failed: ${response.status} ${response.statusText}`,
    )
  }

  const json = (await response.json()) as OpenRouterModelsResponse

  return (json.data ?? []).map((entry) => {
    const id = entry.id ?? ''
    const supportsReasoning = entry.supported_parameters?.includes('reasoning') ?? false
    return {
      uid: id,
      key: id,
      displayName: id,
      maxContextLength: entry.context_length ?? null,
      loadedContextLength: null,
      isLoaded: true,
      supportsReasoning,
      defaultReasoningOn: supportsReasoning,
      raw: {
        type: 'llm',
        key: id,
        display_name: id,
        context_length: entry.context_length,
        supported_parameters: entry.supported_parameters,
        object: entry.object,
        owned_by: entry.owned_by,
      } as LmStudioModelStatus['raw'],
    }
  })
}
