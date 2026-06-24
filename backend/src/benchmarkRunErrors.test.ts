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

/** Init probe succeeds (so the session reaches 'ready'), but the turn's model
 *  call fails — emulating a model that is unavailable at turn time. */
function failingTurnGateways(): Parameters<typeof buildBackendApp>[1] {
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
        throw new Error("model unavailable");
      },
      async streamChatCompletion() {
        throw new Error("model unavailable");
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
  await app.inject({
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
  await app.inject({
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
}

async function pollRunUntilTerminal(app: FastifyInstance, runId: string) {
  for (let i = 0; i < 100; i++) {
    const res = await app.inject({ method: "GET", url: `/api/benchmark-runs/${runId}` });
    const body = res.json();
    const s = body.run.status;
    if (s === "complete" || s === "error" || s === "stopped") return body;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("benchmark run did not reach a terminal state in time");
}

describe("benchmark run failures are surfaced (not silent)", () => {
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

  it("marks a failed-turn session as errored and the all-failed run as errored", async () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    app = await buildBackendApp(config, failingTurnGateways());
    await seedModelConfig(app);

    const created = await app.inject({
      method: "POST",
      url: "/api/benchmarks",
      payload: { name: "Failing suite" },
    });
    const benchmarkId = created.json().benchmark.id as string;
    await app.inject({
      method: "POST",
      url: `/api/benchmarks/${benchmarkId}/cases`,
      payload: { prompt: "What is the weather?" },
    });
    const runRes = await app.inject({
      method: "POST",
      url: `/api/benchmarks/${benchmarkId}/runs`,
      payload: { repetitions: 1, modelConfigId: "model-config-1", mcpProfileIds: [] },
    });
    expect(runRes.statusCode).toBe(202);
    const runId = runRes.json().run.id as string;

    const body = await pollRunUntilTerminal(app, runId);
    // The single session failed at turn time → run is errored (not a silent 'complete').
    expect(body.run.status).toBe("error");
    expect(body.run.error).toBeTruthy();
    expect(body.run.sessions).toHaveLength(1);
    const session = body.run.sessions[0];
    expect(session.status).toBe("error");
    // A concrete reason is captured, not left null.
    expect(session.error).toBeTruthy();
  });
});
