import { ensureModelReady } from '../services/provider/index.js'
import type { ProviderConnection } from '../domain/configuration.js'
import type { ChatCompletionGateway } from './modelTurns.js'

interface AutoModelSwapDeps {
  /** Live connection list — the app's config store in production, a stub in tests. */
  listConnections: () => ProviderConnection[]
  /** Swap implementation — overridable for tests. */
  ensureReady?: typeof ensureModelReady
}

/**
 * Wrap a {@link ChatCompletionGateway} so that, before every request to a
 * provider, mcpscope ensures the requested model is the one loaded on the
 * target instance — unloading anything else first when the connection has
 * auto-swap enabled.
 *
 * This is a harness-level concern: sessions never opt in. The flag lives on the
 * live connection (looked up by `baseUrl`, the physical instance) and is read
 * fresh on each request, so it also self-heals if another process evicts our
 * model mid-session. No-op for connections without auto-swap and for
 * non-LM-Studio providers (enforced centrally in {@link ensureModelReady}).
 */
export function withAutoModelSwap(
  inner: ChatCompletionGateway,
  deps: AutoModelSwapDeps,
): ChatCompletionGateway {
  const listConnections = deps.listConnections
  const ensureReady = deps.ensureReady ?? ensureModelReady

  async function swapIfNeeded(
    baseUrl: string,
    apiKey: string | undefined,
    body: Record<string, unknown>,
  ): Promise<void> {
    const modelKey = typeof body.model === 'string' ? body.model : undefined
    if (!modelKey) return

    // Same baseUrl == same physical instance. Enable the swap if *any*
    // connection pointed at this instance has it turned on.
    const matches = listConnections().filter((c) => c.baseUrl === baseUrl)
    const primary = matches.find((c) => c.autoSwapModel === true)
    if (!primary) return

    const contextSize = typeof body.num_ctx === 'number' ? body.num_ctx : undefined
    await ensureReady({
      baseUrl,
      apiKey,
      providerType: primary.providerType,
      modelKey,
      contextSize,
      autoSwap: true,
    })
  }

  // Build conditionally so optional methods absent on `inner` stay absent
  // (rather than being set to `undefined`, which exactOptionalPropertyTypes
  // rejects) and the wrapper advertises exactly the same surface as `inner`.
  const gateway: ChatCompletionGateway = {
    createChatCompletion: async (baseUrl, apiKey, body, signal) => {
      await swapIfNeeded(baseUrl, apiKey, body)
      return inner.createChatCompletion(baseUrl, apiKey, body, signal)
    },
  }

  const { streamChatCompletion, probePromptTokens, probePromptTokensDetailed } = inner
  if (streamChatCompletion) {
    gateway.streamChatCompletion = async (baseUrl, apiKey, body, callbacks, signal) => {
      await swapIfNeeded(baseUrl, apiKey, body)
      return streamChatCompletion(baseUrl, apiKey, body, callbacks, signal)
    }
  }
  if (probePromptTokens) {
    gateway.probePromptTokens = async (baseUrl, apiKey, body) => {
      await swapIfNeeded(baseUrl, apiKey, body)
      return probePromptTokens(baseUrl, apiKey, body)
    }
  }
  if (probePromptTokensDetailed) {
    gateway.probePromptTokensDetailed = async (baseUrl, apiKey, body) => {
      await swapIfNeeded(baseUrl, apiKey, body)
      return probePromptTokensDetailed(baseUrl, apiKey, body)
    }
  }
  // No request body / model key — nothing to swap; pass through untouched.
  if (inner.getLoadedContextLength) {
    gateway.getLoadedContextLength = inner.getLoadedContextLength
  }

  return gateway
}
