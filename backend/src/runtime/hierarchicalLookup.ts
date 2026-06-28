import type Database from "better-sqlite3";
import type {
  PartRecord,
  RoundRecord,
  StepRecord,
  TurnRecord,
} from "../domain/model.js";
import { DEFAULT_MAX_TOOL_ROUNDS } from "../domain/model.js";
import type { AnalysisWorkflowKind } from "../analysis/workflowKinds.js";
import {
  formatSetupId,
  parseHierarchicalId,
} from "../domain/hierarchicalIds.js";
import {
  getPartRecord,
  getRoundRecord,
  getSessionRecord,
  getStepRecord,
  getTurnRecord,
  listPartRecordsBySession,
  listRoundRecordsBySession,
  listStepRecordsBySession,
  listTurnRecordsBySession,
} from "../persistence/repository.js";
import { listArtifactsBySession } from "../analysis/artifactRepository.js";
import {
  getAnalysisWorkflowLabel,
  getLatestAnalysisDiagnosticSummary,
  getLatestAnalysisDiagnosticSummaryForStep,
} from "../analysis/analysisSessionPresentation.js";

type LookupMode = "summary" | "full";

type LookupSuccess = {
  status: "ok";
  payload: {
    id: string;
    type: "session" | "setup" | "step" | "turn" | "round" | "part";
    mode: LookupMode;
    data: unknown;
  };
};

type LookupFailure =
  | { status: "invalid"; message: string }
  | { status: "not_found"; message: string };

// ─── Canonical type mapping ───────────────────────────────────────────────────

const CANONICAL_PART_TYPE: Record<string, string> = {
  "system-prompt": "system_prompt",
  "mcp-instructions": "mcp_instructions",
  "tool-definitions": "tool_definitions",
  "user-message": "user_prompt",
  "assistant-reasoning": "reasoning",
  "assistant-content": "assistant_answer",
  "tool-call": "tool_call",
  "diagnostic-note": "diagnostic",
};

const CANONICAL_CONTEXT_STATE: Record<string, string> = {
  included: "included",
  excluded: "excluded",
  stripped: "stripped",
  "historical-only": "historical_only",
  "round-only": "round_only",
};

function canonicalPartType(partType: string): string | null {
  return CANONICAL_PART_TYPE[partType] ?? null;
}

function canonicalContextState(state: string): string {
  return CANONICAL_CONTEXT_STATE[state] ?? state;
}

// ─── Part helpers ─────────────────────────────────────────────────────────────

function isPublicPartType(partType: string): boolean {
  return partType !== "tool-result";
}

function extractToolName(part: PartRecord): string | null {
  if (part.partType !== "tool-call") return null;
  const json = part.payload.json as { name?: string; toolName?: string } | null;
  return String(
    json?.name ?? json?.toolName ?? part.payload.summary ?? "unknown",
  );
}

function mergedToolCallTokens(
  callPart: PartRecord,
  resultParts: PartRecord[],
): number | null {
  const all = [callPart, ...resultParts];
  if (all.every((p) => p.tokens.count == null)) return null;
  return all.reduce((sum, p) => sum + (p.tokens.count ?? 0), 0);
}

/**
 * Max characters kept for a single tool-call argument value in nested (overview)
 * inspect views. Caps individual oversized values — e.g. a tool fed a large text
 * blob — while keeping every parameter key and short value intact, so tool-use
 * criteria stay checkable from the overview. A direct part inspect returns the
 * full, untruncated arguments.
 */
export const TOOL_ARG_VALUE_MAX_CHARS = 80;

function capArgValue(value: unknown): unknown {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (serialized != null && serialized.length > TOOL_ARG_VALUE_MAX_CHARS) {
    return `${serialized.slice(0, TOOL_ARG_VALUE_MAX_CHARS)}… [${serialized.length} chars]`;
  }
  return value;
}

/**
 * Compact, size-capped view of a tool call's arguments for nested inspect nodes.
 * Returns the parsed object with each value capped; falls back to the (capped)
 * raw string when the arguments aren't a JSON object.
 */
