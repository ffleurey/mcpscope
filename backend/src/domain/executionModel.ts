/**
 * Domain vocabulary for the session-backed execution model.
 *
 * This module defines the canonical domain abstractions:
 *   - Session           — execution container
 *   - Step              — abstract execution unit
 *   - Turn              — LLM-specific Step subtype
 *   - Artifact          — content-oriented artifact hierarchy
 *
 * These types define the target execution model.  Existing persistence-layer
 * record shapes (SessionRecord, TurnRecord, etc.) remain active until behavior
 * is ported in later steps.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Branded type-key helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A ContainerTypeKey identifies a concrete container class.
 * Generic persistence stores these keys alongside parameter/state payloads so
 * that new container types can be added without schema changes by default.
 */
export type ContainerTypeKey = string & { readonly __brand: 'ContainerTypeKey' }

/**
 * A SessionTypeKey identifies a concrete Session class.
 */
export type SessionTypeKey = string & { readonly __brand: 'SessionTypeKey' }

/**
 * A StepTypeKey identifies a concrete Step class.
 */
export type StepTypeKey = string & { readonly __brand: 'StepTypeKey' }

/**
 * An ArtifactTypeKey identifies a concrete Artifact content type.
 */
export type ArtifactTypeKey = string & { readonly __brand: 'ArtifactTypeKey' }

export function containerTypeKey(key: string): ContainerTypeKey {
  return key as ContainerTypeKey
}

export function sessionTypeKey(key: string): SessionTypeKey {
  return key as SessionTypeKey
}

