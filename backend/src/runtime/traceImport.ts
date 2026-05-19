import type { BackendDatabase } from '../persistence/db.js'
import type {
  PartRecord,
  RawExchangeRecord,
  RoundRecord,
  SessionRecord,
  TurnRecord,
} from '../domain/model.js'
import type { SessionTraceBundle } from '../domain/trace.js'
import {
  formatPartId,
  formatRoundId,
  formatSetupPartId,
  formatTurnId,
  generateUniqueSessionId,
} from '../domain/hierarchicalIds.js'
import {
  createSessionRecord,
  insertPartRecord,
  insertRawExchangeRecord,
  insertRoundRecord,
  insertTurnRecord,
} from '../persistence/repository.js'

function createUuid(): string {
  return crypto.randomUUID()
}

function normalizeImportedSession(session: SessionRecord): SessionRecord {
  if (session.initStatus !== 'initializing') return session
  return {
    ...session,
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

export function importTraceBundle(
  database: BackendDatabase,
  trace: SessionTraceBundle,
): SessionRecord {
  const sessionId = generateUniqueSessionId(
    candidate => database.connection
      .prepare('SELECT 1 FROM sessions WHERE id = ?')
      .get(candidate) != null,
    3,
  ) ?? createUuid()
  const normalizedAt = Date.now()

  const sortedSourceTurns = [...trace.turns].sort((a, b) => a.sequenceNumber - b.sequenceNumber)
  const turnIdBySource = new Map(sortedSourceTurns.map(turn => [turn.id, formatTurnId(sessionId, turn.sequenceNumber)]))
  const roundIdBySource = new Map(trace.rounds.map(round => {
    const mappedTurn = trace.turns.find(turn => turn.id === round.turnId)
    const turnSequence = mappedTurn?.sequenceNumber ?? 0
    return [round.id, formatRoundId(sessionId, turnSequence, round.roundIndex + 1)] as const
  }))

  const partIdBySource = new Map<string, string>()
  const preludeParts = trace.parts
    .filter(part => part.turnId === null)
    .sort((a, b) => a.ordinal - b.ordinal)
  preludeParts.forEach((part, index) => {
    partIdBySource.set(part.id, formatSetupPartId(sessionId, index + 1, part.partType))
  })

  const roundPartsBySource = new Map<string, typeof trace.parts>()
  for (const part of trace.parts.filter(p => p.roundId !== null)) {
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

  const session: SessionRecord = normalizeImportedSession({
    ...trace.session,
    id: sessionId,
  })

  const turns: TurnRecord[] = trace.turns.map(turn => normalizeImportedTurn({
    ...turn,
    id: turnIdBySource.get(turn.id) ?? formatTurnId(sessionId, turn.sequenceNumber),
    sessionId,
  }, normalizedAt))

  const rounds: RoundRecord[] = trace.rounds.map(round => normalizeImportedRound({
    ...round,
    id: roundIdBySource.get(round.id) ?? formatRoundId(sessionId, 0, round.roundIndex + 1),
    turnId: turnIdBySource.get(round.turnId) ?? formatTurnId(sessionId, 0),
  }, normalizedAt))

  const parts: PartRecord[] = trace.parts.map(part => ({
    ...part,
    id: partIdBySource.get(part.id) ?? formatPartId(sessionId, 0, 0, 1, part.partType),
    sessionId,
    turnId: part.turnId ? (turnIdBySource.get(part.turnId) ?? null) : null,
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
    turns.forEach(turn => insertTurnRecord(database.connection, turn))
    rounds.forEach(round => insertRoundRecord(database.connection, round))
    parts.forEach(part => insertPartRecord(database.connection, part))
    rawExchanges.forEach(exchange => insertRawExchangeRecord(database.connection, exchange))
  })

  tx()

  return session
}
