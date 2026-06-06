/**
 * Mapping boundary between persistence record shapes and the execution-model
 * domain vocabulary.
 *
 * This file declares the conceptual correspondence between:
 *   - the existing `*Record` types from `domain/model.ts`  (persistence-oriented)
 *   - the domain interfaces from `domain/executionModel.ts`  (domain-oriented)
 *
 * The schema columns, containment IDs, and runtime types are aligned with the
 * domain model.  The mapping below documents the correspondence.
 *
 * Non-Turn Step subtypes (analysis workflow steps) use `STEP_TYPE` constants
 * defined in `domain/executionModel.ts` and map to `StepPersistenceRecord` rows
 * with the corresponding `stepTypeKey`.
 *
 * Mapping table:
 *
 *   Persistence record         →  Domain concept
 *   ─────────────────────────────────────────────────────────────────────────
 *   SessionRecord              →  Session
 *     .sessionType             →    Session.sessionTypeKey
 *     .parentKind / .parentId  →    Session.parent (SessionContainer?)
 *     .status / .initStatus    →    Session.status (SessionLifecycleStatus)
 *   ─────────────────────────────────────────────────────────────────────────
 *   TurnRecord                 →  Turn (LLM-specific; uses TurnPersistenceRecord)
 *     .turnNumber              →    TurnPersistenceRecord.turnNumber
 *     .status                  →    status (StepStatus)
 *   ─────────────────────────────────────────────────────────────────────────
 *   RoundRecord                →  Turn-owned round (infrastructure subtype)
 *   PartRecord                 →  Turn-owned part  (infrastructure subtype)
 *   RawExchangeRecord          →  Turn-owned raw exchange (diagnostics layer)
 *   ─────────────────────────────────────────────────────────────────────────
 *   (no current record)        →  Benchmark  (minimal SessionContainer)
 *   StepPersistenceRecord      →  non-Turn Step subtypes (workflow, compaction)
 *   ─────────────────────────────────────────────────────────────────────────
 *
 * Container ownership mapping:
 *
 *   Current shape                           →  Domain shape
 *   ──────────────────────────────────────────────────────────────────────
 *   parentKind='session', parentId=<id>     →  parent = Session (by sessionId)
 *   parentKind='benchmark', parentId=<id>   →  parent = Benchmark (by benchmarkId)
 *   parentKind=null, parentId=null          →  parent = null (top-level session)
 *   ──────────────────────────────────────────────────────────────────────
 */

import type { SessionRecord, RoundRecord, PartRecord, RawExchangeRecord } from './model.js'
import type { Session, Benchmark, Step } from './executionModel.js'

type SessionContainer = Session | Benchmark

// ─────────────────────────────────────────────────────────────────────────────
// Nominal type guards / narrowing helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the given SessionContainer is a Session (not a Benchmark).
 *
 * Used to distinguish session-parent from benchmark-parent in the domain model
 * without reintroducing persistence-shaped parentKind checks into domain code.
 */
export function isSessionContainer(container: SessionContainer): container is Session {
  return container.containerTypeKey === 'session'
}

/**
 * Returns true if the given SessionContainer is a Benchmark.
 */
export function isBenchmarkContainer(container: SessionContainer): container is Benchmark {
  return container.containerTypeKey === 'benchmark'
}

// ─────────────────────────────────────────────────────────────────────────────
// Record-to-concept correspondence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shape of the mapping from a SessionRecord to its domain Session concept.
 * Implemented fully in Step 4 (port current chat-session behavior).
 */
export type SessionRecordMapping = {
  record: SessionRecord
  domain: Session
}

/**
 * Shape of the mapping from a RoundRecord.
 * Rounds remain Turn-owned infrastructure; no separate domain interface.
 */
export type RoundRecordMapping = {
  record: RoundRecord
}

/**
 * Shape of the mapping from a PartRecord.
 * Parts remain Turn-owned infrastructure; no separate domain interface.
 */
export type PartRecordMapping = {
  record: PartRecord
}

/**
 * Shape of the mapping from a RawExchangeRecord.
 * Raw exchanges remain in the diagnostics/replay layer; no domain interface.
 */
export type RawExchangeRecordMapping = {
  record: RawExchangeRecord
}

// Re-export domain types for convenience of importing modules that only need
// the boundary file.
export type { Session, Step, Benchmark, SessionContainer }
