import crypto from "node:crypto";
import fs, { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { InspectResult } from "../operations/inspect.js";
import { renderInspect } from "./renderInspect.js";
import { isOmittable } from "./omissionAllowList.js";
import { openBackendDatabase, type BackendDatabase } from "../persistence/db.js";
import {
  createBenchmark,
  createBenchmarkCase,
  createBenchmarkRun,
  createBenchmarkEvaluation,
} from "../persistence/benchmarkRepository.js";
import { resolveBenchmarkInspect } from "../operations/benchmarkOperations.js";
import { inspectOperation } from "../operations/inspect.js";
import type { OperationContext } from "../operations/context.js";
import { registerBenchmarkSchema } from "../persistence/benchmarkSchema.js";

// The workbench registers the benchmark schema extension at startup
// (buildBackendApp); these tests open the database directly, so register it
// here before any openBackendDatabase call.
registerBenchmarkSchema();

// The directional guarantee (serialization-architecture.md, Rule 2):
//   - text ⊆ json is by construction (the renderer's only input is the payload);
//   - json ⊆ text is NOT free — this test enforces it, minus the reviewed
//     omission allow-list. Any *accidental* dropped field fails here.
//
// We check STRING leaves: ids, names, statuses, messages, prompts, content — the
// content-bearing values that should appear verbatim. Numbers are skipped (the
// text legitimately reformats/aggregates them, e.g. 0.5 → "50%").

const here = dirname(fileURLToPath(import.meta.url));

type Leaf = { path: string[]; value: string };

function collectStringLeaves(node: unknown, path: string[], acc: Leaf[]): void {
  if (typeof node === "string") {
    if (node.length > 0) acc.push({ path, value: node });
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectStringLeaves(item, path, acc);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      collectStringLeaves(value, [...path, key], acc);
    }
  }
}

function assertStringCoverage(result: InspectResult): void {
  const text = renderInspect(result, "text");
  const leaves: Leaf[] = [];
  collectStringLeaves(result.data, [], leaves);

  const missing: string[] = [];
  for (const { path, value } of leaves) {
    if (isOmittable(path)) continue;
    // Match the value's first line, prefix-capped: the renderer indents each
    // line of a multi-line value (so the raw "\n…" won't match), and nested
    // overviews cap values at 80 chars. 40 chars of the first line is well under
    // the cap and unique enough to detect an accidental omission.
    const needle = (value.split("\n")[0] ?? "").slice(0, 40);
    if (needle.length > 0 && !text.includes(needle)) {
      missing.push(`${path.join(".")} = ${JSON.stringify(value.slice(0, 60))}`);
    }
  }
  expect(missing, `string leaves missing from text:\n${missing.join("\n")}`).toEqual([]);
}

function loadFixture(name: string): InspectResult {
  return JSON.parse(
    readFileSync(join(here, "__fixtures__", `${name}.json`), "utf8"),
  ) as InspectResult;
}

describe("renderInspect — text coverage (json ⊆ text, minus allow-list)", () => {
  // Runtime types: the reference payloads captured from a real session.
  // `analysis-session-full` is an analysis/judge session (ZTJE): its steps OWN
  // turns, so it guards that the owned-turn trace (the judge's tool calls + verdict)
  // renders in text — the gap that made an analysis-session inspect show only step
  // headers.
  // `multiturn-error-full` is a 2-turn primary session whose 2nd turn errored
  // mid-stream (no diagnostic part): it guards the turn header/`outcome`, the
  // synthesized "errored turn" failure summary, and chronological child ordering
  // (the compaction between turns 1 and 2 renders in order).
  for (const name of [
    "session-full",
    "turn-full",
    "toolcall-full",
    "analysis-session-full",
    "multiturn-error-full",
  ]) {
    it(`covers every string leaf of ${name}`, () => {
      assertStringCoverage(loadFixture(name));
    });
  }

  it("text never contains more than the json (no fabricated lines)", () => {
    // Spot-check the inverse direction is structurally impossible: the renderer
    // takes only `data`, so this is guaranteed by construction; we assert the
    // header id is present as a basic smoke check.
    const r = loadFixture("session-full");
    const text = renderInspect(r, "text");
    expect(text).toContain(r.id);
  });
});

