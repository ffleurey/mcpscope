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
  StepTypeKey,
  GenericParams,
  GenericState,
} from './executionModel.js'

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
