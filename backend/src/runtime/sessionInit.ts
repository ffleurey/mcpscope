import type { PartRecord } from '../domain/model.js'
import {
  getSessionRecord,
  listPartRecordsBySession,
  listRawExchangeRecordsBySession,
  listRoundRecordsBySession,
  listStepRecordsBySession,
  listTurnRecordsBySession,
  updateSessionRecord,
} from '../persistence/repository.js'
import { buildSessionTraceBundle } from '../domain/trace.js'
import { deriveContextEntries, deriveTranscriptEntries } from '../domain/selectors.js'
import type { BackendDatabase } from '../persistence/db.js'
import type { ChatCompletionGateway } from './modelTurns.js'
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
  chatCompletionGateway: ChatCompletionGateway,
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
      steps: listStepRecordsBySession(database.connection, sessionId),
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

  // Tracks which init phase is running so a failure can be attributed (and the
  // offending server named) in the persisted initError.
  let phase: 'mcp' | 'tokens' = 'mcp'

  try {
    // Emit existing parts (system prompt was created during createSession)
    let parts = listPartRecordsBySession(database.connection, sessionId)
    for (const part of parts.filter(p => p.turnId === null)) {
      emitEvent({ type: 'part-committed', part })
    }

    // MCP setup: initializes MCP session + creates mcp-instructions + tool-definitions parts
    if (session.mcpProfileSnapshots.length > 0) {
      await ensureMcpContext(database, session, mcpGateway)
      parts = listPartRecordsBySession(database.connection, sessionId)
      for (const part of parts.filter(p => p.turnId === null)) {
        emitEvent({ type: 'part-committed', part })
      }
    }

    // Token probing: context length + system prompt tokens + MCP/tool-definition tokens
    phase = 'tokens'
    const probedParts = await ensureSessionPreludeTokenMetadata(database, chatCompletionGateway, session, parts)
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
      steps: listStepRecordsBySession(database.connection, sessionId),
      turns: listTurnRecordsBySession(database.connection, sessionId),
      rounds: listRoundRecordsBySession(database.connection, sessionId),
      parts: allParts,
      rawExchanges: listRawExchangeRecordsBySession(database.connection, sessionId),
      transcript: deriveTranscriptEntries(allParts),
      context: deriveContextEntries(allParts),
    })
    emitEvent({ type: 'prelude-complete', trace })
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    // Attribute the failure to its phase and name the server, so a bare
    // transport error like "fetch failed" is actionable.
    const errorKind = phase === 'mcp' ? 'mcp_init_error' : 'token_probe_error'
    const target = phase === 'mcp'
      ? session.mcpProfileSnapshots.map(m => `'${m.name}' (${m.url})`).join(', ')
      : `model '${session.modelProfileSnapshot.name}' (${session.modelProfileSnapshot.connectionBaseUrl})`
    const message = target ? `${raw} — initializing ${phase === 'mcp' ? 'MCP server' : 'LM connection'} ${target}` : raw
    session.initStatus = 'error'
    // Persist the failure reason so it is diagnosable after the fact via
    // list/status/inspect (otherwise only emitted on the live event stream).
    session.initError = { errorKind, message }
    session.updatedAt = now()
    updateSessionRecord(database.connection, session)
    emitEvent({ type: 'prelude-failed', message })
  }
}
