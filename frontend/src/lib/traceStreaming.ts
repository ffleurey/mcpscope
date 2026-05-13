import type {
  ContextEntry,
  LmStudioStreamDelta,
  PartRecord,
  RoundRecord,
  SessionRecord,
  SessionTraceBundle,
  TranscriptEntry,
  TurnRecord,
} from './backendTypes'

export interface StreamingToolCallState {
  toolCallIndex: number
  id: string
  name: string
  arguments: string
}

export interface StreamingRoundState {
  turnId: string
  roundId: string
  reasoningText: string
  completedReasoningText: string
  contentText: string
  toolCalls: StreamingToolCallState[]
}

export interface TurnStreamingState {
  sessionId: string
  userContent: string
  turnId: string | null
  rounds: StreamingRoundState[]
}

function sortByIdOrder<T extends { id: string }>(records: T[], nextRecord: T, compare: (left: T, right: T) => number): T[] {
  const withoutCurrent = records.filter((record) => record.id !== nextRecord.id)
  return [...withoutCurrent, nextRecord].sort(compare)
}

function sortParts(parts: PartRecord[]): PartRecord[] {
  return [...parts].sort((left, right) => left.ordinal - right.ordinal)
}

function closeLiveReasoning(roundState: StreamingRoundState): void {
  if (roundState.reasoningText.length === 0) {
    return
  }

  roundState.completedReasoningText = roundState.reasoningText
  roundState.reasoningText = ''
}

export function deriveTranscriptEntries(parts: PartRecord[]): TranscriptEntry[] {
  return sortParts(parts)
    .filter((part) => part.display.state === 'transcript')
    .map((part) => ({
      id: part.id,
      turnId: part.turnId,
      roundId: part.roundId,
      type: part.partType,
      roleLabel: part.roleLabel,
      text: part.payload.text,
      summary: part.payload.summary,
      tokens: part.tokens,
      context: part.context,
    }))
}

export function deriveContextEntries(parts: PartRecord[]): ContextEntry[] {
  return sortParts(parts)
    .filter((part) => part.context.state === 'included' || part.context.state === 'round-only')
    .map((part) => ({
      id: part.id,
      turnId: part.turnId,
      roundId: part.roundId,
      type: part.partType,
      roleLabel: part.roleLabel,
      text: part.payload.text,
      summary: part.payload.summary,
      tokens: part.tokens,
    }))
}

/**
 * Returns the context entries that were present at the END of the given round,
 * before any inter-turn compaction.
 *
 * Includes:
 *  - `included` parts whose ordinal ≤ the last part of the round
 *  - `round-only` parts that belong to this round exactly
 *  - `stripped` parts that were still in context at this round's turn
 *    (i.e. stripped at a later or equal turn)
 */
export function deriveContextSnapshotAtRound(
  allParts: PartRecord[],
  roundId: string,
  allTurns: TurnRecord[],
): ContextEntry[] {
  const sorted = sortParts(allParts)
  const roundParts = sorted.filter((p) => p.roundId === roundId)
  if (roundParts.length === 0) return []

  const maxOrdinal = roundParts.at(-1)!.ordinal
  const roundTurnId = roundParts[0].turnId
  const turnSeqById = new Map(allTurns.map((t) => [t.id, t.sequenceNumber]))
  const roundTurnSeq = roundTurnId !== null ? (turnSeqById.get(roundTurnId) ?? -1) : -1

  return sorted
    .filter((p) => p.ordinal <= maxOrdinal)
    .filter((p) => {
      if (p.context.state === 'included') return true
      if (p.context.state === 'round-only') return p.roundId === roundId
      if (p.context.state === 'stripped') {
        const strippedAt = p.context.strippedByCompactionAtTurnId
        if (strippedAt === null) return true
        const strippedAtSeq = turnSeqById.get(strippedAt) ?? -1
        // Part was in context during turns whose seq ≤ strippedAtSeq.
        // Our round is in a turn with seq = roundTurnSeq.
        return roundTurnSeq <= strippedAtSeq
      }
      return false
    })
    .map((p) => ({
      id: p.id,
      turnId: p.turnId,
      roundId: p.roundId,
      type: p.partType,
      roleLabel: p.roleLabel,
      text: p.payload.text,
      summary: p.payload.summary,
      tokens: p.tokens,
    }))
}

function withDerivedEntries(trace: SessionTraceBundle): SessionTraceBundle {
  const sortedParts = sortParts(trace.parts)
  return {
    ...trace,
    parts: sortedParts,
    transcript: deriveTranscriptEntries(sortedParts),
    context: deriveContextEntries(sortedParts),
  }
}

export function createEmptyTrace(session: SessionRecord): SessionTraceBundle {
  return {
    session,
    turns: [],
    rounds: [],
    parts: [],
    rawExchanges: [],
    transcript: [],
    context: [],
  }
}

export function upsertTurn(trace: SessionTraceBundle, turn: TurnRecord): SessionTraceBundle {
  return {
    ...trace,
    turns: sortByIdOrder(trace.turns, turn, (left, right) => left.sequenceNumber - right.sequenceNumber),
  }
}

export function upsertRound(trace: SessionTraceBundle, round: RoundRecord): SessionTraceBundle {
  return {
    ...trace,
    rounds: sortByIdOrder(trace.rounds, round, (left, right) => {
      if (left.turnId === right.turnId) {
        return left.roundIndex - right.roundIndex
      }
      return left.startedAt - right.startedAt
    }),
  }
}

