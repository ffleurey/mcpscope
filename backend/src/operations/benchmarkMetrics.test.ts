import { describe, expect, it } from "vitest";
import type { PartRecord, TurnRecord } from "mcpscope-engine/domain/model.js";
import {
  deriveSessionMetrics,
  evaluateSession,
  buildCaseReport,
  buildPerToolRollup,
  numberStats,
} from "./benchmarkMetrics.js";

function part(
  partType: PartRecord["partType"],
  overrides: Partial<PartRecord> = {},
): PartRecord {
  return {
    id: overrides.id ?? `p-${Math.random().toString(36).slice(2)}`,
    sessionId: "S1",
    turnId: "T1",
    roundId: "R1",
    parentPartId: null,
    ordinal: 0,
    partType,
    roleLabel: null,
    payload: { text: null, json: null, mimeType: null, summary: null },
    display: { state: "transcript", collapsedByDefault: false },
    context: { state: "included", note: null, strippedByCompactionAtTurnId: null },
    tokens: { count: null, source: "unknown", confidence: "unknown", note: null },
    provenanceJson: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as PartRecord;
}

function turn(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    id: "T1",
    sessionId: "S1",
    ownerStepId: null,
    turnNumber: 0,
    status: "complete",
    createdAt: 1,
    completedAt: 2,
    outcome: null,
    usage: {
      promptTokens: 100,
      completionTokens: 20,
      reasoningTokens: 5,
      totalTokens: 120,
    },
    contextTokensAtTurnEnd: null,
    contextTokensAfterCompaction: null,
    compactionApplied: null,
    compactionTokensRemoved: null,
    ...overrides,
  };
}

function toolCall(name: string): PartRecord {
  return part("tool-call", {
    payload: {
      text: null,
      json: { id: `c-${name}`, name, arguments: "{}" },
      mimeType: "application/json",
      summary: name,
    },
  });
}

function toolResult(name: string, isError: boolean, body: string): PartRecord {
  return part("tool-result", {
    payload: { text: body, json: null, mimeType: "application/json", summary: name },
    provenanceJson: { toolCallId: `c-${name}`, toolName: name, isError },
  });
}

describe("deriveSessionMetrics", () => {
  it("counts tool calls, errors, payload size, tokens, and the final answer", () => {
    const parts: PartRecord[] = [
      part("user-message", { payload: { text: "hi", json: null, mimeType: null, summary: null } }),
      toolCall("get_stats"),
      toolResult("get_stats", false, "42 kWh"),
      toolCall("broken_tool"),
      toolResult("broken_tool", true, "boom"),
      part("assistant-content", {
        payload: { text: "You used 42 kWh.", json: null, mimeType: null, summary: null },
      }),
    ];
    const m = deriveSessionMetrics("S1", parts, [turn()]);

    expect(m.toolCallCount).toBe(2);
    expect(m.toolErrorCount).toBe(1);
    expect(m.toolsCalled.sort()).toEqual(["broken_tool", "get_stats"]);
    expect(m.perTool.get_stats).toEqual({
      calls: 1,
      errors: 0,
      resultPayloadChars: "42 kWh".length,
    });
    expect(m.perTool.broken_tool).toEqual({
      calls: 1,
      errors: 1,
      resultPayloadChars: "boom".length,
    });
    expect(m.tokens.total).toBe(120);
    expect(m.completed).toBe(true);
    expect(m.terminalStatus).toBe("complete");
    expect(m.finalAnswer).toBe("You used 42 kWh.");
  });

  it("marks a non-completed session and null tokens", () => {
    const m = deriveSessionMetrics(
      "S1",
      [],
      [turn({ status: "error", usage: { promptTokens: null, completionTokens: null, reasoningTokens: null, totalTokens: null } })],
    );
    expect(m.completed).toBe(false);
    expect(m.terminalStatus).toBe("error");
    expect(m.tokens.total).toBeNull();
    expect(m.toolCallCount).toBe(0);
  });
});

describe("evaluateSession", () => {
  const clean = deriveSessionMetrics(
    "S1",
    [toolCall("get_stats"), toolResult("get_stats", false, "ok")],
    [turn()],
  );

  it("returns null when the case has no checks", () => {
    expect(
      evaluateSession({ expectedToolsCalled: [], expectedToolsNotCalled: [] }, clean),
    ).toBeNull();
  });

  it("passes when expected tools called, none forbidden, no errors, completed", () => {
    expect(
      evaluateSession(
        { expectedToolsCalled: ["get_stats"], expectedToolsNotCalled: ["delete_all"] },
        clean,
      ),
    ).toBe(true);
  });

  it("fails when a tool errored", () => {
    const errored = deriveSessionMetrics(
      "S1",
      [toolCall("get_stats"), toolResult("get_stats", true, "boom")],
      [turn()],
    );
    expect(
      evaluateSession({ expectedToolsCalled: ["get_stats"], expectedToolsNotCalled: [] }, errored),
    ).toBe(false);
  });

  it("fails when a forbidden tool was called", () => {
    expect(
      evaluateSession({ expectedToolsCalled: [], expectedToolsNotCalled: ["get_stats"] }, clean),
    ).toBe(false);
  });
});

