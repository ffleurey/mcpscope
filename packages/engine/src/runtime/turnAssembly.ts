import type { PartRecord, SessionRecord } from '../domain/model.js'
import type { AssistantSegment, OaiChatCompletionResponse } from '../services/openai/client.js'
import { StreamReadError } from '../services/openai/client.js'
import { formatPartId } from '../domain/hierarchicalIds.js'
import { allocateProportionalTokenCounts } from '../domain/tokenAccounting.js'
import { estimateTokensFromText } from '../services/provider/index.js'

/**
 * Shared turn-assembly helpers extracted from toolTurns.ts and modelTurns.ts.
 *
 * Both the tool-enabled pipeline (tool-call round + final-response paths) and the
 * model-only pipeline walk `streamedCompletion.segments`, build `assistant-reasoning`
 * and `assistant-content` PartRecords with sequential `partNumber`/`ordinal` counters,
 * and derive per-segment token metadata (exact-vs-estimated, single-vs-proportional).
 * This module unifies that logic so the three sites share one implementation.
 *
 * It is strictly DOWNSTREAM of `segmentsFromCompletion` (streamedCompletion.ts), which
 * remains the single source for mapping a completion to segments.
 */

export type SegmentTokenMetadata = {
  count: number | null
  source: PartRecord['tokens']['source']
  confidence: PartRecord['tokens']['confidence']
  note: string | null
  provenanceJson: unknown
}

/** Trims whitespace-only segment text to null; otherwise returns the original text. */
export function normalizeSegmentText(text: string): string | null {
  return text.trim().length > 0 ? text : null
}

/** Extracts the non-empty reasoning segment texts, in segment order. */
export function extractReasoningSegmentTexts(segments: AssistantSegment[]): string[] {
  return segments
    .filter(
      (segment): segment is { kind: 'reasoning'; text: string } => segment.kind === 'reasoning',
    )
    .map((segment) => normalizeSegmentText(segment.text))
    .filter((text): text is string => text !== null)
}

/** Extracts the non-empty assistant-content segment texts, in segment order. */
export function extractContentSegmentTexts(segments: AssistantSegment[]): string[] {
  return segments
    .filter((segment): segment is { kind: 'content'; text: string } => segment.kind === 'content')
    .map((segment) => normalizeSegmentText(segment.text))
    .filter((text): text is string => text !== null)
}

/**
 * Recover a final answer that a model emitted in the reasoning channel.
 *
 * Interleaved-thinking models (e.g. Kimi K2.5) can deliver their final
 * user-facing answer as reasoning (`reasoning_content` / `reasoning` /
 * `<think>`) with empty `content`. On a clean final round that leaves the turn
 * with an assistant answer of nothing while the answer sits in reasoning —
 * which compaction then strips and a judge scores as "no answer". When a final
 * round has reasoning text but no assistant content, surface the reasoning as
 * the answer too by appending a synthesized content segment, so the answer is
 * retained and scored. (Its token share resolves to ~0 because the cost was
 * already counted as reasoning tokens — see deriveAssistantContentTokenMetadata.)
 *
 * Only call this for a clean final round (finish_reason 'stop'); a truncated or
 * intermediate tool-call round legitimately carries reasoning without content.
 */
export function recoverAnswerFromReasoning(segments: AssistantSegment[]): {
  segments: AssistantSegment[]
  recovered: boolean
} {
  if (extractContentSegmentTexts(segments).length > 0) return { segments, recovered: false }
  const reasoning = extractReasoningSegmentTexts(segments).join('\n\n')
  if (reasoning.length === 0) return { segments, recovered: false }
  return { segments: [...segments, { kind: 'content', text: reasoning }], recovered: true }
}

/**
 * Derives per-segment token metadata for the reasoning parts of one round.
 *
 * Decision tree (reference: toolTurns.buildReasoningPartsFromSegments):
 * - No segments → [].
 * - reasoningTokens unknown:
 *     - single segment → estimated from text length (4 chars/token heuristic).
 *     - multiple segments → estimated total allocated proportionally by text length.
 * - reasoningTokens known (exact):
 *     - single segment → exact-api / exact.
 *     - multiple segments → exact total allocated proportionally by text length.
 */
