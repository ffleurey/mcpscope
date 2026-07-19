import type { PartRecord, SessionRecord } from '../domain/model.js'
import type { AssistantSegment } from '../services/openai/client.js'
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
