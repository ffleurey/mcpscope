import type { PartRecord, TokenMetadata } from './model.js'
import type { OaiChatCompletionResponse, OaiChatCompletionUsage } from '../services/lmstudio/client.js'

export interface NormalizedUsage {
  promptTokens: number | null
  completionTokens: number | null
  reasoningTokens: number | null
  totalTokens: number | null
  assistantContentTokens: number | null
}

export function deriveExactDeltaTokenMetadata(
  totalTokens: number | null,
  prefixTokens: number | null,
  exactNote: string,
  unknownNote: string,
): TokenMetadata {
  if (totalTokens == null || prefixTokens == null) {
    return {
      count: null,
      source: 'unknown',
      confidence: 'unknown',
      note: unknownNote,
    }
  }

  return {
    count: Math.max(0, totalTokens - prefixTokens),
    source: 'delta-derived',
    confidence: 'exact',
    note: exactNote,
  }
}

export function allocateProportionalTokenCounts(totalTokens: number, weights: number[]): number[] {
  if (weights.length === 0) {
    return []
  }

  const normalizedWeights = weights.map(weight => Math.max(0, weight))
  const totalWeight = normalizedWeights.reduce((sum, weight) => sum + weight, 0)

  if (totalWeight === 0) {
    const baseShare = Math.floor(totalTokens / weights.length)
    const remainder = totalTokens % weights.length
    return weights.map((_, index) => baseShare + (index < remainder ? 1 : 0))
  }

  const rawShares = normalizedWeights.map(weight => (totalTokens * weight) / totalWeight)
  const flooredShares = rawShares.map(share => Math.floor(share))
  let remainder = totalTokens - flooredShares.reduce((sum, share) => sum + share, 0)

  const rankedRemainders = rawShares
    .map((share, index) => ({ index, remainder: share - flooredShares[index]! }))
    .sort((a, b) => {
      if (b.remainder !== a.remainder) {
        return b.remainder - a.remainder
      }
      return a.index - b.index
    })

  for (let i = 0; i < rankedRemainders.length && remainder > 0; i++) {
    const ranked = rankedRemainders[i]
    if (!ranked) continue
    flooredShares[ranked.index] = (flooredShares[ranked.index] ?? 0) + 1
    remainder -= 1
  }

  return flooredShares
}

export function normalizeUsage(
  usage: OaiChatCompletionUsage | undefined,
): NormalizedUsage {
  const promptTokens = usage?.prompt_tokens ?? null
  const completionTokens = usage?.completion_tokens ?? null
  const totalTokens = usage?.total_tokens ?? null
  const reasoningTokens = usage?.reasoning_tokens
    ?? usage?.completion_tokens_details?.reasoning_tokens
    ?? null

  return {
    promptTokens,
    completionTokens,
    reasoningTokens,
    totalTokens,
    assistantContentTokens: completionTokens == null
      ? null
      : Math.max(0, completionTokens - (reasoningTokens ?? 0)),
  }
}

export function normalizeUsageFromResponse(
  response: Pick<OaiChatCompletionResponse, 'usage'>,
): NormalizedUsage {
  return normalizeUsage(response.usage)
}

export function deriveExactUserTokenMetadata(
  promptTokens: number | null,
  includedPreludeParts: PartRecord[],
): TokenMetadata {
  if (promptTokens == null) {
    return {
      count: null,
      source: 'unknown',
      confidence: 'unknown',
      note: 'Prompt token total was not returned by the backend',
    }
  }

  const preludeTokenCounts = includedPreludeParts.map(part => part.tokens.count)
  if (preludeTokenCounts.some(count => count == null)) {
    return {
      count: null,
      source: 'unknown',
      confidence: 'unknown',
      note: 'Cannot derive exact user tokens until all included prelude parts have exact token counts',
    }
  }

  const preludeTotal = preludeTokenCounts.reduce<number>((sum, count) => sum + (count ?? 0), 0)
  return deriveExactDeltaTokenMetadata(
    promptTokens,
    preludeTotal,
    'Derived as prompt_tokens minus exact included prelude token counts',
    'Cannot derive exact user tokens until all included prelude parts have exact token counts',
  )
}
