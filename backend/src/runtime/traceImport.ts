import type { BackendDatabase } from '../persistence/db.js'
import type {
  PartRecord,
  RawExchangeRecord,
  RoundRecord,
  SessionRecord,
  StepRecord,
  TurnRecord,
} from '../domain/model.js'
import type { SessionTraceBundle } from '../domain/trace.js'
import { stepTypeKey } from '../domain/executionModel.js'
import {
  formatCompactionPartId,
  formatCompactionStepId,
  formatPartId,
  formatRoundId,
  formatSetupPartId,
  formatTurnId,
  generateUniqueSessionId,
  parseHierarchicalId,
} from '../domain/hierarchicalIds.js'
import {
  createSessionRecord,
  insertStepRecord,
  insertPartRecord,
  insertRawExchangeRecord,
  insertRoundRecord,
  insertTurnRecord,
} from '../persistence/repository.js'
import { validateSessionParent } from '../domain/sessionValidation.js'

function createUuid(): string {
  return crypto.randomUUID()
}

function normalizeImportedSession(session: SessionRecord): SessionRecord {
  const normalized: SessionRecord = {
    ...session,
    sessionType: session.sessionType ?? 'primary',
    parentKind: session.parentKind ?? null,
    parentId: session.parentId ?? null,
  }
  const error = validateSessionParent(normalized.sessionType, normalized.parentKind, normalized.parentId)
  if (error) {
    throw new Error(`Invalid imported session metadata: ${error}`)
  }
  if (normalized.initStatus !== 'initializing') return normalized
  return {
    ...normalized,
    initStatus: 'error',
  }
}

function normalizeImportedTurn(turn: TurnRecord, normalizedAt: number): TurnRecord {
  if (turn.status !== 'draft' && turn.status !== 'streaming' && turn.status !== 'awaiting-tools') {
    return turn
  }

  return {
    ...turn,
    status: 'aborted',
    completedAt: turn.completedAt ?? normalizedAt,
    outcome: turn.outcome ?? 'aborted',
  }
}

function normalizeImportedRound(round: RoundRecord, normalizedAt: number): RoundRecord {
  if (round.status !== 'pending' && round.status !== 'streaming') {
    return round
  }

  return {
    ...round,
    status: 'aborted',
    finishReason: round.finishReason ?? 'cancelled',
    completedAt: round.completedAt ?? normalizedAt,
  }
}

function isRedundantCompactionDiagnosticPart(
  part: PartRecord,
  sourceStepById: Map<string, StepRecord>,
): boolean {
  if (part.partType !== 'diagnostic-note' || part.roundId !== null || part.turnId === null) {
    return false
  }

  return sourceStepById.get(part.turnId)?.stepTypeKey === 'compaction'
}