export function summarizeToolArguments(argsString: string | undefined): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsString ?? "{}");
  } catch {
    return capArgValue(argsString ?? "");
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      out[key] = capArgValue(value);
    }
    return out;
  }
  return capArgValue(parsed);
}

function buildPartNode(
  part: PartRecord,
  resultParts: PartRecord[],
  mode: LookupMode,
  isDirectPartLookup: boolean,
  isPartLevelLookup: boolean = false,
): object | null {
  const publicType = canonicalPartType(part.partType);
  if (!publicType) return null;

  const isToolCall = part.partType === "tool-call";
  const isToolDefinitions = part.partType === "tool-definitions";
  const tokenCount = isToolCall
    ? mergedToolCallTokens(part, resultParts)
    : (part.tokens.count ?? null);
  const contextState = canonicalContextState(part.context.state);

  const base: Record<string, unknown> = {
    id: part.id,
    type: publicType,
    token_count: tokenCount,
    context_state: contextState,
  };

  if (isToolCall) {
    base.tool_name = extractToolName(part);
  }

  // tool_definitions: full content only on direct part-level lookup; tool names in all other contexts
  if (isToolDefinitions) {
    if (isPartLevelLookup && part.payload.json != null) {
      base.content = { json: part.payload.json };
    } else {
      const toolsJson = part.payload.json as Array<{ name: string }> | null;
      if (toolsJson) {
        base.tools = toolsJson.map((t) => t.name);
      }
    }
    return base;
  }

  if (mode === "full") {
    if (isToolCall && isDirectPartLookup) {
      const callJson = part.payload.json as { arguments?: string } | null;
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(callJson?.arguments ?? "{}") as Record<
          string,
          unknown
        >;
      } catch {
        /* empty */
      }
      const result = resultParts[0];
      const toolResult: Record<string, unknown> = result
        ? result.payload.text != null
          ? { text: result.payload.text }
          : result.payload.json != null
            ? { json: result.payload.json }
            : {}
        : {};
      base.tool_payload = { call: parsedArgs, result: toolResult };
    } else if (isToolCall) {
      // Nested overview (session/turn/round): include the call parameters with
      // per-value size caps so tool-use criteria are checkable without drilling
      // into each call. Drill into the part directly for full args + result.
      const callJson = part.payload.json as { arguments?: string } | null;
      base.tool_arguments = summarizeToolArguments(callJson?.arguments);
    } else {
      const includeContent =
        isDirectPartLookup ||
        part.partType === "user-message" ||
        part.partType === "assistant-content";
      if (includeContent && part.payload.text != null) {
        base.content = { text: part.payload.text };
      }
    }
  }

  return base;
}

// ─── Setup node builder ───────────────────────────────────────────────────────

function buildSetupNode(
  sessionId: string,
  setupParts: PartRecord[],
  mode: LookupMode,
  isDirectLookup: boolean,
): object {
  const parts = setupParts
    .filter((p) => isPublicPartType(p.partType))
    .map((p) => buildPartNode(p, [], mode, isDirectLookup))
    .filter((n): n is object => n !== null);

  return { id: formatSetupId(sessionId), parts };
}

// ─── Turn/round builders ──────────────────────────────────────────────────────

function buildToolResultIndex(
  allParts: PartRecord[],
): Map<string, PartRecord[]> {
  const map = new Map<string, PartRecord[]>();
  for (const p of allParts) {
    if (p.partType === "tool-result" && p.parentPartId) {
      map.set(p.parentPartId, [...(map.get(p.parentPartId) ?? []), p]);
    }
  }
  return map;
}

function buildRoundPartNodes(
  parts: PartRecord[],
  toolResultsByParent: Map<string, PartRecord[]>,
  mode: LookupMode,
  isDirectPartLookup: boolean,
): object[] {
  const nodes: object[] = [];
  for (const part of parts) {
    if (part.partType === "tool-result") continue;
    const resultParts =
      part.partType === "tool-call"
        ? (toolResultsByParent.get(part.id) ?? [])
        : [];
    const node = buildPartNode(part, resultParts, mode, isDirectPartLookup);
    if (node) nodes.push(node);
  }
  return nodes;
}

