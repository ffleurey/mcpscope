// ─────────────────────────────────────────────────────────────────────────────
// Pure benchmark metrics: derive per-session metrics from persisted parts/turns,
// evaluate optional tool-behavior checks, and aggregate per case + per tool.
// No DB, no LLM — computed on read from already-persisted session state.
// ─────────────────────────────────────────────────────────────────────────────

import type { PartRecord, TurnRecord } from "../domain/model.js";

export interface PerToolCounts {
  calls: number;
  errors: number;
  resultPayloadChars: number;
}

/** Latest error for a session, in the shared latest_error shape. */
export interface SessionErrorSummary {
  step_id: string | null;
  error_kind: string | null;
  message: string;
}

export interface SessionMetrics {
  sessionId: string;
  terminalStatus: string | null;
  completed: boolean;
  toolCallCount: number;
  toolErrorCount: number;
  toolsCalled: string[];
  perTool: Record<string, PerToolCounts>;
  tokens: {
    prompt: number | null;
    completion: number | null;
    reasoning: number | null;
    total: number | null;
  };
  finalAnswer: string | null;
  /** Why the session failed, when it did (e.g. init/MCP failure). Null otherwise. */
  error?: SessionErrorSummary | null;
}

export interface CaseExpectations {
  expectedToolsCalled: string[];
  expectedToolsNotCalled: string[];
}

// Serialized character count (text length + JSON.stringify length). This is a
// RELATIVE size signal for comparing tools/runs, deterministic for the same
// input — not an exact byte/token measurement (it counts JSON punctuation too).
function payloadChars(part: PartRecord): number {
  const text = part.payload.text ? part.payload.text.length : 0;
  const json = part.payload.json ? JSON.stringify(part.payload.json).length : 0;
  return text + json;
}

function sumUsage(
  turns: TurnRecord[],
  field: "promptTokens" | "completionTokens" | "reasoningTokens" | "totalTokens",
): number | null {
  let sum = 0;
  let seen = false;
  for (const turn of turns) {
    const value = turn.usage[field];
    if (value != null) {
      sum += value;
      seen = true;
    }
  }
  return seen ? sum : null;
}

/** Derive deterministic metrics for one finished run-session from its parts + turns. */
export function deriveSessionMetrics(
  sessionId: string,
  parts: PartRecord[],
  turns: TurnRecord[],
): SessionMetrics {
  const perTool: Record<string, PerToolCounts> = {};
  const ensure = (name: string): PerToolCounts =>
    (perTool[name] ??= { calls: 0, errors: 0, resultPayloadChars: 0 });

  let toolCallCount = 0;
  for (const part of parts) {
    if (part.partType === "tool-call") {
      toolCallCount += 1;
      const json = part.payload.json as { name?: unknown } | null;
      const name =
        (typeof json?.name === "string" ? json.name : null) ??
        part.payload.summary ??
        "(unknown)";
      ensure(name).calls += 1;
    }
  }

  let toolErrorCount = 0;
  for (const part of parts) {
    if (part.partType === "tool-result") {
      const prov = part.provenanceJson as
        | { toolName?: unknown; isError?: unknown }
        | null;
      const name =
        (typeof prov?.toolName === "string" ? prov.toolName : null) ??
        part.payload.summary ??
        "(unknown)";
      const counts = ensure(name);
      counts.resultPayloadChars += payloadChars(part);
      if (prov?.isError === true) {
        counts.errors += 1;
        toolErrorCount += 1;
      }
    }
  }

  const sortedTurns = [...turns].sort((a, b) => a.turnNumber - b.turnNumber);
  const lastTurn = sortedTurns[sortedTurns.length - 1] ?? null;

  const finalAnswerPart = [...parts]
    .reverse()
    .find((p) => p.partType === "assistant-content");

  return {
    sessionId,
    terminalStatus: lastTurn?.status ?? null,
    completed: lastTurn?.status === "complete",
    toolCallCount,
    toolErrorCount,
    toolsCalled: Object.keys(perTool).filter((n) => perTool[n]!.calls > 0),
    perTool,
    tokens: {
      prompt: sumUsage(sortedTurns, "promptTokens"),
      completion: sumUsage(sortedTurns, "completionTokens"),
      reasoning: sumUsage(sortedTurns, "reasoningTokens"),
      total: sumUsage(sortedTurns, "totalTokens"),
    },
    finalAnswer: finalAnswerPart?.payload.text ?? null,
  };
}

export function hasChecks(expectations: CaseExpectations): boolean {
  return (
    expectations.expectedToolsCalled.length > 0 ||
    expectations.expectedToolsNotCalled.length > 0
  );
}

/**
 * Evaluate a session against a case's tool-behavior checks.
 * Returns null when the case defines no checks (metrics-only, no verdict).
 * When checks exist, success requires: all expected tools called, no forbidden
 * tools called, no tool errors, and the session completed.
 */