export function importTraceBundle(
  database: BackendDatabase,
  trace: SessionTraceBundle,
): SessionRecord {
  const sessionId = generateUniqueSessionId(
    candidate => database.connection
      .prepare('SELECT 1 FROM v2_sessions WHERE id = ?')
      .get(candidate) != null,
    3,
  ) ?? createUuid()
  const normalizedAt = Date.now()

  const sortedSourceTurns = [...trace.turns].sort((a, b) => a.sequenceNumber - b.sequenceNumber)
  const turnIdBySource = new Map(sortedSourceTurns.map(turn => [turn.id, formatTurnId(sessionId, turn.sequenceNumber)]))
  const sourceSteps = trace.steps.length > 0
    ? [...trace.steps].sort((a, b) => a.ordinal - b.ordinal)
    : sortedSourceTurns.map<StepRecord>(turn => ({
      id: turn.id,
      sessionId: turn.sessionId,
      stepTypeKey: 'turn',
      ordinal: turn.sequenceNumber - 1,
      status: turn.status,
      params: {},
      state: {},
      createdAt: turn.createdAt,
      completedAt: turn.completedAt,
    }))
  const sourceStepById = new Map(sourceSteps.map(step => [step.id, step]))
  const filteredParts = trace.parts.filter(part => !isRedundantCompactionDiagnosticPart(part, sourceStepById))
  const stepIdBySource = new Map<string, string>()
  const compactionStepNumberBySource = new Map<string, number>()
  for (const step of sourceSteps) {
    if (step.stepTypeKey === 'turn') {
      stepIdBySource.set(step.id, turnIdBySource.get(step.id) ?? formatTurnId(sessionId, step.ordinal + 1))
      continue
    }

    if (step.stepTypeKey === 'compaction') {
      const parsed = parseHierarchicalId(step.id)
      const stepNumber = typeof step.params.sourceTurnSequenceNumber === 'number'
        ? step.params.sourceTurnSequenceNumber
        : parsed?.type === 'step' && parsed.stepNumber != null
          ? parsed.stepNumber
          : step.ordinal + 1
      compactionStepNumberBySource.set(step.id, stepNumber)
      stepIdBySource.set(step.id, formatCompactionStepId(sessionId, stepNumber))
      continue
    }

    stepIdBySource.set(step.id, createUuid())
  }
  const roundIdBySource = new Map(trace.rounds.map(round => {
    const mappedTurn = trace.turns.find(turn => turn.id === round.turnId)
    const turnSequence = mappedTurn?.sequenceNumber ?? 0
    return [round.id, formatRoundId(sessionId, turnSequence, round.roundIndex + 1)] as const
  }))

  const partIdBySource = new Map<string, string>()
  const preludeParts = filteredParts
    .filter(part => part.turnId === null)
    .sort((a, b) => a.ordinal - b.ordinal)
  preludeParts.forEach((part, index) => {
    partIdBySource.set(part.id, formatSetupPartId(sessionId, index + 1, part.partType))
  })

  const roundPartsBySource = new Map<string, typeof trace.parts>()
  for (const part of filteredParts.filter(p => p.roundId !== null)) {
    const key = part.roundId as string
    roundPartsBySource.set(key, [...(roundPartsBySource.get(key) ?? []), part])
  }
  for (const [sourceRoundId, parts] of roundPartsBySource.entries()) {
    const mappedRoundId = roundIdBySource.get(sourceRoundId)
    const mappedTurnId = trace.rounds.find(round => round.id === sourceRoundId)?.turnId ?? null
    const turnSequence = trace.turns.find(turn => turn.id === mappedTurnId)?.sequenceNumber ?? 0
    const roundIndex = trace.rounds.find(round => round.id === sourceRoundId)?.roundIndex ?? 0
    if (!mappedRoundId) continue
    parts
      .sort((a, b) => a.ordinal - b.ordinal)
      .forEach((part, index) => {
        partIdBySource.set(part.id, formatPartId(sessionId, turnSequence, roundIndex + 1, index + 1, part.partType))
      })
  }

  const stepPartsBySource = new Map<string, typeof trace.parts>()
  for (const part of filteredParts.filter(p => p.roundId === null && p.turnId !== null && stepIdBySource.has(p.turnId))) {
    const sourceStepId = part.turnId as string
    const sourceStep = sourceStepById.get(sourceStepId)
    if (!sourceStep || sourceStep.stepTypeKey === 'turn') continue
    stepPartsBySource.set(sourceStepId, [...(stepPartsBySource.get(sourceStepId) ?? []), part])
  }
  for (const [sourceStepId, parts] of stepPartsBySource.entries()) {
    const sourceStep = sourceStepById.get(sourceStepId)
    if (!sourceStep || sourceStep.stepTypeKey !== 'compaction') continue
    const stepNumber = compactionStepNumberBySource.get(sourceStepId) ?? sourceStep.ordinal + 1
    parts
      .sort((a, b) => a.ordinal - b.ordinal)
      .forEach((part, index) => {
        partIdBySource.set(part.id, formatCompactionPartId(sessionId, stepNumber, index + 1, part.partType))
      })
  }

  const session: SessionRecord = normalizeImportedSession({
    ...trace.session,
    id: sessionId,
  })

  const turns: TurnRecord[] = trace.turns.map(turn => normalizeImportedTurn({
    ...turn,
    id: turnIdBySource.get(turn.id) ?? formatTurnId(sessionId, turn.sequenceNumber),
    sessionId,
  }, normalizedAt))
  const turnsBySource = new Map(trace.turns.map((turn, index) => [turn.id, turns[index]!]))

  const steps: StepRecord[] = sourceSteps
    .filter(step => step.stepTypeKey !== 'turn')
    .map(step => ({
      ...step,
      id: stepIdBySource.get(step.id) ?? createUuid(),
      sessionId,
      stepTypeKey: stepTypeKey(step.stepTypeKey),
      params: {
        ...step.params,
        sourceTurnId: typeof step.params.sourceTurnId === 'string'
          ? (turnIdBySource.get(step.params.sourceTurnId) ?? step.params.sourceTurnId)
          : step.params.sourceTurnId,
      },
      state: {
        ...step.state,
        strippedPartIds: Array.isArray(step.state.strippedPartIds)
          ? step.state.strippedPartIds.map(value => typeof value === 'string' ? (partIdBySource.get(value) ?? value) : value)
          : step.state.strippedPartIds,
      },
    }))

  const rounds: RoundRecord[] = trace.rounds.map(round => normalizeImportedRound({
    ...round,
    id: roundIdBySource.get(round.id) ?? formatRoundId(sessionId, 0, round.roundIndex + 1),
    turnId: turnIdBySource.get(round.turnId) ?? formatTurnId(sessionId, 0),
  }, normalizedAt))

  const parts: PartRecord[] = filteredParts.map(part => ({
    ...part,
    id: partIdBySource.get(part.id) ?? formatPartId(sessionId, 0, 0, 1, part.partType),
    sessionId,
    turnId: part.turnId ? (stepIdBySource.get(part.turnId) ?? turnIdBySource.get(part.turnId) ?? null) : null,
    roundId: part.roundId ? (roundIdBySource.get(part.roundId) ?? null) : null,
    parentPartId: part.parentPartId ? (partIdBySource.get(part.parentPartId) ?? null) : null,
    context: {
      ...part.context,
      strippedByCompactionAtTurnId: part.context.strippedByCompactionAtTurnId
        ? (turnIdBySource.get(part.context.strippedByCompactionAtTurnId) ?? null)
        : null,
    },
  }))

  const rawExchanges: RawExchangeRecord[] = trace.rawExchanges.map(exchange => ({
    ...exchange,
    id: createUuid(),
    sessionId,
    turnId: exchange.turnId ? (turnIdBySource.get(exchange.turnId) ?? null) : null,
    roundId: exchange.roundId ? (roundIdBySource.get(exchange.roundId) ?? null) : null,
  }))

  const tx = database.connection.transaction(() => {
    createSessionRecord(database.connection, session)

    for (const sourceStep of sourceSteps) {
      if (sourceStep.stepTypeKey === 'turn') {
        const turn = turnsBySource.get(sourceStep.id)
        if (turn) insertTurnRecord(database.connection, turn)
        continue
      }

      const step = steps.find(candidate => candidate.id === stepIdBySource.get(sourceStep.id))
      if (step) {
        insertStepRecord(database.connection, {
          ...step,
          stepTypeKey: stepTypeKey(step.stepTypeKey),
        })
      }
    }

    rounds.forEach(round => insertRoundRecord(database.connection, round))
    parts.forEach(part => insertPartRecord(database.connection, part))
    rawExchanges.forEach(exchange => insertRawExchangeRecord(database.connection, exchange))
  })

  tx()

  return session
}