describe("inspectOperation.renderContent — the MCP transport contract", () => {
  // The MCP server renders inspect tool output via op.renderContent. Default is
  // text (compact); `format: 'json'` returns the structural payload as a string.
  const result = loadFixture("session-full");

  it("defaults to text (not JSON)", () => {
    const { text } = inspectOperation.renderContent(result, { id: result.id });
    expect(text).toBe(renderInspect(result, "text"));
    expect(text.startsWith("{")).toBe(false);
  });

  it("returns structural JSON when format=json", () => {
    const { text } = inspectOperation.renderContent(result, {
      id: result.id,
      format: "json",
    });
    expect(JSON.parse(text)).toMatchObject({ id: result.id, type: result.type });
  });
});

describe("renderInspect — benchmark text coverage", () => {
  let dataDir: string | undefined;
  let db: BackendDatabase | undefined;

  afterEach(() => {
    db?.connection.close();
    db = undefined;
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
  });

  function seed(): OperationContext {
    dataDir = `.tmp-test-data/${crypto.randomUUID()}`;
    fs.mkdirSync(dataDir, { recursive: true });
    db = openBackendDatabase(`${dataDir}/t.db`);
    const c = db.connection;
    createBenchmark(c, {
      id: "B-COV",
      name: "Coverage Bench",
      description: "desc",
      createdAt: 1,
      updatedAt: 1,
    });
    createBenchmarkCase(c, {
      id: "B-COV.1",
      benchmarkId: "B-COV",
      name: "winter-temps",
      prompt: "How cold did it get last winter outdoors?",
      orderIndex: 0,
      expectedToolsCalled: ["ha_history_get_sensor_stats"],
      expectedToolsNotCalled: [],
      rubric: [{ id: 1, description: "Correct coldest day", points: 3 }],
      sourceSessionId: null,
      createdAt: 1,
      updatedAt: 1,
    });
    createBenchmarkRun(c, {
      id: "R-COV",
      benchmarkId: "B-COV",
      benchmarkName: "Coverage Bench",
      status: "complete",
      modelConfigId: "gemma-4-12b",
      mcpProfileIds: ["ha-replay"],
      cases: [
        {
          sourceCaseId: "B-COV.1",
          name: "winter-temps",
          prompt: "x",
          expectedToolsCalled: [],
          expectedToolsNotCalled: [],
          rubric: [{ id: 1, description: "Correct coldest day", points: 3 }],
        },
      ],
      repetitions: 1,
      maxToolRounds: 20,
      sessions: [
        { sessionId: "9LJM", sourceCaseId: "B-COV.1", repetition: 0, status: "complete", error: null },
      ],
      error: null,
      createdAt: 1,
      updatedAt: 1,
      startedAt: null,
      completedAt: null,
    });
    createBenchmarkEvaluation(c, {
      id: "E-COV",
      runId: "R-COV",
      judgeModelConfigId: "kimi-k25",
      judgeTemperature: 0,
      status: "complete",
      sessions: [{ runSessionId: "9LJM", analysisSessionId: "CD34", status: "complete" }],
      error: null,
      createdAt: 1,
      updatedAt: 1,
    });
    return { db } as unknown as OperationContext;
  }

  for (const [id, mode] of [
    ["B-COV", "summary"],
    ["R-COV", "summary"],
    ["R-COV", "full"],
    ["E-COV", "summary"],
    ["E-COV", "full"],
  ] as const) {
    it(`covers every string leaf of ${id} (${mode})`, () => {
      const payload = resolveBenchmarkInspect(seed(), id, mode);
      expect(payload).not.toBeNull();
      assertStringCoverage(payload as unknown as InspectResult);
    });
  }
});