export function upsertPart(trace: SessionTraceBundle, part: PartRecord): SessionTraceBundle {
  return withDerivedEntries({
    ...trace,
    parts: sortByIdOrder(trace.parts, part, (left, right) => left.ordinal - right.ordinal),
  })
}

export function insertStreamingUserPart(
  trace: SessionTraceBundle,
  input: {
    turnId: string
    roundId: string
    userContent: string
    createdAt: number
  },
): SessionTraceBundle {
  const alreadyPresent = trace.parts.some((part) => part.turnId === input.turnId && part.partType === 'user-message')
  if (alreadyPresent) {
    return trace
  }

  const nextOrdinal = trace.parts.reduce((maxOrdinal, part) => Math.max(maxOrdinal, part.ordinal), -1) + 1
  const userPart: PartRecord = {
    id: `stream-user-${input.turnId}`,
    sessionId: trace.session.id,
    turnId: input.turnId,
    roundId: input.roundId,
    parentPartId: null,
    ordinal: nextOrdinal,
    partType: 'user-message',
    roleLabel: 'user',
    payload: {
      text: input.userContent,
      json: null,
      mimeType: null,
      summary: null,
    },
    display: {
      state: 'transcript',
      collapsedByDefault: false,
    },
    context: {
      state: 'included',
      note: null,
      strippedByCompactionAtTurnId: null,
    },
    tokens: {
      count: null,
      source: 'unknown',
      confidence: 'unknown',
      note: 'Prompt split not derived yet',
    },
    provenanceJson: {
      derivedFrom: 'frontend.stream.placeholder',
    },
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  }

  return upsertPart(trace, userPart)
}

export function createTurnStreamingState(sessionId: string, userContent: string): TurnStreamingState {
  return {
    sessionId,
    userContent,
    turnId: null,
    rounds: [],
  }
}

export function bindStreamingTurnId(
  state: TurnStreamingState | null,
  turnId: string,
): TurnStreamingState | null {
  return state ? { ...state, turnId } : state
}

export function applyStreamingDelta(
  state: TurnStreamingState | null,
  turnId: string,
  roundId: string,
  delta: LmStudioStreamDelta,
): TurnStreamingState | null {
  if (!state) {
    return state
  }

  const roundStates = [...state.rounds]
  const currentIndex = roundStates.findIndex((round) => round.roundId === roundId)
  const currentRound = currentIndex >= 0
    ? {
        ...roundStates[currentIndex],
        toolCalls: [...(roundStates[currentIndex]?.toolCalls ?? [])],
      }
    : {
        turnId,
        roundId,
        reasoningText: '',
        completedReasoningText: '',
        contentText: '',
        toolCalls: [],
      }

  if (delta.kind === 'reasoning') {
    currentRound.reasoningText = `${currentRound.reasoningText}${delta.textDelta}`
  } else if (delta.kind === 'content') {
    closeLiveReasoning(currentRound)
    currentRound.contentText = `${currentRound.contentText}${delta.textDelta}`
  } else {
    closeLiveReasoning(currentRound)
    const nextToolCalls = [...currentRound.toolCalls]
    const toolCallIndex = nextToolCalls.findIndex((toolCall) => toolCall.toolCallIndex === delta.toolCallIndex)
    const currentToolCall = toolCallIndex >= 0
      ? { ...nextToolCalls[toolCallIndex] }
      : {
          toolCallIndex: delta.toolCallIndex,
          id: '',
          name: '',
          arguments: '',
        }

    currentToolCall.id = `${currentToolCall.id}${delta.idDelta ?? ''}`
    currentToolCall.name = `${currentToolCall.name}${delta.nameDelta ?? ''}`
    currentToolCall.arguments = `${currentToolCall.arguments}${delta.argumentsDelta ?? ''}`

    if (toolCallIndex >= 0) {
      nextToolCalls[toolCallIndex] = currentToolCall
    } else {
      nextToolCalls.push(currentToolCall)
      nextToolCalls.sort((left, right) => left.toolCallIndex - right.toolCallIndex)
    }

    currentRound.toolCalls = nextToolCalls
  }

  if (currentIndex >= 0) {
    roundStates[currentIndex] = currentRound
  } else {
    roundStates.push(currentRound)
  }

  return {
    ...state,
    turnId: state.turnId ?? turnId,
    rounds: roundStates,
  }
}

export function clearCommittedStreamingDelta(
  state: TurnStreamingState | null,
  part: PartRecord,
): TurnStreamingState | null {
  if (!state || !part.roundId) {
    return state
  }

  const roundStates = state.rounds
    .map((roundState) => {
      if (roundState.roundId !== part.roundId) {
        return roundState
      }

      if (part.partType === 'assistant-reasoning') {
        return {
          ...roundState,
          reasoningText: '',
          completedReasoningText: '',
        }
      }

      if (part.partType === 'assistant-content') {
        return {
          ...roundState,
          contentText: '',
        }
      }

      if (part.partType === 'tool-call') {
        return {
          ...roundState,
          toolCalls: [],
        }
      }

      if (part.partType === 'tool-result') {
        return {
          ...roundState,
          toolCalls: [],
        }
      }

      return roundState
    })
    .filter((roundState) => (
      roundState.reasoningText.length > 0
      || roundState.completedReasoningText.length > 0
      || roundState.contentText.length > 0
      || roundState.toolCalls.length > 0
    ))

  return {
    ...state,
    rounds: roundStates,
  }
}

export function clearRoundStreamingState(
  state: TurnStreamingState | null,
  roundId: string,
): TurnStreamingState | null {
  if (!state) {
    return state
  }

  return {
    ...state,
    rounds: state.rounds.filter((roundState) => roundState.roundId !== roundId),
  }
}