function buildRoundNode(
  round: RoundRecord,
  roundParts: PartRecord[],
  toolResultsByParent: Map<string, PartRecord[]>,
  mode: LookupMode,
  isDirectLookup: boolean,
): object {
  const parts = buildRoundPartNodes(
    roundParts,
    toolResultsByParent,
    mode,
    isDirectLookup,
  );
  return {
    id: round.id,
    ...(round.status ? { status: round.status } : {}),
    parts,
  };
}

function buildTurnNode(
  turn: TurnRecord,
  rounds: RoundRecord[],
  allParts: PartRecord[],
  mode: LookupMode,
  isDirectLookup: boolean,
): object {
  const toolResultsByParent = buildToolResultIndex(allParts);
  const roundNodes = rounds.map((round) => {
    const roundParts = allParts
      .filter((p) => p.roundId === round.id && isPublicPartType(p.partType))
      .sort((a, b) => a.ordinal - b.ordinal);
    return buildRoundNode(
      round,
      roundParts,
      toolResultsByParent,
      mode,
      isDirectLookup,
    );
  });
  const usage = turn.usage;
  return {
    id: turn.id,
    type: "turn",
    ...(turn.status ? { status: turn.status } : {}),
    // The turn's end-reason, surfaced only when it did NOT complete cleanly — for
    // an errored/aborted turn it's the one persisted clue (e.g. "step-error"),
    // since a mid-stream provider failure leaves no diagnostic part. A clean turn
    // needs no outcome beyond status:complete.
    ...(turn.status !== "complete" && turn.outcome
      ? { outcome: turn.outcome }
      : {}),
    // Turn-level token cost (from the turn's own usage) so "how costly was this
    // turn?" and the per-turn comparison are answerable from the overview without
    // summing parts. Same shape as the run report's per-session tokens.
    ...(usage.totalTokens != null
      ? {
          tokens: {
            prompt: usage.promptTokens,
            completion: usage.completionTokens,
            reasoning: usage.reasoningTokens,
            total: usage.totalTokens,
          },
        }
      : {}),
    rounds: roundNodes,
  };
}

function getCompactionRemovalReason(
  strategy: string | null,
  part: PartRecord | null,
): string {
  if (strategy === "strip-reasoning") {
    if (part?.partType === "assistant-reasoning") {
      return "Removed from future context because strip-reasoning compaction excludes assistant reasoning parts.";
    }
    return "Removed from future context by strip-reasoning compaction.";
  }

  return strategy
    ? `Removed from future context by ${strategy} compaction.`
    : "Removed from future context by compaction.";
}

function buildCompactionStepEvidence(
  step: StepRecord,
  allParts: PartRecord[],
  mode: LookupMode,
): Record<string, unknown> {
  const strippedPartIds = Array.isArray(step.state.strippedPartIds)
    ? step.state.strippedPartIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];

  const evidence: Record<string, unknown> = {
    stripped_part_ids: strippedPartIds,
  };

  if (mode !== "full") {
    return evidence;
  }

  const partsById = new Map(allParts.map((part) => [part.id, part]));
  evidence.stripped_parts = strippedPartIds.map((partId) => {
    const part = partsById.get(partId) ?? null;
    return {
      id: partId,
      ...(part
        ? {
            type: canonicalPartType(part.partType),
            token_count: part.tokens.count ?? null,
            round_id: part.roundId,
          }
        : {}),
      reason: getCompactionRemovalReason(
        typeof step.params.strategy === "string" ? step.params.strategy : null,
        part,
      ),
    };
  });

  return evidence;
}

