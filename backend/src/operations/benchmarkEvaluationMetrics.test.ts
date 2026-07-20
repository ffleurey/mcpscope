import { describe, expect, it } from "vitest";
import {
  scorePct,
  aggregateEvaluationScore,
  aggregateEvaluationDiagnostics,
  type EvaluationSessionScore,
} from "./benchmarkEvaluationMetrics.js";

describe("scorePct", () => {
  it("computes awarded / max", () => {
    expect(scorePct(3, 4)).toBeCloseTo(0.75);
    expect(scorePct(0, 5)).toBe(0);
  });
  it("returns null when missing or max is 0", () => {
    expect(scorePct(null, 4)).toBeNull();
    expect(scorePct(2, null)).toBeNull();
    expect(scorePct(2, 0)).toBeNull();
  });
});

function s(
  sourceCaseId: string,
  pct: number | null,
  overrides: Partial<EvaluationSessionScore> = {},
): EvaluationSessionScore {
  return {
    runSessionId: `rs-${Math.random()}`,
    analysisSessionId: `as-${Math.random()}`,
    sourceCaseId,
    status: pct == null ? "error" : "complete",
    awarded: pct == null ? null : pct * 4,
    max: pct == null ? null : 4,
    pct,
    criteria: [],
    toolRounds: null,
    hitToolCap: false,
    errorKind: pct == null ? "no_verdict" : null,
    ...overrides,
  };
}

describe("aggregateEvaluationScore", () => {
  it("groups by case, computes per-case distribution and overall mean", () => {
    const names = new Map([
      ["c1", "Case one"],
      ["c2", "Case two"],
    ]);
    const out = aggregateEvaluationScore(
      [s("c1", 1), s("c1", 0.5), s("c2", 0.25)],
      names,
    );
    // overall = mean(1, 0.5, 0.25) = 0.5833…
    expect(out.overallPct).toBeCloseTo(0.5833, 3);
    expect(out.cases).toHaveLength(2);
    const c1 = out.cases.find((c) => c.sourceCaseId === "c1")!;
    expect(c1.name).toBe("Case one");
    expect(c1.pctStats?.mean).toBeCloseTo(0.75);
    expect(c1.pctStats?.min).toBeCloseTo(0.5);
    expect(c1.pctStats?.max).toBeCloseTo(1);
  });

  it("excludes unscored (errored) sessions from stats but keeps them listed", () => {
    const out = aggregateEvaluationScore(
      [s("c1", 1), s("c1", null)],
      new Map([["c1", null]]),
    );
    const c1 = out.cases[0]!;
    expect(c1.sessions).toHaveLength(2);
    expect(c1.pctStats?.mean).toBe(1); // only the scored session counts
    expect(out.overallPct).toBe(1);
  });

  it("returns null overall when nothing was scored", () => {
    const out = aggregateEvaluationScore([s("c1", null)], new Map([["c1", null]]));
    expect(out.overallPct).toBeNull();
    expect(out.cases[0]?.pctStats).toBeNull();
  });
});

describe("aggregateEvaluationDiagnostics", () => {
  it("counts cap hits, tallies error kinds, and summarizes judge round usage", () => {
    const out = aggregateEvaluationDiagnostics([
      s("c1", 1, { toolRounds: 3 }),
      s("c1", null, { toolRounds: 20, hitToolCap: true, errorKind: "no_verdict" }),
      s("c2", null, { toolRounds: 20, hitToolCap: true, errorKind: "no_verdict" }),
      s("c2", null, { toolRounds: 12, errorKind: "json_parse_error" }),
    ]);
    expect(out.hitToolCapCount).toBe(2);
    expect(out.byErrorKind).toEqual({ no_verdict: 2, json_parse_error: 1 });
    expect(out.toolRoundsStats?.max).toBe(20);
    expect(out.toolRoundsStats?.min).toBe(3);
  });

  it("is empty/null when there are no diagnostics to report", () => {
    const out = aggregateEvaluationDiagnostics([s("c1", 1, { toolRounds: null })]);
    expect(out.hitToolCapCount).toBe(0);
    expect(out.byErrorKind).toEqual({});
    expect(out.toolRoundsStats).toBeNull();
  });
});