export function deriveReasoningTokenMetadata(
  reasoningSegments: string[],
  reasoningTokens: number | null,
): SegmentTokenMetadata[] {
  if (reasoningSegments.length === 0) {
    return []
  }

  if (reasoningTokens == null) {
    if (reasoningSegments.length === 1) {
      return [
        {
          count: estimateTokensFromText(reasoningSegments[0]!),
          source: 'estimated',
          confidence: 'estimated',
          note: 'Estimated from thinking text length (4 chars/token heuristic)',
          provenanceJson: {
            derivedFrom: 'estimated-from-text-length',
          },
        },
      ]
    }
    return allocateProportionalTokenCounts(
      reasoningSegments.reduce((sum, text) => sum + estimateTokensFromText(text), 0),
      reasoningSegments.map((text) => Math.max(1, text.length)),
    ).map((count) => ({
      count,
      source: 'estimated',
      confidence: 'estimated',
      note: 'Estimated from thinking text length and allocated proportionally',
      provenanceJson: {
        derivedFrom: 'estimated-from-text-length',
        allocation: 'proportional-by-payload',
      },
    }))
  }

  if (reasoningSegments.length === 1) {
    return [
      {
        count: reasoningTokens,
        source: 'exact-api',
        confidence: 'exact',
        note: null,
        provenanceJson: {
          derivedFrom: 'completion.usage.reasoning_tokens',
        },
      },
    ]
  }
  return allocateProportionalTokenCounts(
    reasoningTokens,
    reasoningSegments.map((text) => Math.max(1, text.length)),
  ).map((count) => ({
    count,
    source: 'estimated',
    confidence: 'estimated',
    note: 'Allocated proportionally from the exact round reasoning token total',
    provenanceJson: {
      derivedFrom: 'completion.usage.reasoning_tokens',
      allocation: 'proportional-by-payload',
    },
  }))
}

/**
 * Derives per-segment token metadata for the assistant-content parts of one round.
 *
 * Decision tree (reference: toolTurns.allocateAssistantContentTokenMetadata):
 * - No segments → [].
 * - assistantContentTokens unknown → per-segment unknown metadata.
 * - single segment → exact-api / exact.
 * - multiple segments → exact total allocated proportionally by text length.
 */
export function deriveAssistantContentTokenMetadata(
  contentSegments: string[],
  assistantContentTokens: number | null,
): SegmentTokenMetadata[] {
  if (contentSegments.length === 0) {
    return []
  }

  if (assistantContentTokens == null) {
    return contentSegments.map(() => ({
      count: null,
      source: 'unknown' as const,
      confidence: 'unknown' as const,
      note: 'Completion usage not returned by the backend',
      provenanceJson: null,
    }))
  }

  if (contentSegments.length === 1) {
    return [
      {
        count: assistantContentTokens,
        source: 'exact-api',
        confidence: 'exact',
        note: null,
        provenanceJson: {
          derivedFrom: 'completion.usage.completion_tokens - completion.usage.reasoning_tokens',
        },
      },
    ]
  }

  return allocateProportionalTokenCounts(
    assistantContentTokens,
    contentSegments.map((text) => Math.max(1, text.length)),
  ).map((count) => ({
    count,
    source: 'estimated' as const,
    confidence: 'estimated' as const,
    note: 'Allocated proportionally from the exact assistant content token total',
    provenanceJson: {
      derivedFrom: 'completion.usage.completion_tokens - completion.usage.reasoning_tokens',
      allocation: 'proportional-by-payload',
    },
  }))
}

function buildReasoningPart(
  session: SessionRecord,
  id: string,
  turnId: string,
  roundId: string,
  ordinal: number,
  text: string,
  metadata: SegmentTokenMetadata | undefined,
  createdAt: number,
): PartRecord {
  return {
    id,
    sessionId: session.id,
    turnId,
    roundId,
    parentPartId: null,
    ordinal,
    partType: 'assistant-reasoning',
    roleLabel: 'assistant',
    payload: {
      text,
      json: null,
      mimeType: 'text/plain',
      summary: null,
    },
    display: {
      state: 'transcript',
      collapsedByDefault: true,
    },
    context: {
      state: 'included',
      note: 'Reasoning preserved in context for this turn; compaction will strip it after turn completion',
      strippedByCompactionAtTurnId: null,
    },
    tokens: {
      count: metadata?.count ?? null,
      source: metadata?.source ?? 'unknown',
      confidence: metadata?.confidence ?? 'unknown',
      note: metadata?.note ?? null,
    },
    provenanceJson: metadata?.provenanceJson ?? null,
    createdAt,
    updatedAt: createdAt,
  }
}