function buildStepNode(
  step: StepRecord,
  steps: StepRecord[],
  turns: TurnRecord[],
  rounds: RoundRecord[],
  allParts: PartRecord[],
  artifacts: ReturnType<typeof listArtifactsBySession>,
  mode: LookupMode,
  isDirectLookup: boolean,
): object {
  if (step.stepTypeKey === "turn") {
    const turn = turns.find((candidate) => candidate.id === step.id);
    if (!turn) {
      return {
        id: step.id,
        type: "turn",
        status: step.status,
        rounds: [],
      };
    }

    const turnRounds = rounds
      .filter((round) => round.turnId === turn.id)
      .sort((left, right) => left.roundIndex - right.roundIndex);
    return buildTurnNode(turn, turnRounds, allParts, mode, isDirectLookup);
  }

  const ownedTurns = turns
    .filter((candidate) => candidate.ownerStepId === step.id)
    .sort((left, right) => left.turnNumber - right.turnNumber);
  const ownedTurnNodes = ownedTurns.map((turn) => {
    const turnRounds = rounds
      .filter((round) => round.turnId === turn.id)
      .sort((left, right) => left.roundIndex - right.roundIndex);
    return buildTurnNode(turn, turnRounds, allParts, mode, isDirectLookup);
  });

  const stepParts = allParts
    .filter(
      (part) =>
        part.turnId === step.id &&
        part.roundId === null &&
        isPublicPartType(part.partType),
    )
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((part) => buildPartNode(part, [], mode, true))
    .filter((node): node is object => node !== null);

  const ownedTurnIds = ownedTurns.map((candidate) => candidate.id);
  const postambleStepIds = ownedTurnIds.flatMap((turnId) =>
    steps
      .filter(
        (candidate) =>
          candidate.stepTypeKey === "compaction" &&
          candidate.params.sourceTurnId === turnId,
      )
      .sort((left, right) => left.childIndex - right.childIndex)
      .map((candidate) => candidate.id),
  );

  const compactionEvidence =
    step.stepTypeKey === "compaction"
      ? buildCompactionStepEvidence(step, allParts, mode)
      : {};
  const diagnostic = getLatestAnalysisDiagnosticSummaryForStep(
    artifacts,
    step.id,
  );

  const isCompaction = step.stepTypeKey === "compaction";

  return {
    id: step.id,
    type: step.stepTypeKey,
    status: step.status,
    ...(diagnostic ? { latest_error: diagnostic } : {}),
    // Compaction-specific accounting. Gated so analysis/other steps don't carry a
    // row of null compaction fields (and vice-versa for the turn-owning fields).
    ...(isCompaction
      ? {
          strategy:
            typeof step.params.strategy === "string"
              ? step.params.strategy
              : null,
          source_turn_id:
            typeof step.params.sourceTurnId === "string"
              ? step.params.sourceTurnId
              : null,
          source_turn_number:
            typeof step.params.sourceTurnSequenceNumber === "number"
              ? step.params.sourceTurnSequenceNumber
              : null,
          stripped_part_count:
            typeof step.state.strippedPartCount === "number"
              ? step.state.strippedPartCount
              : null,
          context_tokens_before:
            typeof step.state.contextTokensAtTurnEnd === "number"
              ? step.state.contextTokensAtTurnEnd
              : null,
          context_tokens_after:
            typeof step.state.contextTokensAfterCompaction === "number"
              ? step.state.contextTokensAfterCompaction
              : null,
          tokens_removed:
            typeof step.state.compactionTokensRemoved === "number"
              ? step.state.compactionTokensRemoved
              : null,
          ...compactionEvidence,
        }
      : {}),
    // Turn-owning fields (analysis steps) — omitted when empty so a compaction
    // step isn't padded with the analysis-step concepts it never uses.
    ...(ownedTurnIds.length > 0
      ? { owned_turn_ids: ownedTurnIds, turns: ownedTurnNodes }
      : {}),
    ...(postambleStepIds.length > 0
      ? { postamble_step_ids: postambleStepIds }
      : {}),
    // `parts` is the step's own direct content — always present (possibly empty),
    // the step-level parallel to a turn's `rounds`.
    parts: stepParts,
  };
}