describe("buildCaseReport + pass@k/pass^k", () => {
  it("reports success rate, pass@k (any), and pass^k (all)", () => {
    const passing = deriveSessionMetrics(
      "S1",
      [toolCall("get_stats"), toolResult("get_stats", false, "ok")],
      [turn({ usage: { promptTokens: 10, completionTokens: 2, reasoningTokens: 0, totalTokens: 12 } })],
    );
    const failing = deriveSessionMetrics(
      "S2",
      [toolCall("get_stats"), toolResult("get_stats", true, "boom")],
      [turn({ id: "T2", usage: { promptTokens: 30, completionTokens: 4, reasoningTokens: 0, totalTokens: 34 } })],
    );
    const report = buildCaseReport(
      "bc-1",
      "What are my stats?",
      { expectedToolsCalled: ["get_stats"], expectedToolsNotCalled: [] },
      2,
      [passing, failing],
    );

    expect(report.hasChecks).toBe(true);
    expect(report.passCount).toBe(1);
    expect(report.passAtK).toBe(true); // at least one passed
    expect(report.passHatK).toBe(false); // not all passed
    expect(report.successRate).toBe(0.5);
    expect(report.totalTokenStats).toMatchObject({ min: 12, max: 34, mean: 23 });
    expect(report.perTool.get_stats?.calls).toBe(2);
    expect(report.perTool.get_stats?.errors).toBe(1);
  });

  it("reports pass^k as null (undetermined) on a partial run, not true", () => {
    const passing = deriveSessionMetrics(
      "S1",
      [toolCall("get_stats"), toolResult("get_stats", false, "ok")],
      [turn()],
    );
    // 5 repetitions requested, only 1 produced (run stopped early): the one
    // session passed, but "all repetitions passed" cannot be claimed.
    const report = buildCaseReport(
      "bc-partial",
      "What are my stats?",
      { expectedToolsCalled: ["get_stats"], expectedToolsNotCalled: [] },
      5,
      [passing],
    );
    expect(report.passAtK).toBe(true);
    expect(report.passHatK).toBeNull();
  });

  it("reports metrics with null success when the case has no checks", () => {
    const m = deriveSessionMetrics("S1", [], [turn()]);
    const report = buildCaseReport(
      "bc-2",
      "open-ended",
      { expectedToolsCalled: [], expectedToolsNotCalled: [] },
      1,
      [m],
    );
    expect(report.hasChecks).toBe(false);
    expect(report.passCount).toBeNull();
    expect(report.passHatK).toBeNull();
    expect(report.successRate).toBeNull();
    expect(report.completedCount).toBe(1);
  });

  it("handles a case that produced zero sessions (with checks)", () => {
    const report = buildCaseReport(
      "bc-3",
      "never ran",
      { expectedToolsCalled: ["get_stats"], expectedToolsNotCalled: [] },
      3,
      [],
    );
    expect(report.sessionCount).toBe(0);
    expect(report.hasChecks).toBe(true);
    expect(report.passCount).toBe(0);
    expect(report.passAtK).toBe(false);
    // pass^k and success rate are undefined with no sessions → null, not false/0.
    expect(report.passHatK).toBeNull();
    expect(report.successRate).toBeNull();
    expect(report.completedCount).toBe(0);
    expect(report.toolCallStats).toBeNull();
    expect(report.totalTokenStats).toBeNull();
  });
});

describe("buildPerToolRollup", () => {
  it("rolls up calls/errors/error-rate across cases", () => {
    const c1 = buildCaseReport(
      "bc-1",
      "a",
      { expectedToolsCalled: [], expectedToolsNotCalled: [] },
      1,
      [deriveSessionMetrics("S1", [toolCall("t"), toolResult("t", true, "x")], [turn()])],
    );
    const c2 = buildCaseReport(
      "bc-2",
      "b",
      { expectedToolsCalled: [], expectedToolsNotCalled: [] },
      1,
      [deriveSessionMetrics("S2", [toolCall("t"), toolResult("t", false, "y")], [turn()])],
    );
    const rollup = buildPerToolRollup([c1, c2]);
    expect(rollup.t).toMatchObject({ calls: 2, errors: 1, errorRate: 0.5, casesUsedIn: 2 });
  });
});

describe("numberStats", () => {
  it("computes min/max/mean/median/stddev and null for empty", () => {
    expect(numberStats([])).toBeNull();
    expect(numberStats([2, 4, 4, 4, 5, 5, 7, 9])).toMatchObject({
      min: 2,
      max: 9,
      mean: 5,
      median: 4.5,
      stddev: 2,
    });
  });

  it("handles a single value (median = value, stddev 0)", () => {
    expect(numberStats([7])).toEqual({
      min: 7,
      max: 7,
      mean: 7,
      median: 7,
      stddev: 0,
    });
  });
});
