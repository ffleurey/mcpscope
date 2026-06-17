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
});