function deriveContextWindowUsed(turns: TurnRecord[]): number | null {
  const completed = turns
    .filter((t) => t.status === "complete")
    .sort((a, b) => a.turnNumber - b.turnNumber);
  return completed.at(-1)?.contextTokensAtTurnEnd ?? null;
}

/**
 * A uniform "how did this session end" status, derived the same way for every
 * session kind (primary, analysis, judge). Mirrors the per-session terminal
 * status the run report computes (benchmarkMetrics) so the session header and
 * the run's session list agree. `error` whenever init failed, the analysis
 * workflow ended in error, or the last turn errored; otherwise the last turn's
 * own status (e.g. `complete`, `streaming`).
 */
export function deriveSessionTerminalStatus(
  session: { initStatus: string; status: string; initError?: unknown },
  turns: { turnNumber: number; status: string }[],
  analysisPhase: string | null,
): string {
  if (session.initStatus === "error" || session.initError) return "error";
  if (analysisPhase === "error") return "error";
  const last = [...turns].sort((a, b) => a.turnNumber - b.turnNumber).at(-1);
  return last?.status ?? session.status;
}

/**
 * The stop reason carried by a trailing `diagnostic` part — the canonical "why
 * did a primary session fail" marker (e.g. hitting the tool-round cap). Analysis
 * sessions surface their reason via an analysis diagnostic artifact instead; this
 * fallback gives primary sessions the same top-level failure summary (F9/F10).
 */
function getTrailingDiagnosticError(
  allParts: PartRecord[],
): { step_id: null; error_kind: null; message: string } | null {
  const diagnostic = allParts
    .filter((p) => p.partType === "diagnostic-note" && p.payload.text != null)
    .sort((a, b) => a.ordinal - b.ordinal)
    .at(-1);
  if (!diagnostic?.payload.text) return null;
  return { step_id: null, error_kind: null, message: diagnostic.payload.text };
}

/**
 * Last-resort failure summary: the errored turn itself. A turn can fail mid-stream
 * (a provider/tool error) with no diagnostic part and no rich persisted message —
 * only `status:error` + an `outcome` marker. This still gives the session header a
 * located reason (which turn, and its outcome) so an errored session is never
 * shown with a bare `status:error` and nothing to drill.
 */
function getTerminalTurnError(
  turns: TurnRecord[],
): { step_id: string; error_kind: string; message: string } | null {
  const errored = turns
    .filter((t) => t.status === "error")
    .sort((a, b) => a.turnNumber - b.turnNumber)
    .at(-1);
  if (!errored) return null;
  return {
    step_id: errored.id,
    error_kind: errored.outcome ?? "error",
    message: `Turn ${errored.turnNumber} ended in error.`,
  };
}

// ─── Main resolver ────────────────────────────────────────────────────────────

