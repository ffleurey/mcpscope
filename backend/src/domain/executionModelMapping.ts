/**
 * Mapping boundary between current persistence record shapes and the new
 * execution-model domain vocabulary.
 *
 * This file declares the conceptual correspondence between:
 *   - the existing `*Record` types from `domain/model.ts`  (persistence-oriented)
 *   - the new domain interfaces from `domain/executionModel.ts`  (domain-oriented)
 *
 * At this stage (Step 1 of the execution-model refactor) the mapping is
 * declared as type-level documentation only.  Behavior is NOT yet ported;
 * existing record types and repositories remain active.
 *
 * As later steps port each slice of behavior, the corresponding runtime
 * functions will be updated to work through the new domain types, and the
 * relevant entries below will be promoted from "declared" to "active".
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
 *   TurnRecord                 →  Turn  (LLM-specific Step)
 *     .sequenceNumber          →    Turn.sequenceNumber
 *     .status                  →    Turn.status  (StepStatus)
 *   ─────────────────────────────────────────────────────────────────────────
 *   RoundRecord                →  Turn-owned round (infrastructure subtype)
 *   PartRecord                 →  Turn-owned part  (infrastructure subtype)
 *   RawExchangeRecord          →  Turn-owned raw exchange (diagnostics layer)
 *   ─────────────────────────────────────────────────────────────────────────
 *   (no current record)        →  Benchmark  (minimal SessionContainer)
 *   (no current record)        →  non-Turn Step subtypes (future)
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

import type { SessionRecord, TurnRecord, RoundRecord, PartRecord, RawExchangeRecord } from './model.js'
import type { Session, Turn, Benchmark, Step } from './executionModel.js'

type SessionContainer = Session | Benchmark

// ─────────────────────────────────────────────────────────────────────────────
// Nominal type guards / narrowing helpers  (declared, not yet behaviorally wired)
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
// Record-to-concept correspondence  (declared for Step 1; implemented in Step 4+)
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
 * Shape of the mapping from a TurnRecord to its domain Turn concept.
 * Implemented fully in Step 4 (port current chat-session behavior).
 */
export type TurnRecordMapping = {
  record: TurnRecord
  domain: Turn
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
export type { Session, Turn, Step, Benchmark, SessionContainer }