export function evaluateSession(
  expectations: CaseExpectations,
  metrics: SessionMetrics,
): boolean | null {
  if (!hasChecks(expectations)) return null;
  const called = new Set(metrics.toolsCalled);
  const allExpectedCalled = expectations.expectedToolsCalled.every((t) =>
    called.has(t),
  );
  const noForbidden = expectations.expectedToolsNotCalled.every(
    (t) => !called.has(t),
  );
  return (
    allExpectedCalled &&
    noForbidden &&
    metrics.toolErrorCount === 0 &&
    metrics.completed
  );
}

// ── Aggregation ────────────────────────────────────────────────────────────

export interface NumberStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  stddev: number;
}

export function numberStats(values: number[]): NumberStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const mid = Math.floor(n / 2);
  const median =
    n % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return {
    min: sorted[0]!,
    max: sorted[n - 1]!,
    mean,
    median,
    stddev: Math.sqrt(variance),
  };
}

export interface CaseReport {
  caseId: string;
  prompt: string;
  repetitions: number;
  sessionCount: number;
  hasChecks: boolean;
  /** Number of sessions that passed the checks (null when the case has no checks). */
  passCount: number | null;
  /** At least one repetition passed (pass@k). Null when no checks. */
  passAtK: boolean | null;
  /** All repetitions passed (pass^k — reliability). Null when no checks. */
  passHatK: boolean | null;
  successRate: number | null;
  completedCount: number;
  toolErrorCount: number;
  toolCallStats: NumberStats | null;
  totalTokenStats: NumberStats | null;
  perTool: Record<string, PerToolCounts>;
  sessions: SessionMetrics[];
}

export interface PerToolRollup {
  calls: number;
  errors: number;
  errorRate: number;
  resultPayloadChars: number;
  casesUsedIn: number;
}

export interface RunReport {
  runId: string;
  benchmarkId: string;
  status: string;
  repetitions: number;
  caseCount: number;
  sessionCount: number;
  cases: CaseReport[];
  /** Cross-case per-tool rollup — the headline "which tools cause issues" view. */
  perTool: Record<string, PerToolRollup>;
}

function mergePerTool(
  into: Record<string, PerToolCounts>,
  from: Record<string, PerToolCounts>,
): void {
  for (const [name, counts] of Object.entries(from)) {
    const target = (into[name] ??= {
      calls: 0,
      errors: 0,
      resultPayloadChars: 0,
    });
    target.calls += counts.calls;
    target.errors += counts.errors;
    target.resultPayloadChars += counts.resultPayloadChars;
  }
}

export function buildCaseReport(
  caseId: string,
  prompt: string,
  expectations: CaseExpectations,
  repetitions: number,
  sessions: SessionMetrics[],
): CaseReport {
  const checks = hasChecks(expectations);
  const verdicts = sessions.map((s) => evaluateSession(expectations, s));
  const passCount = checks ? verdicts.filter((v) => v === true).length : null;
  const perTool: Record<string, PerToolCounts> = {};
  for (const s of sessions) mergePerTool(perTool, s.perTool);
  const totalTokens = sessions
    .map((s) => s.tokens.total)
    .filter((t): t is number => t != null);

  return {
    caseId,
    prompt,
    repetitions,
    sessionCount: sessions.length,
    hasChecks: checks,
    passCount,
    passAtK: checks ? (passCount ?? 0) > 0 : null,
    // pass^k means "all K repetitions passed" — on a partial run (stopped
    // before producing all repetitions) it is undetermined (null), not "all
    // produced sessions passed".
    passHatK:
      checks && sessions.length >= repetitions && sessions.length > 0
        ? passCount === sessions.length
        : null,
    successRate:
      checks && sessions.length > 0
        ? (passCount ?? 0) / sessions.length
        : null,
    completedCount: sessions.filter((s) => s.completed).length,
    toolErrorCount: sessions.reduce((a, s) => a + s.toolErrorCount, 0),
    toolCallStats: numberStats(sessions.map((s) => s.toolCallCount)),
    totalTokenStats: numberStats(totalTokens),
    perTool,
    sessions,
  };
}

export function buildPerToolRollup(
  cases: CaseReport[],
): Record<string, PerToolRollup> {
  const rollup: Record<string, PerToolRollup> = {};
  for (const c of cases) {
    for (const [name, counts] of Object.entries(c.perTool)) {
      const entry = (rollup[name] ??= {
        calls: 0,
        errors: 0,
        errorRate: 0,
        resultPayloadChars: 0,
        casesUsedIn: 0,
      });
      entry.calls += counts.calls;
      entry.errors += counts.errors;
      entry.resultPayloadChars += counts.resultPayloadChars;
      entry.casesUsedIn += 1;
    }
  }
  for (const entry of Object.values(rollup)) {
    // errors recorded without a matched call (call/result name attribution
    // can diverge) must not read as a 0% error rate.
    entry.errorRate =
      entry.calls > 0 ? entry.errors / entry.calls : entry.errors > 0 ? 1 : 0;
  }
  return rollup;
}
