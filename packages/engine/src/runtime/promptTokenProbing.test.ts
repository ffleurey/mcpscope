import { describe, expect, it } from 'vitest'
import { probeRequestPromptTokens } from './promptTokenProbing.js'
import { ProviderResponseError } from '../services/openai/client.js'
import type { ChatCompletionGateway } from './modelTurns.js'
import type { SessionRecord } from '../domain/model.js'
import type { ApiMessage } from '../domain/selectors.js'

// The probe is best-effort token accounting. OpenRouter/OpenAI reject the
// `max_tokens: 1` probe with a 400 when the prompt would trigger a tool call, so
// a throwing probe must NOT abort the caller for OpenRouter — it degrades to an
// estimate. Other providers keep the previous fail-fast behavior.

function sessionWithProvider(
  providerType: string | null,
  reasoning: 'on' | 'off' | null = null,
): SessionRecord {
  return {
    modelProfileSnapshot: {
      connectionBaseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'k',
      modelKey: 'm',
      reasoning,
      temperature: null,
      providerType,
    },
  } as unknown as SessionRecord
}

const messages: ApiMessage[] = [
  { role: 'user', content: 'What is the weather in Oslo?' } as ApiMessage,
]

function gatewayThrowing(err: unknown): ChatCompletionGateway {
  return {
    async probePromptTokensDetailed() {
      throw err
    },
  } as unknown as ChatCompletionGateway
}

const reject400 = new ProviderResponseError(
  400,
  'Completion failed: 400 Bad Request: max_tokens or model output limit was reached',
)

describe('probeRequestPromptTokens — probe failure handling', () => {
  it('falls back to an estimate (does not throw) for OpenRouter when the probe 400s', async () => {
    const result = await probeRequestPromptTokens(
      gatewayThrowing(reject400),
      sessionWithProvider('openrouter'),
      messages,
    )
    // Estimate is derived from message text length, so it must be a positive number.
    expect(typeof result).toBe('number')
    expect(result as number).toBeGreaterThan(0)
  })

  it('re-throws non-400 errors (e.g. auth/transport) even for OpenRouter', async () => {
    // A 401 or a network error must surface, not be silently estimated away.
    await expect(
      probeRequestPromptTokens(
        gatewayThrowing(new ProviderResponseError(401, 'Unauthorized')),
        sessionWithProvider('openrouter'),
        messages,
      ),
    ).rejects.toThrow(/Unauthorized/)
    await expect(
      probeRequestPromptTokens(
        gatewayThrowing(new Error('fetch failed')),
        sessionWithProvider('openrouter'),
        messages,
      ),
    ).rejects.toThrow(/fetch failed/)
  })

  it('re-throws for non-OpenRouter providers (preserves fail-fast)', async () => {
    await expect(
      probeRequestPromptTokens(
        gatewayThrowing(reject400),
        sessionWithProvider('lmstudio'),
        messages,
      ),
    ).rejects.toThrow(/max_tokens/)
  })

  it('returns null for an empty message list without calling the gateway', async () => {
    const result = await probeRequestPromptTokens(
      gatewayThrowing(reject400),
      sessionWithProvider('openrouter'),
      [],
    )
    expect(result).toBeNull()
  })

  it('skips the max_tokens:1 probe entirely for OpenRouter reasoning models', async () => {
    // Some OpenRouter upstreams ignore the max_tokens budget for reasoning
    // models and charge for a full generation, so the probe must never be
    // called for this combination — go straight to the text estimate.
    let gatewayCalled = false
    const gateway: ChatCompletionGateway = {
      async probePromptTokensDetailed() {
        gatewayCalled = true
        throw new Error('should not be called')
      },
    } as unknown as ChatCompletionGateway

    const result = await probeRequestPromptTokens(
      gateway,
      sessionWithProvider('openrouter', 'on'),
      messages,
    )

    expect(gatewayCalled).toBe(false)
    expect(typeof result).toBe('number')
    expect(result as number).toBeGreaterThan(0)
  })

  it('still probes OpenRouter models with reasoning off', async () => {
    let gatewayCalled = false
    const gateway: ChatCompletionGateway = {
      async probePromptTokensDetailed() {
        gatewayCalled = true
        return {
          promptTokens: 7,
          completion: {} as never,
          rawExchange: {
            requestUrl: 'https://openrouter.ai/api/v1/chat/completions',
            requestMethod: 'POST',
            requestHeadersJson: null,
            requestBody: null,
            responseStatus: 200,
            responseHeadersJson: null,
            responseBody: null,
          },
        }
      },
    } as unknown as ChatCompletionGateway

    const result = await probeRequestPromptTokens(
      gateway,
      sessionWithProvider('openrouter', 'off'),
      messages,
    )

    expect(gatewayCalled).toBe(true)
    expect(result).toBe(7)
  })
})