export function resolveHierarchicalId(
  connection: Database.Database,
  rawId: string,
  mode: LookupMode,
): LookupSuccess | LookupFailure {
  const parsed = parseHierarchicalId(rawId);
  if (!parsed) {
    return { status: "invalid", message: `Invalid hierarchical ID: ${rawId}` };
  }

  // ─── Session ───────────────────────────────────────────────────────────────
  if (parsed.type === "session") {
    const session = getSessionRecord(connection, parsed.sessionId);
    if (!session)
      return {
        status: "not_found",
        message: `Session not found: ${parsed.sessionId}`,
      };

    const turns = listTurnRecordsBySession(connection, session.id).sort(
      (a, b) => a.turnNumber - b.turnNumber,
    );
    const directTurns = turns.filter((t) => !t.ownerStepId);
    const allSteps = listStepRecordsBySession(connection, session.id);
    const steps = allSteps.filter((step) => step.stepTypeKey !== "turn");
    const allParts = listPartRecordsBySession(connection, session.id);
    const artifacts = listArtifactsBySession(connection, session.id);
    const setupParts = allParts
      .filter((p) => p.turnId === null)
      .sort((a, b) => a.ordinal - b.ordinal);
    const allRounds = listRoundRecordsBySession(connection, session.id);
    const analysisState = session.analysisState as {
      workflow_kind?: string;
      phase?: string;
    } | null;
    const workflowKind = (analysisState?.workflow_kind ??
      null) as AnalysisWorkflowKind | null;
    const workflowLabel = getAnalysisWorkflowLabel(workflowKind);
    const terminalStatus = deriveSessionTerminalStatus(
      session,
      turns,
      analysisState?.phase ?? null,
    );
    // One uniform "how did this end and why" across session kinds (F9/F10):
    // prefer an analysis diagnostic, then a persisted init failure, then — for any
    // session that errored — the trailing `diagnostic` part's stop reason, and
    // finally the errored turn itself (a mid-stream failure leaves no diagnostic).
    let latestError =
      getLatestAnalysisDiagnosticSummary(artifacts) ??
      (session.initError
        ? {
            step_id: null as string | null,
            error_kind: session.initError.errorKind as string | null,
            message: session.initError.message,
          }
        : null);
    if (!latestError && terminalStatus === "error") {
      latestError =
        getTrailingDiagnosticError(allParts) ?? getTerminalTurnError(turns);
    }

    // Children (turns + deterministic steps) ordered by actual creation time, so a
    // mid-session compaction reads between the turns it sat between — not after the
    // next turn (the old id-suffix sort tied `2T`/`2C` and misplaced it).
    const childEntries = [
      ...directTurns.map((turn) => {
        const turnRounds = allRounds
          .filter((r) => r.turnId === turn.id)
          .sort((a, b) => a.roundIndex - b.roundIndex);
        return {
          createdAt: turn.createdAt,
          node: buildTurnNode(turn, turnRounds, allParts, mode, false),
        };
      }),
      ...steps.map((step) => ({
        createdAt: step.createdAt,
        node: buildStepNode(
          step,
          steps,
          turns,
          allRounds,
          allParts,
          artifacts,
          mode,
          false,
        ),
      })),
    ];
    const allChildNodes = childEntries
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((e) => e.node);

    const parentRef =
      session.parentKind !== null && session.parentId !== null
        ? { kind: session.parentKind, id: session.parentId }
        : null;
    const mcpData = session.mcpProfileSnapshots.map((s) => ({ name: s.name }));

    // All header/identity metadata is grouped up top (model, mcp, parent, status,
    // failure) before the body (setup + steps), so the JSON reads like the text
    // header and a reader sees "what/where/how did it end" before the trace.
    const data: Record<string, unknown> = {
      id: session.id,
      title: session.title,
      session_type: session.sessionType,
      compaction_strategy: session.compactionStrategy,
      max_tool_rounds: session.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS,
      model: {
        id: session.modelProfileSnapshot.id,
        name: session.modelProfileSnapshot.name,
        key: session.modelProfileSnapshot.modelKey,
        temperature: session.modelProfileSnapshot.temperature,
        reasoning: session.modelProfileSnapshot.reasoning,
      },
      ...(mcpData.length > 0 ? { mcp: mcpData } : {}),
      context_window: {
        available: session.loadedContextLength ?? null,
        used: deriveContextWindowUsed(turns),
      },
      terminal_status: terminalStatus,
      ...(parentRef ? { parent_ref: parentRef } : {}),
      ...(workflowKind ? { workflow_kind: workflowKind } : {}),
      ...(workflowLabel ? { workflow_label: workflowLabel } : {}),
      ...(latestError ? { latest_error: latestError } : {}),
      setup: buildSetupNode(session.id, setupParts, mode, false),
      steps: allChildNodes,
    };

    return {
      status: "ok",
      payload: { id: session.id, type: "session", mode, data },
    };
  }

  // ─── Setup ─────────────────────────────────────────────────────────────────
  if (parsed.type === "setup") {
    const session = getSessionRecord(connection, parsed.sessionId);
    if (!session)
      return {
        status: "not_found",
        message: `Session not found for setup: ${rawId}`,
      };

    const allParts = listPartRecordsBySession(connection, session.id);
    const setupParts = allParts
      .filter((p) => p.turnId === null)
      .sort((a, b) => a.ordinal - b.ordinal);
    const setupId = formatSetupId(session.id);
    const data = buildSetupNode(session.id, setupParts, mode, true);

    return {
      status: "ok",
      payload: { id: setupId, type: "setup", mode, data },
    };
  }

  // ─── Turn ──────────────────────────────────────────────────────────────────
  if (parsed.type === "turn") {
    const turn = getTurnRecord(connection, parsed.raw);
    if (!turn)
      return { status: "not_found", message: `Turn not found: ${parsed.raw}` };

    const allParts = listPartRecordsBySession(connection, turn.sessionId);
    const allRounds = listRoundRecordsBySession(connection, turn.sessionId)
      .filter((r) => r.turnId === turn.id)
      .sort((a, b) => a.roundIndex - b.roundIndex);

    const data = buildTurnNode(turn, allRounds, allParts, mode, false);

    return { status: "ok", payload: { id: turn.id, type: "turn", mode, data } };
  }

  // ─── Step ──────────────────────────────────────────────────────────────────
  if (parsed.type === "step") {
    const step = getStepRecord(connection, parsed.raw);
    if (!step)
      return { status: "not_found", message: `Step not found: ${parsed.raw}` };

    const turns = listTurnRecordsBySession(connection, step.sessionId);
    const rounds = listRoundRecordsBySession(connection, step.sessionId);
    const parts = listPartRecordsBySession(connection, step.sessionId);
    const steps = listStepRecordsBySession(connection, step.sessionId);
    const artifacts = listArtifactsBySession(connection, step.sessionId);
    const data = buildStepNode(
      step,
      steps,
      turns,
      rounds,
      parts,
      artifacts,
      mode,
      true,
    );

    return { status: "ok", payload: { id: step.id, type: "step", mode, data } };
  }

  // ─── Round ─────────────────────────────────────────────────────────────────
  if (parsed.type === "round") {
    const round = getRoundRecord(connection, parsed.raw);
    if (!round)
      return { status: "not_found", message: `Round not found: ${parsed.raw}` };

    const turn = getTurnRecord(connection, round.turnId);
    if (!turn)
      return {
        status: "not_found",
        message: `Turn not found for round: ${parsed.raw}`,
      };

    const sessionParts = listPartRecordsBySession(connection, turn.sessionId);
    const roundParts = sessionParts
      .filter((p) => p.roundId === round.id && isPublicPartType(p.partType))
      .sort((a, b) => a.ordinal - b.ordinal);

    const toolResultsByParent = buildToolResultIndex(sessionParts);
    const data = buildRoundNode(
      round,
      roundParts,
      toolResultsByParent,
      mode,
      true,
    );

    return {
      status: "ok",
      payload: { id: round.id, type: "round", mode, data },
    };
  }

  // ─── Part ──────────────────────────────────────────────────────────────────
  const part = getPartRecord(connection, parsed.raw);
  if (!part)
    return { status: "not_found", message: `Part not found: ${parsed.raw}` };

  const sessionParts = listPartRecordsBySession(connection, part.sessionId);
  const toolResultsByParent = buildToolResultIndex(sessionParts);

  // If this is a tool-result, redirect to its parent tool-call
  const effectivePart =
    part.partType === "tool-result" && part.parentPartId
      ? (getPartRecord(connection, part.parentPartId) ?? part)
      : part;

  const resultParts =
    effectivePart.partType === "tool-call"
      ? (toolResultsByParent.get(effectivePart.id) ?? [])
      : [];

  const node = buildPartNode(effectivePart, resultParts, "full", true, true);
  if (!node)
    return { status: "not_found", message: `Part not found: ${parsed.raw}` };

  return {
    status: "ok",
    payload: { id: effectivePart.id, type: "part", mode: "full", data: node },
  };
}
