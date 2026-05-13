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
  createSessionRecord,
  insertPartRecord,
  insertRawExchangeRecord,
  insertRoundRecord,
  insertTurnRecord,
} from '../persistence/repository.js'

function createUuid(): string {
  return crypto.randomUUID()
}

export function importTraceBundle(
  database: BackendDatabase,
  trace: SessionTraceBundle,
): SessionRecord {
  const sessionId = createUuid()
  const turnIdBySource = new Map(trace.turns.map(turn => [turn.id, createUuid()]))
  const roundIdBySource = new Map(trace.rounds.map(round => [round.id, createUuid()]))
  const partIdBySource = new Map(trace.parts.map(part => [part.id, createUuid()]))

  const session: SessionRecord = {
    ...trace.session,
    id: sessionId,
  }

  const turns: TurnRecord[] = trace.turns.map(turn => ({
    ...turn,
    id: turnIdBySource.get(turn.id) ?? createUuid(),
    sessionId,
  }))

  const rounds: RoundRecord[] = trace.rounds.map(round => ({
    ...round,
    id: roundIdBySource.get(round.id) ?? createUuid(),
    turnId: turnIdBySource.get(round.turnId) ?? createUuid(),
  }))

  const parts: PartRecord[] = trace.parts.map(part => ({
    ...part,
    id: partIdBySource.get(part.id) ?? createUuid(),
    sessionId,
    turnId: part.turnId ? (turnIdBySource.get(part.turnId) ?? null) : null,
    roundId: part.roundId ? (roundIdBySource.get(part.roundId) ?? null) : null,
    parentPartId: part.parentPartId ? (partIdBySource.get(part.parentPartId) ?? null) : null,
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