export function stepTypeKey(key: string): StepTypeKey {
  return key as StepTypeKey
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic parameter and state payload shapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A generic parameter bag for containers, sessions, and steps.
 * Concrete types narrow this to their own validated input shapes.
 * Stored in persistence as JSON alongside the type key.
 */
export type GenericParams = Record<string, unknown>

/**
 * A generic state bag for containers, sessions, and steps.
 * Concrete types narrow this to their own resumable state shape.
 * Stored in persistence as JSON alongside the type key.
 */
export type GenericState = Record<string, unknown>

/** Known container type keys (as const for exhaustiveness checks). */
export const CONTAINER_TYPE = {
  SESSION: containerTypeKey('session'),
  BENCHMARK: containerTypeKey('benchmark'),
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Artifact hierarchy  (content-oriented, not workflow-semantic)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Artifacts are first-class persisted objects.
 * Polymorphism follows content representation, not workflow semantics.
 *
 * Semantic schema and usage rules belong to the session/step types that consume
 * the artifacts, not to the artifact type itself.
 */
export interface Artifact {
  readonly artifactId: string
  readonly artifactTypeKey: ArtifactTypeKey
}

/** Known artifact content type keys. */
export const ARTIFACT_TYPE = {
  JSON: 'json' as ArtifactTypeKey,
  TEXT: 'text' as ArtifactTypeKey,
  MARKDOWN: 'markdown' as ArtifactTypeKey,
  IMAGE: 'image' as ArtifactTypeKey,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Step
// ─────────────────────────────────────────────────────────────────────────────

/** Lifecycle status for a step within a session. */
export type StepStatus = 'pending' | 'running' | 'complete' | 'error' | 'aborted'

/**
 * The execution context passed to Step.execute().
 * Contains the information the step needs to run its unit of work.
 */
export interface StepExecutionContext {
  readonly sessionId: string
  /** The model-visible slice of session state. */
  readonly visibleContext: {
    /** Token count of the currently visible context. */
    readonly usedTokens: number | null
    /** Total available context window for the model. */
    readonly availableTokens: number | null
  }
  readonly artifacts: ReadonlyArray<Artifact>
}

/**
 * The result of executing a step.
 */
export interface StepResult {
  readonly status: StepStatus
  readonly outputArtifacts: ReadonlyArray<Artifact>
  readonly error?: string
}

/**
 * Step is the abstract execution unit.
 *
 * Concrete step types own unit-of-work execution semantics.
 *   - `Turn` is the LLM-specific Step subtype.
 *   - Deterministic work is represented by other Step subtypes.
 *
 * Generic persistence stores type keys plus parameter/state payloads.
 * New concrete step types do not require schema changes by default.
 */
export interface Step {
  readonly stepId: string
  readonly stepTypeKey: StepTypeKey
  readonly status: StepStatus
  readonly params: GenericParams
  readonly state: GenericState

  /**
   * Execute this step with the given context.
   * Unit-of-work execution: runs exactly once when inputs are populated.
   */
  execute(context: StepExecutionContext): Promise<StepResult>
}

/** Known step type keys. */
export const STEP_TYPE = {
  TURN: stepTypeKey('turn'),
  COMPACTION: stepTypeKey('compaction'),
  ANALYSIS_BOOTSTRAP: stepTypeKey('analysis_bootstrap'),
  ANALYSIS_TOOL_CALL_ASSESSMENT: stepTypeKey('analysis_tool_call_assessment'),
  ANALYSIS_TOOL_GROUP_ASSESSMENT: stepTypeKey('analysis_tool_group_assessment'),
  ANALYSIS_TURN_SUMMARY: stepTypeKey('analysis_turn_summary'),
  ANALYSIS_FINAL_AGGREGATION: stepTypeKey('analysis_final_aggregation'),
  ANALYSIS_COVERAGE_VALIDATION: stepTypeKey('analysis_coverage_validation'),
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Turn  (LLM-specific Step)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turn is the LLM-specific subtype of Step, represented at runtime by
 * TurnRecord (model.ts) and TurnPersistenceRecord (persistenceContract.ts).
 *
 * The domain Turn interface is deferred until the execution-model refactoring
 * reaches the chat-session refactoring phase.
 */


// ─────────────────────────────────────────────────────────────────────────────
// Session
// ─────────────────────────────────────────────────────────────────────────────

/** Lifecycle status for a session. */
export type SessionLifecycleStatus =
  | 'draft'
  | 'ready'
  | 'active'
  | 'complete'
  | 'error'
  | 'archived'

/**
 * Session is the execution container.
 *
 * Session types own orchestration semantics.
 *
 * Method contract:
 *   - `execute()`     — runs the session until it can no longer continue;
 *                       loops while canContinue() is true, calling advance()
 *   - `advance()`     — orchestration step: decides what step comes next and
 *                       performs one advancement of execution
 *   - `canContinue()` — returns true when the session can still advance
 *
 * Generic persistence stores type keys plus parameter/state payloads.
 * New concrete session types do not require schema changes by default.
 */
export interface Session {
  /** Stable session identifier. */
  readonly sessionId: string
  readonly containerId: string
  readonly containerTypeKey: ContainerTypeKey
  /** Identifies the concrete session class for generic persistence. */
  readonly sessionTypeKey: SessionTypeKey
  readonly status: SessionLifecycleStatus
  /** Owning container (another Session, or a Benchmark), or null for top-level. */
  readonly parent: { readonly containerId: string; readonly containerTypeKey: ContainerTypeKey } | null
  /** Ordered execution trace (steps executed so far). */
  readonly steps: ReadonlyArray<Step>
  readonly params: GenericParams
  readonly state: GenericState

  /** Returns true when the session can advance further. */
  canContinue(): boolean

  /**
   * Performs one orchestration advancement.
   * Decides what step comes next and runs it.
   */
  advance(): Promise<void>

  /**
   * Runs the full session loop.
   * Calls advance() repeatedly while canContinue() returns true.
   */
  execute(): Promise<void>
}

/** Known session type keys (matching current SessionType values in model.ts). */
export const SESSION_TYPE = {
  PRIMARY: sessionTypeKey('primary'),
  SESSION_ANALYSIS: sessionTypeKey('session_analysis'),
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark container
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Benchmark is a minimal container that is not itself a Session.
 *
 * Sessions may belong to a Benchmark as their parent container.
 * Benchmark support in this increment validates the container model only;
 * full benchmark-domain design is future work.
 */
export interface Benchmark {
  readonly containerId: string
  readonly containerTypeKey: typeof CONTAINER_TYPE.BENCHMARK
  /** Stable benchmark identifier. */
  readonly benchmarkId: string
  readonly title: string
  readonly params: GenericParams
  readonly state: GenericState
  readonly createdAt: number
  readonly updatedAt: number
}
