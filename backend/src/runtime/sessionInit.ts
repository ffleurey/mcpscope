import type { PartRecord } from '../domain/model.js'
import {
  getSessionRecord,
  listPartRecordsBySession,
  listRawExchangeRecordsBySession,
  listRoundRecordsBySession,
  listTurnRecordsBySession,
  updateSessionRecord,
} from '../persistence/repository.js'
import { buildSessionTraceBundle } from '../domain/trace.js'
import { deriveContextEntries, deriveTranscriptEntries } from '../domain/selectors.js'
import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from './modelTurns.js'
import type { McpGateway } from './toolTurns.js'
import { ensureMcpContext } from './toolTurns.js'
import { ensureSessionPreludeTokenMetadata } from './sessionPrelude.js'

function now(): number {
  return Date.now()
}

export type PreludeStreamEvent =
  | { type: 'part-committed'; part: PartRecord }
  | { type: 'prelude-complete'; trace: ReturnType<typeof buildSessionTraceBundle> }
  | { type: 'prelude-failed'; message: string }

export async function runSessionInitialization(
  database: BackendDatabase,
  lmStudioGateway: LmStudioGateway,
  mcpGateway: McpGateway,
  sessionId: string,
  emitEvent: (event: PreludeStreamEvent) => void,
): Promise<void> {
  const session = getSessionRecord(database.connection, sessionId)

  if (!session) {
    emitEvent({ type: 'prelude-failed', message: `Session ${sessionId} not found` })
    return
  }

  // If already initialized, just emit the existing parts and trace
  if (session.initStatus === 'ready') {
    const parts = listPartRecordsBySession(database.connection, sessionId)
    for (const part of parts.filter(p => p.turnId === null)) {
      emitEvent({ type: 'part-committed', part })
    }
    const trace = buildSessionTraceBundle({
      session,
      turns: listTurnRecordsBySession(database.connection, sessionId),
      rounds: listRoundRecordsBySession(database.connection, sessionId),
      parts,
      rawExchanges: listRawExchangeRecordsBySession(database.connection, sessionId),
      transcript: deriveTranscriptEntries(parts),
      context: deriveContextEntries(parts),
    })
    emitEvent({ type: 'prelude-complete', trace })
    return
  }

  // Mark as initializing
  session.initStatus = 'initializing'
  session.updatedAt = now()
  updateSessionRecord(database.connection, session)

  // Emit existing parts (system prompt was created during createSession)
  let parts = listPartRecordsBySession(database.connection, sessionId)
  for (const part of parts.filter(p => p.turnId === null)) {
    emitEvent({ type: 'part-committed', part })
  }

  // MCP setup: initializes MCP session + creates mcp-instructions + tool-definitions parts
  if (session.mcpProfileSnapshot) {
    await ensureMcpContext(database, session, mcpGateway)
    parts = listPartRecordsBySession(database.connection, sessionId)
    for (const part of parts.filter(p => p.turnId === null)) {
      emitEvent({ type: 'part-committed', part })
    }
  }

  // Token probing: context length + system prompt tokens + MCP/tool-definition tokens
  const probedParts = await ensureSessionPreludeTokenMetadata(database, lmStudioGateway, session, parts)
  // Emit updated parts (now have token counts filled in)
  for (const part of probedParts.filter(p => p.turnId === null)) {
    emitEvent({ type: 'part-committed', part })
  }

  // Mark as ready
  session.initStatus = 'ready'
  session.updatedAt = now()
  updateSessionRecord(database.connection, session)

  // Build and emit the complete trace bundle
  const allParts = listPartRecordsBySession(database.connection, sessionId)
  const trace = buildSessionTraceBundle({
    session,
    turns: listTurnRecordsBySession(database.connection, sessionId),
    rounds: listRoundRecordsBySession(database.connection, sessionId),
    parts: allParts,
    rawExchanges: listRawExchangeRecordsBySession(database.connection, sessionId),
    transcript: deriveTranscriptEntries(allParts),
    context: deriveContextEntries(allParts),
  })
  emitEvent({ type: 'prelude-complete', trace })
}