function buildContentPart(
  session: SessionRecord,
  id: string,
  turnId: string,
  roundId: string,
  ordinal: number,
  text: string,
  metadata: SegmentTokenMetadata | undefined,
  contextNote: string,
  createdAt: number,
): PartRecord {
  return {
    id,
    sessionId: session.id,
    turnId,
    roundId,
    parentPartId: null,
    ordinal,
    partType: 'assistant-content',
    roleLabel: 'assistant',
    payload: {
      text,
      json: null,
      mimeType: 'text/plain',
      summary: null,
    },
    display: {
      state: 'transcript',
      collapsedByDefault: false,
    },
    context: {
      state: 'included',
      note: contextNote,
      strippedByCompactionAtTurnId: null,
    },
    tokens: {
      count: metadata?.count ?? null,
      source: metadata?.source ?? 'unknown',
      confidence: metadata?.confidence ?? 'unknown',
      note: metadata?.note ?? null,
    },
    provenanceJson: metadata?.provenanceJson ?? null,
    createdAt,
    updatedAt: createdAt,
  }
}

export interface CommitSegmentsToPartsInput {
  session: SessionRecord
  turnId: string
  turnNumber: number
  roundNumber: number
  roundId: string
  ownerStepId: string | null
  segments: AssistantSegment[]
  /** Exact reasoning token total for the round, or null when not reported. */
  reasoningTokens: number | null
  /** Pre-computed assistant-content token metadata, aligned with content segments in order. */
  contentTokenMetadata: SegmentTokenMetadata[]
  /** Context note applied to every assistant-content part. */
  contentContextNote: string
  /** Starting `ordinal` for the first emitted part. */
  initialOrdinal: number
  /** Starting `partNumber` (round part sequence) for the first emitted part. */
  initialPartNumber: number
  createdAt: number
  /**
   * Invoked for each tool-call segment, in segment order, with the current
   * partNumber/ordinal counters. Returning a PartRecord both appends it to the
   * output and consumes one partNumber + ordinal; returning null skips the
   * segment without consuming counters. Omit entirely for tool-call-free paths.
   */
  onToolCallSegment?: (
    segment: Extract<AssistantSegment, { kind: 'tool-call' }>,
    partNumber: number,
    ordinal: number,
  ) => PartRecord | null
}

export interface CommitSegmentsToPartsResult {
  /** Parts in segment order: reasoning, content, and any tool-call parts the caller produced. */
  parts: PartRecord[]
  /** The next free ordinal after all emitted parts. */
  nextOrdinal: number
  /** The next free partNumber after all emitted parts. */
  nextPartNumber: number
}

/**
 * Walks `segments` in order and builds reasoning + assistant-content PartRecords with
 * sequential ids (`formatPartId`), ordinals, and partNumbers, applying the supplied
 * reasoning/content token metadata. Tool-call segments are delegated to
 * `onToolCallSegment` so the tool-enabled pipeline can interleave its tool-call parts
 * with the same counter sequence.
 *
 * This replaces the three duplicated segment-walk + PartRecord-construction sites.
 */
