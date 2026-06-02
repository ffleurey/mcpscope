import type { BackendDatabase } from '../persistence/db.js'
import {
  getPartRecord,
  listPartRecordsBySession,
  updatePartRecord,
} from '../persistence/repository.js'

export interface FastToolContextMutationInput {
  analysisSessionId: string
  nextWorkUnitIndex: number
  totalWorkUnitCount: number
  injectPartIds: string[]
  reasoningPartIds: string[]
  userTurnId: string | null
}

export interface FastToolContextMutationResult {
  nextPhase: 'assessing' | 'final_aggregation'
}

export function runFastToolContextMutationStep(
  database: BackendDatabase,
  input: FastToolContextMutationInput,
): FastToolContextMutationResult {
  const mutatedAt = Date.now()

  for (const partId of input.injectPartIds) {
    const part = getPartRecord(database.connection, partId)
    if (!part) continue
    updatePartRecord(database.connection, {
      ...part,
      context: {
        ...part.context,
        state: 'excluded',
        note: 'Deterministic grouped evidence excluded after grouped assessment completed',
      },
      updatedAt: mutatedAt,
    })
  }

  for (const partId of input.reasoningPartIds) {
    const part = getPartRecord(database.connection, partId)
    if (!part) continue
    updatePartRecord(database.connection, {
      ...part,
      context: {
        ...part.context,
        state: 'excluded',
        note: 'Grouped assessment reasoning excluded after grouped assessment completed',
      },
      updatedAt: mutatedAt,
    })
  }

  if (input.userTurnId) {
    const userPart = listPartRecordsBySession(database.connection, input.analysisSessionId)
      .find(part => part.turnId === input.userTurnId && part.partType === 'user-message')
    if (userPart) {
      updatePartRecord(database.connection, {
        ...userPart,
        context: {
          ...userPart.context,
          state: 'historical-only',
          note: 'Grouped assessment question excluded from active context after grouped assessment completed',
        },
        updatedAt: mutatedAt,
      })
    }
  }

  return {
    nextPhase: input.nextWorkUnitIndex < input.totalWorkUnitCount ? 'assessing' : 'final_aggregation',
  }
}