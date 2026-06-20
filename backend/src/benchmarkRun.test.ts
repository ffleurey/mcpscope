import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildBackendApp } from "./app.js";

function makeTestConfig() {
  const dataDir = `.tmp-test-data/${crypto.randomUUID()}`;
  return {
    host: "127.0.0.1",
    port: 3030,
    corsOrigin: true as const,
    dataDir,
    sqlitePath: `${dataDir}/test.db`,
    maxToolRounds: 5,
    appVersion: "test",
  };
}

// Stub gateways: a model-only completion (no tool calls), so the run needs no MCP.
function stubGateways(): Parameters<typeof buildBackendApp>[1] {
  return {
    chatCompletionGateway: {
      async probePromptTokensDetailed() {
        return {
          promptTokens: 3,
          completion: {
            id: "probe-1",
            model: "model-key",
            created: 1,
            choices: [],
            usage: { prompt_tokens: 3, completion_tokens: 0, total_tokens: 3 },
          },
          rawExchange: {
            requestUrl: "https://example.com/v1/chat/completions",
            requestMethod: "POST",
            requestHeadersJson: {},
            requestBody: "{}",
            responseStatus: 200,
            responseHeadersJson: {},
            responseBody: "{}",
          },
        };
      },
      async createChatCompletion() {
        throw new Error("not used");
      },
      async streamChatCompletion() {
        return {
          completion: {
            id: "cmpl-1",
            model: "model-key",
            created: 2,
            choices: [
              {
                index: 0,
                finish_reason: "stop" as const,
                message: { role: "assistant" as const, content: "Done." },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
          },
          segments: [{ kind: "content" as const, text: "Done." }],
          rawResponseBody:
            'data: {"choices":[{"delta":{"content":"Done."}}]}\n\n' +
            'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":6,"total_tokens":16}}\n\n' +
            "data: [DONE]\n",
          chunks: [],
        };
      },
    },
    mcpGateway: {
      async initializeSession() {
        throw new Error("not used");
      },
      async listTools() {
        throw new Error("not used");
      },
      async callTool() {
        throw new Error("not used");
      },
    },
  };
}

async function seedModelConfig(app: FastifyInstance) {
  const conn = await app.inject({
    method: "PUT",
    url: "/api/lm-connections/lm-1",
    payload: {
      id: "lm-1",
      name: "Local",
      baseUrl: "https://example.com/v1",
      apiKey: "test-key",
      providerType: "lmstudio",
      createdAt: 1,
      updatedAt: 2,
    },
  });
  expect(conn.statusCode).toBe(200);
  const mc = await app.inject({
    method: "PUT",
    url: "/api/model-configs/model-config-1",
    payload: {
      id: "model-config-1",
      name: "Primary model",
      connectionId: "lm-1",
      connectionName: "Local",
      modelKey: "model-key",
      modelDisplayName: "Model Key",
      systemPrompt: "Reply exactly.",
      temperature: 0,
      reasoning: "off" as const,
      createdAt: 3,
      updatedAt: 4,
    },
  });
  expect(mc.statusCode).toBe(200);
}

async function pollRunUntilTerminal(app: FastifyInstance, runId: string) {
  for (let i = 0; i < 100; i++) {
    const res = await app.inject({ method: "GET", url: `/api/benchmark-runs/${runId}` });
    const body = res.json();
    if (body.run.status === "complete" || body.run.status === "error") return body;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("benchmark run did not reach a terminal state in time");
}

describe("benchmark run", () => {
  let app: FastifyInstance | undefined;
  let dataDir: string | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
  });

  it("runs a benchmark end to end and computes a report", async () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    app = await buildBackendApp(config, stubGateways());
    await seedModelConfig(app);

    // Create a benchmark.
    const created = await app.inject({
      method: "POST",
      url: "/api/benchmarks",
      payload: { name: "Weather suite", description: "smoke" },
    });
    expect(created.statusCode).toBe(200);
    const benchmarkId = created.json().benchmark.id as string;

    // Add a case (no tool expectations — metrics-only).
    const caseRes = await app.inject({
      method: "POST",
      url: `/api/benchmarks/${benchmarkId}/cases`,
      payload: { prompt: "What is the weather?" },
    });
    expect(caseRes.statusCode).toBe(201);

    // Launch a run with 2 repetitions, explicit model config, no MCP.
    const runRes = await app.inject({
      method: "POST",
      url: `/api/benchmarks/${benchmarkId}/runs`,
      payload: { repetitions: 2, modelConfigId: "model-config-1", mcpProfileIds: [] },
    });
    expect(runRes.statusCode).toBe(202);
    const runId = runRes.json().run.id as string;
    expect(runRes.json().run.status).toBe("pending");

    // Poll until the background coordinator finishes.
    const body = await pollRunUntilTerminal(app, runId);
    expect(body.run.error).toBeNull();
    expect(body.run.status).toBe("complete");

    const report = body.report;
    expect(report.sessionCount).toBe(2);
    expect(report.caseCount).toBe(1);
    expect(report.cases).toHaveLength(1);

    const caseReport = report.cases[0];
    expect(caseReport.sessionCount).toBe(2);
    expect(caseReport.completedCount).toBe(2);
    expect(caseReport.hasChecks).toBe(false);
    expect(caseReport.passCount).toBeNull();
    // Token totals were recorded for both sessions.
    expect(caseReport.totalTokenStats).not.toBeNull();
    expect(caseReport.totalTokenStats.min).toBeGreaterThan(0);
    // Model-only run: no tools exercised.
    expect(Object.keys(report.perTool)).toHaveLength(0);

    // Both produced sessions are recorded on the run, parented to it.
    expect(body.run.sessions).toHaveLength(2);
    for (const s of body.run.sessions) {
      expect(s.sourceCaseId).toBeTruthy();
      expect([1, 2]).toContain(s.repetition);
    }

    // The run is a self-describing snapshot: effective model/MCP + case content + benchmark name.
    expect(body.run.modelConfigId).toBe("model-config-1");
    expect(body.run.mcpProfileIds).toEqual([]);
    expect(body.run.benchmarkName).toBe("Weather suite");
    expect(body.run.cases).toHaveLength(1);
    expect(body.run.cases[0].prompt).toBe("What is the weather?");
    expect(body.run.id).toMatch(/^R-[A-HJ-NP-Z2-9]{4}$/);

    // A case can be extracted from a produced session (first user message).
    const sourceSessionId = body.run.sessions[0].sessionId as string;
    const extractRes = await app.inject({
      method: "POST",
      url: `/api/benchmarks/${benchmarkId}/cases/from-session`,
      payload: { sessionId: sourceSessionId, name: "Extracted" },
    });
    expect(extractRes.statusCode).toBe(201);
    const extracted = extractRes.json().case;
    expect(extracted.prompt).toBe("What is the weather?");
    expect(extracted.sourceSessionId).toBe(sourceSessionId);
    expect(extracted.name).toBe("Extracted");
    expect(extracted.expectedToolsCalled).toEqual([]); // model-only, no tools

    // Snapshot independence: editing the case then deleting the whole benchmark
    // must NOT alter the past run or its report.
    const originalCaseId = body.run.cases[0].sourceCaseId as string;
    await app.inject({
      method: "PATCH",
      url: `/api/benchmark-cases/${originalCaseId}`,
      payload: { prompt: "EDITED PROMPT" },
    });
    const del = await app.inject({
      method: "DELETE",
      url: `/api/benchmarks/${benchmarkId}`,
    });
    expect(del.statusCode).toBe(204);

    const after = await app.inject({
      method: "GET",
      url: `/api/benchmark-runs/${runId}`,
    });
    expect(after.statusCode).toBe(200); // run survives benchmark deletion
    const afterBody = after.json();
    expect(afterBody.run.cases[0].prompt).toBe("What is the weather?");
    expect(afterBody.report.cases[0].prompt).toBe("What is the weather?");
    expect(afterBody.report.sessionCount).toBe(2);
  });

  it("runs via the snake_case catalog operations and reports progress", async () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    app = await buildBackendApp(config, stubGateways());
    await seedModelConfig(app);

    // The catalog ops (CLI/MCP surface) are mounted under /api/operations/*.
    const created = await app.inject({
      method: "POST",
      url: "/api/operations/benchmark-create",
      payload: { name: "ops suite" },
    });
    expect(created.statusCode).toBe(200);
    const benchmarkId = created.json().benchmark.id as string;
    expect(benchmarkId).toMatch(/^B-[A-HJ-NP-Z2-9]{4}$/);

    const caseRes = await app.inject({
      method: "POST",
      url: "/api/operations/benchmark-add-case",
      payload: { benchmark_id: benchmarkId, prompt: "What is the weather?" },
    });
    expect(caseRes.statusCode).toBe(200);
    expect(caseRes.json().case.id).toMatch(/^B-[A-HJ-NP-Z2-9]{4}\.\d+$/);

    const runRes = await app.inject({
      method: "POST",
      url: "/api/operations/benchmark-run",
      payload: {
        benchmark_id: benchmarkId,
        repetitions: 2,
        model_config_id: "model-config-1",
        mcp_profile_ids: [],
      },
    });
    expect(runRes.statusCode).toBe(200);
    const runId = runRes.json().run.id as string;
    expect(runId).toMatch(/^R-[A-HJ-NP-Z2-9]{4}$/);

    // Poll the snake_case progress endpoint until terminal.
    let status: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) {
      const res = await app.inject({
        method: "GET",
        url: `/api/operations/benchmark-runs/${runId}/status`,
      });
      status = res.json();
      if (status.status === "complete" || status.status === "error") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(status.status).toBe("complete");
    expect(status.total_sessions).toBe(2);
    expect(status.completed_sessions).toBe(2);
    expect(status.failed_sessions).toBe(0);
    expect(status.per_case).toMatchObject([{ completed: 2, total: 2 }]);

    const reportRes = await app.inject({
      method: "GET",
      url: `/api/operations/benchmark-runs/${runId}/report`,
    });
    expect(reportRes.statusCode).toBe(200);
    const reportBody = reportRes.json();
    expect(reportBody.run.id).toBe(runId);
    expect(reportBody.report.session_count).toBe(2);
    expect(reportBody.report.cases).toHaveLength(1);
    expect(reportBody.report.cases[0]).toHaveProperty("success_rate");
    expect(reportBody.report.per_tool).toBeDefined();
  });

  it("surfaces benchmark errors as HTTP statuses", async () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    app = await buildBackendApp(config, stubGateways());
    await seedModelConfig(app);

    // Unknown run id → 404.
    const notFound = await app.inject({
      method: "GET",
      url: "/api/operations/benchmark-runs/R-ZZZZ/status",
    });
    expect(notFound.statusCode).toBe(404);

    // Running a benchmark with no cases → 400 (benchmark_empty).
    const created = await app.inject({
      method: "POST",
      url: "/api/operations/benchmark-create",
      payload: { name: "empty" },
    });
    const benchmarkId = created.json().benchmark.id as string;
    const emptyRun = await app.inject({
      method: "POST",
      url: "/api/operations/benchmark-run",
      payload: { benchmark_id: benchmarkId, model_config_id: "model-config-1", mcp_profile_ids: [] },
    });
    expect(emptyRun.statusCode).toBe(400);
  });

  it("evaluates a completed run with a judge model and records per-session verdicts", async () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;

    // Gateways: stub run turn (streamChatCompletion) + judge verdict
    // (createChatCompletion) + an analysis-capable MCP gateway (/mcp/analysis).
    const base = stubGateways() as NonNullable<Parameters<typeof buildBackendApp>[1]>;
    const mcpRaw = {
      requestUrl: "http://localhost:3030/mcp/analysis",
      requestMethod: "POST",
      requestBodyText: "{}",
      responseStatus: 200,
      responseBody: {},
    };
    // The judge turn awards 9 to a max-2 criterion (clamping survives the flow).
    // The shared round runner prefers streamChatCompletion when present, so the
    // judge verdict must come through the streamed path too (the run task turn
    // also gets it as its answer — harmless for this test).
    const verdict = JSON.stringify({
      criteria: [{ id: 1, points: 9, note: "answer matched, cited part" }],
      comment: "fine",
    });
    const completion = {
      id: "cmpl-judge",
      object: "chat.completion",
      model: "model-key",
      created: 1,
      choices: [
        {
          index: 0,
          finish_reason: "stop" as const,
          message: { role: "assistant" as const, content: verdict },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    };
    const gateways: Parameters<typeof buildBackendApp>[1] = {
      chatCompletionGateway: {
        ...base.chatCompletionGateway,
        async streamChatCompletion() {
          return {
            completion,
            segments: [{ kind: "content" as const, text: verdict }],
            rawResponseBody:
              `data: {"choices":[{"delta":{"content":${JSON.stringify(verdict)}}}]}\n\n` +
              "data: [DONE]\n",
            chunks: [],
          };
        },
        async createChatCompletion() {
          return completion;
        },
      },
      mcpGateway: {
        async initializeSession() {
          return { sessionId: "mcp-analysis", instructions: undefined, rawExchange: mcpRaw };
        },
        async listTools() {
          return {
            tools: [
              { name: "mcpscope_inspect", description: "x", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
              { name: "mcpscope_status", description: "x", inputSchema: { type: "object", properties: {} } },
            ],
            rawResult: {},
            rawExchange: mcpRaw,
          };
        },
        async callTool(_url, _sid, _name, args: Record<string, unknown>) {
          return {
            content: JSON.stringify({ id: args["id"] ?? "x", type: "session", data: {} }),
            structuredContent: null,
            isError: false,
            rawResult: {},
            rawExchange: mcpRaw,
          };
        },
      },
    };
    app = await buildBackendApp(config, gateways);
    await seedModelConfig(app);

    const benchmarkId = (
      await app.inject({ method: "POST", url: "/api/benchmarks", payload: { name: "Judge suite" } })
    ).json().benchmark.id as string;

    // A case WITH a rubric (so the judge has criteria to score).
    const caseRes = await app.inject({
      method: "POST",
      url: `/api/benchmarks/${benchmarkId}/cases`,
      payload: {
        prompt: "What is the weather?",
        rubric: [{ id: 1, description: "Answers the question", points: 2 }],
      },
    });
    expect(caseRes.statusCode).toBe(201);
    expect(caseRes.json().case.rubric).toHaveLength(1);

    const runId = (
      await app.inject({
        method: "POST",
        url: `/api/benchmarks/${benchmarkId}/runs`,
        payload: { repetitions: 2, modelConfigId: "model-config-1", mcpProfileIds: [] },
      })
    ).json().run.id as string;
    await pollRunUntilTerminal(app, runId);

    // Launch an evaluation pass with a judge model.
    const evalRes = await app.inject({
      method: "POST",
      url: `/api/benchmark-runs/${runId}/evaluations`,
      payload: { judgeModelConfigId: "model-config-1" },
    });
    expect(evalRes.statusCode).toBe(202);
    const evaluationId = evalRes.json().evaluation.id as string;
    expect(evaluationId).toMatch(/^E-[A-HJ-NP-Z2-9]{4}$/);

    // Poll the evaluations list until this pass is terminal.
    let evaluation: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) {
      const res = await app.inject({ method: "GET", url: `/api/benchmark-runs/${runId}/evaluations` });
      const found = (res.json().evaluations as Array<Record<string, unknown>>).find((e) => e.id === evaluationId);
      if (found && (found.status === "complete" || found.status === "error")) {
        evaluation = found;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(evaluation.status).toBe("complete");

    // One judged analysis child per completed run-session (2), all complete.
    const sessions = evaluation.sessions as Array<{ analysisSessionId: string; status: string }>;
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.status === "complete")).toBe(true);

    // Each child analysis session produced a verdict artifact.
    for (const s of sessions) {
      const rows = app.backendDb.connection
        .prepare(`SELECT metadata_json FROM artifacts WHERE session_id = ?`)
        .all(s.analysisSessionId) as Array<{ metadata_json: string }>;
      const keys = rows.map((r) => (JSON.parse(r.metadata_json) as { schema_key: string }).schema_key);
      expect(keys).toContain("analysis.benchmark_evaluation_verdict.v1");
    }
  });
});
