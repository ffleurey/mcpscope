import fs from 'node:fs'
import path from 'node:path'
import { getBackendConfig } from '../config.js'
import { deriveContextEntries, deriveTranscriptEntries } from '../domain/selectors.js'
import { buildSessionTraceBundle, sessionTraceBundleSchema, type SessionTraceBundle } from '../domain/trace.js'
import { openBackendDatabase } from '../persistence/db.js'
import { deleteSessionRecord, listSessionRecords } from '../persistence/repository.js'
import { importTraceBundle } from '../runtime/traceImport.js'
import {
  capturedReasoningThreeBatchParts,
  capturedReasoningThreeBatchRounds,
  capturedReasoningThreeBatchSession,
} from '../testing/fixtures/capturedReasoningThreeBatch.js'

const CURATED_REASONING_TITLE = 'Captured · Reasoning retention'
const RETIRED_TITLE = 'Captured · Temperature two-turn'

const artifactTraceSeeds: Array<{ fileName: string; title: string }> = [
  { fileName: 'runtime-trace.json', title: 'Captured · Model-only OK' },
  { fileName: 'runtime-tool-trace.json', title: 'Captured · Tool-enabled Oslo time' },
  { fileName: 'runtime-temperature-stress-trace.json', title: 'Captured · Temperature stress' },
]

function readTraceBundle(tracePath: string): SessionTraceBundle {
  const raw = JSON.parse(fs.readFileSync(tracePath, 'utf8'))
  return sessionTraceBundleSchema.parse(raw) as SessionTraceBundle
}

function buildCuratedReasoningTrace(): SessionTraceBundle {
  const turnId = capturedReasoningThreeBatchRounds[0]?.turnId ?? 'captured-reasoning-turn'
  const finalRound = capturedReasoningThreeBatchRounds[capturedReasoningThreeBatchRounds.length - 1]
  const createdAt = capturedReasoningThreeBatchSession.createdAt
  const completedAt = finalRound?.completedAt ?? capturedReasoningThreeBatchSession.updatedAt

  return buildSessionTraceBundle({
    session: {
      ...capturedReasoningThreeBatchSession,
      title: CURATED_REASONING_TITLE,
    },
    turns: [{
      id: turnId,
      sessionId: capturedReasoningThreeBatchSession.id,
      sequenceNumber: 0,
      status: 'complete',
      createdAt,
      completedAt,
      outcome: 'tool-assisted-response',
      usage: finalRound?.usage ?? {
        promptTokens: null,
        completionTokens: null,
        reasoningTokens: null,
        totalTokens: null,
      },
      contextTokensAtTurnEnd: null,
      contextTokensAfterCompaction: null,
      compactionApplied: null,
      compactionTokensRemoved: null,
    }],
    rounds: capturedReasoningThreeBatchRounds,
    parts: capturedReasoningThreeBatchParts,
    rawExchanges: [],
    transcript: deriveTranscriptEntries(capturedReasoningThreeBatchParts),
    context: deriveContextEntries(capturedReasoningThreeBatchParts),
  })
}

function main(): void {
  const config = getBackendConfig()
  const database = openBackendDatabase(config.sqlitePath)
  const artifactsDir = path.join(process.cwd(), 'backend-data', 'test-artifacts')

  try {
    const existingSessions = listSessionRecords(database.connection)

    for (const session of existingSessions.filter((record) => record.title === RETIRED_TITLE)) {
      deleteSessionRecord(database.connection, session.id)
      console.log(`Removed retired session: ${RETIRED_TITLE}`)
    }

    const existingTitles = new Set(listSessionRecords(database.connection).map((session) => session.title))
    let importedCount = 0

    for (const traceSeed of artifactTraceSeeds) {
      const tracePath = path.join(artifactsDir, traceSeed.fileName)
      if (!fs.existsSync(tracePath)) {
        console.log(`Skipping missing artifact: ${traceSeed.fileName}`)
        continue
      }

      if (existingTitles.has(traceSeed.title)) {
        console.log(`Already present: ${traceSeed.title}`)
        continue
      }

      const trace = readTraceBundle(tracePath)
      importTraceBundle(database, {
        ...trace,
        session: {
          ...trace.session,
          title: traceSeed.title,
        },
      })

      existingTitles.add(traceSeed.title)
      importedCount += 1
      console.log(`Imported: ${traceSeed.title}`)
    }

    if (!existingTitles.has(CURATED_REASONING_TITLE)) {
      importTraceBundle(database, buildCuratedReasoningTrace())
      importedCount += 1
      console.log(`Imported: ${CURATED_REASONING_TITLE}`)
    } else {
      console.log(`Already present: ${CURATED_REASONING_TITLE}`)
    }

    if (importedCount === 0) {
      console.log('No new captured sessions were imported.')
    } else {
      console.log(`Imported ${importedCount} captured session${importedCount === 1 ? '' : 's'} into ${database.path}`)
    }
  } finally {
    database.connection.close()
  }
}

main()