export function commitSegmentsToParts(
  input: CommitSegmentsToPartsInput,
): CommitSegmentsToPartsResult {
  const reasoningMetadata = deriveReasoningTokenMetadata(
    extractReasoningSegmentTexts(input.segments),
    input.reasoningTokens,
  )

  const parts: PartRecord[] = []
  let ordinal = input.initialOrdinal
  let partNumber = input.initialPartNumber
  let reasoningIndex = 0
  let contentIndex = 0

  for (const segment of input.segments) {
    if (segment.kind === 'reasoning') {
      const text = normalizeSegmentText(segment.text)
      if (!text) {
        continue
      }
      const metadata = reasoningMetadata[reasoningIndex++]
      parts.push(
        buildReasoningPart(
          input.session,
          formatPartId(
            input.session.id,
            input.turnNumber,
            input.roundNumber,
            partNumber++,
            'assistant-reasoning',
            input.ownerStepId,
          ),
          input.turnId,
          input.roundId,
          ordinal++,
          text,
          metadata,
          input.createdAt,
        ),
      )
      continue
    }

    if (segment.kind === 'content') {
      const text = normalizeSegmentText(segment.text)
      if (!text) {
        continue
      }
      const metadata = input.contentTokenMetadata[contentIndex++]
      parts.push(
        buildContentPart(
          input.session,
          formatPartId(
            input.session.id,
            input.turnNumber,
            input.roundNumber,
            partNumber++,
            'assistant-content',
            input.ownerStepId,
          ),
          input.turnId,
          input.roundId,
          ordinal++,
          text,
          metadata,
          input.contentContextNote,
          input.createdAt,
        ),
      )
      continue
    }

    if (input.onToolCallSegment) {
      const toolCallPart = input.onToolCallSegment(segment, partNumber, ordinal)
      if (toolCallPart) {
        parts.push(toolCallPart)
        partNumber++
        ordinal++
      }
    }
  }

  return { parts, nextOrdinal: ordinal, nextPartNumber: partNumber }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stream-failure recovery
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildDiagnosticNotePartInput {
  session: SessionRecord
  turnId: string
  turnNumber: number
  roundNumber: number
  roundId: string
  ownerStepId: string | null
  partNumber: number
  ordinal: number
  text: string
  summary: string
  createdAt: number
  provenanceJson?: unknown
}

/**
 * Builds a `diagnostic-note` part: a system-authored note that renders in the
 * transcript (so operators see it without drilling into raw traces) but is
 * excluded from model context (so it never leaks into subsequent prompts).
 * Mirrors the tool-loop-limit diagnostic in toolTurns.ts — the one existing
 * precedent for surfacing a turn-level failure this way.
 */
export function buildDiagnosticNotePart(input: BuildDiagnosticNotePartInput): PartRecord {
  return {
    id: formatPartId(
      input.session.id,
      input.turnNumber,
      input.roundNumber,
      input.partNumber,
      'diagnostic-note',
      input.ownerStepId,
    ),
    sessionId: input.session.id,
    turnId: input.turnId,
    roundId: input.roundId,
    parentPartId: null,
    ordinal: input.ordinal,
    partType: 'diagnostic-note',
    roleLabel: 'system',
    payload: {
      text: input.text,
      json: null,
      mimeType: 'text/plain',
      summary: input.summary,
    },
    display: {
      state: 'transcript',
      collapsedByDefault: false,
    },
    context: {
      state: 'excluded',
      note: 'Error diagnostic — not included in model context',
      strippedByCompactionAtTurnId: null,
    },
    tokens: {
      count: null,
      source: 'unknown',
      confidence: 'unknown',
      note: null,
    },
    provenanceJson: input.provenanceJson ?? null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  }
}

/**
 * Normalizes a caught exception into the shape stream-failure recovery needs:
 * a human-readable message, the byte count received before failure (when
 * known), whatever assistant segments were already streamed, and the
 * best-effort completion reconstructed from those bytes (for the round's
 * trace). A `StreamReadError` (thrown by client.ts on a mid-stream read
 * failure) carries all of these; any other error degrades to message-only
 * with no recoverable content.
 */
export function describeStreamFailure(err: unknown): {
  message: string
  receivedBytes: number | null
  segments: AssistantSegment[]
  completion: OaiChatCompletionResponse | null
  errorType: 'internal' | 'aborted' | 'provider_unreachable'
} {
  const errorType = classifyStreamError(err)
  if (err instanceof StreamReadError) {
    return {
      message: err.message,
      receivedBytes: err.receivedBytes,
      segments: err.partial.segments,
      completion: err.partial.completion,
      errorType,
    }
  }
  return {
    message: err instanceof Error ? err.message : String(err),
    receivedBytes: null,
    segments: [],
    completion: null,
    errorType,
  }
}

/**
 * Classify a stream/request error into a typed error category.
 * Distinguishes user-requested abort from provider-unreachable from generic internal failures.
 */
function classifyStreamError(err: unknown): 'internal' | 'aborted' | 'provider_unreachable' {
  // Check for abort: either a DOMException with name 'AbortError', or wrapped
  // inside a StreamReadError's cause.
  const candidate =
    err instanceof StreamReadError ? ((err as { cause?: unknown }).cause ?? err) : err
  const name =
    candidate instanceof DOMException ||
    (typeof candidate === 'object' && candidate !== null && 'name' in candidate)
      ? (candidate as { name: string }).name
      : undefined
  if (name === 'AbortError') return 'aborted'

  // Check for provider-unreachable: connection refused, DNS failure, timeout,
  // fetch network errors.
  const message = err instanceof Error ? err.message : String(err ?? '')
  const lowerMessage = message.toLowerCase()
  if (
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('fetch failed') ||
    lowerMessage.includes('enotfound') ||
    lowerMessage.includes('econnreset') ||
    lowerMessage.includes('etimedout') ||
    lowerMessage.includes('network error') ||
    lowerMessage.includes('getaddrinfo') ||
    lowerMessage.includes('und_err_') ||
    lowerMessage.includes('request timed out')
  ) {
    return 'provider_unreachable'
  }

  return 'internal'
}

export interface StreamFailureRecoveryInput {
  session: SessionRecord
  turnId: string
  turnNumber: number
  roundNumber: number
  roundId: string
  ownerStepId: string | null
  /** Whatever assistant segments were captured before the failure (possibly empty). */
  segments: AssistantSegment[]
  message: string
  receivedBytes: number | null
  initialOrdinal: number
  initialPartNumber: number
  createdAt: number
}

/**
 * Turns a failed round into whatever can be salvaged from it: PartRecords for
 * any reasoning/content the model already streamed (same builder the success
 * path uses, so a recovered part is indistinguishable from a normal one other
 * than its token-metadata note), plus a trailing diagnostic-note part
 * explaining what happened and whether a retry is needed. Token metadata is
 * always "unknown" here — a partial response has no usage figures from the
 * provider to attribute.
 */
export function buildStreamFailureRecovery(input: StreamFailureRecoveryInput): {
  parts: PartRecord[]
} {
  const contentSegments = extractContentSegmentTexts(input.segments)

  const {
    parts: partialParts,
    nextOrdinal,
    nextPartNumber,
  } = commitSegmentsToParts({
    session: input.session,
    turnId: input.turnId,
    turnNumber: input.turnNumber,
    roundNumber: input.roundNumber,
    roundId: input.roundId,
    ownerStepId: input.ownerStepId,
    segments: input.segments,
    reasoningTokens: null,
    contentTokenMetadata: contentSegments.map(() => ({
      count: null,
      source: 'unknown' as const,
      confidence: 'unknown' as const,
      note: 'Turn failed mid-stream; token accounting is unavailable for partial content',
      provenanceJson: null,
    })),
    contentContextNote:
      'Assistant answer recovered from a failed stream; remains part of later model-visible history',
    initialOrdinal: input.initialOrdinal,
    initialPartNumber: input.initialPartNumber,
    createdAt: input.createdAt,
  })

  const byteNote =
    input.receivedBytes != null
      ? ` (received ${input.receivedBytes} bytes before the connection failed)`
      : ''
  const diagnosticText =
    partialParts.length > 0
      ? `Turn failed mid-stream${byteNote}: ${input.message}. The partial response above was preserved — retry the turn for a complete answer.`
      : `Turn failed${byteNote}: ${input.message}.`

  const diagnosticNote = buildDiagnosticNotePart({
    session: input.session,
    turnId: input.turnId,
    turnNumber: input.turnNumber,
    roundNumber: input.roundNumber,
    roundId: input.roundId,
    ownerStepId: input.ownerStepId,
    partNumber: nextPartNumber,
    ordinal: nextOrdinal,
    text: diagnosticText,
    summary: partialParts.length > 0 ? 'Turn failed (partial response preserved)' : 'Turn failed',
    createdAt: input.createdAt,
    provenanceJson: input.receivedBytes != null ? { receivedBytes: input.receivedBytes } : null,
  })

  return { parts: [...partialParts, diagnosticNote] }
}
