/**
 * Generic persistence contract for the session-backed execution model.
 *
 * This module defines how containers, sessions, and steps persist generically
 * without requiring subtype-specific tables for every new concrete class.
 *
 * Design principles:
 *   - New concrete session/step types do NOT require schema changes by default.
 *   - The persistence layer stores a type key + generic parameter/state payloads.
 *   - Only infrastructure-relevant differences justify dedicated subtype tables.
 *   - `Turn` is the only current case that justifies dedicated tables (rounds,
 *     parts, raw exchanges) — because these are infrastructure, not workflow semantics.
 *
 * Relationship to current records:
 *   - The generic persistence types here replace the flat `SessionRecord`,
 *     `TurnRecord`, etc. in the new schema layer.
 *   - Legacy record terminology still appears only where needed for current
 *     compatibility types and tests.
 *
 * Naming conventions:
 *   - `*Persistence*` types represent the raw persisted shapes (what goes in DB).
 *   - `*Repository` interfaces define the backend-owned read/write API.
 */

import type {
  ContainerTypeKey,
  SessionTypeKey,
  StepTypeKey,
  GenericParams,
  GenericState,
} from './executionModel.js'

// ─────────────────────────────────────────────────────────────────────────────
// Session persistence record
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persisted representation of a Session.
 * Maps to the `sessions` table in the new schema.
 *
 * Parent ownership is stored as a typed reference to either another session
 * or a container record, keyed by containerTypeKey.
 */
export interface SessionPersistenceRecord {
  /** Stable session identifier. */
  readonly id: string
  readonly title: string
  /** Identifies the concrete session class for generic persistence. */
  readonly sessionTypeKey: SessionTypeKey
  /**
   * Parent ownership reference.
   * null = top-level session.
   * non-null = session belongs to a container (Session or Benchmark).
   */
  readonly parentRef: ContainerRef | null
  readonly status: string
  readonly initStatus: string
  /** Generic parameter bag serialized as JSON. */
  readonly params: GenericParams
  /** Generic resumable state serialized as JSON. */
  readonly state: GenericState
  readonly createdAt: number
  readonly updatedAt: number
}

/**
 * A typed reference to an owning container.
 * Replaces the flat parentKind/parentId pair from the legacy model.
 */
export interface ContainerRef {
  readonly containerTypeKey: ContainerTypeKey
  readonly containerId: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Step persistence record
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persisted representation of a generic Step.
 * Maps to the `steps` table in the new schema.
 *
 * New concrete step types store all their orchestration-relevant state in
 * `params` and `state` without requiring additional tables.
 *
 * Turn-specific persistence (rounds, parts, raw exchanges) uses dedicated
 * tables because those structures are infrastructure, not workflow semantics.
 * A step with stepTypeKey='turn' has a corresponding TurnPersistenceRecord.
 */
export interface StepPersistenceRecord {
  /** Stable step identifier. */
  readonly id: string
  /** Session that owns this step. */
  readonly sessionId: string
  /** Identifies the concrete step class. */
  readonly stepTypeKey: StepTypeKey
  /** Parent step within the same session, or null for top-level steps. */
  readonly parentStepId: string | null
  /** Position in session execution trace (0-based). */
  readonly childIndex: number
  readonly status: string
  /** Generic parameter bag serialized as JSON (step inputs). */
  readonly params: GenericParams
  /** Generic resumable state serialized as JSON (step state). */
  readonly state: GenericState
  readonly createdAt: number
  readonly completedAt: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Turn-specific persistence (infrastructure subtype)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persisted representation of a Turn's LLM-specific fields.
 * Maps to the `turns` table in the new schema.
 *
 * Every step with stepTypeKey='turn' has a corresponding TurnPersistenceRecord
 * linked by id.  This is infrastructure-justified: rounds, parts, and
 * raw exchanges cannot be stored generically without significant cost.
 *
 * TurnPersistenceRecord stores only the Turn-specific fields not already in
 * StepPersistenceRecord.
 */
export interface TurnPersistenceRecord {
  /** Canonical turn ID. */
  readonly id: string
  readonly sessionId: string
  /** Optional owning workflow step for composite-step projections. */
  readonly ownerStepId: string | null
  readonly turnNumber: number
  readonly outcome: string | null
  readonly promptTokens: number | null
  readonly completionTokens: number | null
  readonly reasoningTokens: number | null
  readonly totalTokens: number | null
  readonly contextTokensAtTurnEnd: number | null
  readonly contextTokensAfterCompaction: number | null
  readonly compactionApplied: string | null
  readonly compactionTokensRemoved: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository interfaces (backend-owned, adapter-agnostic)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Repository interface for session persistence.
 * Implemented against the new schema in Step 3.
 */
export interface SessionRepository {
  insert(record: SessionPersistenceRecord): void
  getById(id: string): SessionPersistenceRecord | null
  update(record: SessionPersistenceRecord): void
  delete(id: string): void
  /** List all sessions, optionally filtered by parent reference. */
  list(filter?: { parentRef?: ContainerRef | null }): SessionPersistenceRecord[]
}

/**
 * Repository interface for generic step persistence.
 * Turn-specific operations use TurnRepository in addition.
 */
export interface StepRepository {
  insert(record: StepPersistenceRecord): void
  getById(id: string): StepPersistenceRecord | null
  update(record: StepPersistenceRecord): void
  listBySession(sessionId: string): StepPersistenceRecord[]
}

/**
 * Repository interface for Turn-specific LLM fields.
 */
export interface TurnRepository {
  insert(record: TurnPersistenceRecord): void
  getById(id: string): TurnPersistenceRecord | null
  update(record: TurnPersistenceRecord): void
  listBySession(sessionId: string): TurnPersistenceRecord[]
}
