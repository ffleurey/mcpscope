// ─────────────────────────────────────────────────────────────────────────────
// Pure scoring for benchmark LLM evaluations. Given per-session awarded/max points
// (read from the judge verdict artifacts), compute per-case distributions and an
// overall percentage. No DB, no LLM — computed on read. Reuses numberStats.
// ─────────────────────────────────────────────────────────────────────────────

import { numberStats, type NumberStats } from "./benchmarkMetrics.js";

export interface EvaluationSessionScore {
  runSessionId: string;
  analysisSessionId: string;
  sourceCaseId: string;
  status: string;
  awarded: number | null;
  max: number | null;
  /** awarded / max in [0,1], or null when no verdict was produced. */
  pct: number | null;
}

export interface EvaluationCaseScore {
  sourceCaseId: string;
  name: string | null;
  sessions: EvaluationSessionScore[];
  /** Distribution of session pct across this case's repetitions (null if none scored). */
  pctStats: NumberStats | null;
}

export interface EvaluationScore {
  /** Mean session pct across all scored sessions in the evaluation (null if none). */
  overallPct: number | null;
  cases: EvaluationCaseScore[];
}

/** awarded / max in [0,1]; null when either is missing or max is 0. */
export function scorePct(awarded: number | null, max: number | null): number | null {
  if (awarded == null || max == null || max <= 0) return null;
  return awarded / max;
}

/**
 * Group per-session scores by case and compute the per-case distribution (the
 * spread is the reliability signal) plus the overall mean pct. The mean is taken
 * over all scored sessions; a run uses the same repetition count for every case,
 * so this equals the mean of per-case means.
 */
export function aggregateEvaluationScore(
  sessions: EvaluationSessionScore[],
  caseNames: Map<string, string | null>,
): EvaluationScore {
  const byCase = new Map<string, EvaluationSessionScore[]>();
  for (const s of sessions) {
    byCase.set(s.sourceCaseId, [...(byCase.get(s.sourceCaseId) ?? []), s]);
  }

  const cases: EvaluationCaseScore[] = [...byCase.entries()].map(
    ([sourceCaseId, caseSessions]) => ({
      sourceCaseId,
      name: caseNames.get(sourceCaseId) ?? null,
      sessions: caseSessions,
      pctStats: numberStats(
        caseSessions.map((s) => s.pct).filter((p): p is number => p != null),
      ),
    }),
  );

  const allPcts = sessions
    .map((s) => s.pct)
    .filter((p): p is number => p != null);
  const overallPct =
    allPcts.length > 0
      ? allPcts.reduce((a, b) => a + b, 0) / allPcts.length
      : null;

  return { overallPct, cases };
}
