/**
 * wait=true on create and send: the blocking convenience that removes status
 * polling from every CLI/MCP onboarding flow. Exercises the HTTP routes the
 * CLI uses (from-defaults, turns/start) with a scripted model, and checks the
 * default (non-wait) behavior is unchanged.
 */
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildBackendApp } from "../app.js";

function makeTestConfig() {
  const dataDir = `.tmp-test-data/${crypto.randomUUID()}`;
  return {
    host: "127.0.0.1",
    port: 3066,
    corsOrigin: true as const,
    dataDir,
    sqlitePath: `${dataDir}/test.db`,
    maxToolRounds: 5,
    appVersion: "test",
  };
}

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

let app: FastifyInstance | null = null;
let dataDir: string | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  dataDir = null;
});

async function makeApp() {
  const config = makeTestConfig();
  dataDir = config.dataDir;
  app = (await buildBackendApp(config, stubGateways())).app;
  await seedModelConfig(app);
  return app;
}

describe("create/send wait=true (blocking convenience, CLI/MCP parity surface)", () => {
  it("create with wait returns a terminal init_status (ready) — no polling needed", async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions/from-defaults",
      payload: {
        title: "wait-test",
        modelConfigId: "model-config-1",
        mcpProfileIds: [],
        wait: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const session = (created.json() as { session: { id: string; init_status: string } })
      .session;
    expect(session.init_status).toBe("ready");
    return session.id;
  });

  it("send with wait returns a terminal turn status (complete) — no polling needed", async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions/from-defaults",
      payload: {
        title: "wait-send-test",
        modelConfigId: "model-config-1",
        mcpProfileIds: [],
        wait: true,
      },
    });
    const sessionId = (created.json() as { session: { id: string } }).session.id;

    const sent = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/turns/start`,
      payload: { userContent: "Say OK.", wait: true },
    });
    expect(sent.statusCode).toBe(200);
    // Canonical SendResult (the route delegates to the catalog send operation):
    // turn is always present; there is no adapter-only job field.
    const body = sent.json() as {
      turn: { id: string; status: string };
    };
    expect(body.turn.status).toBe("complete");

    // The turn is immediately inspectable — the whole point of wait.
    const lookup = await app.inject({
      method: "GET",
      url: `/api/lookup/${body.turn.id}`,
    });
    expect(lookup.statusCode).toBe(200);
  });

  it("without wait, send still returns 202 running (default behavior unchanged)", async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions/from-defaults",
      payload: {
        title: "nowait-test",
        modelConfigId: "model-config-1",
        mcpProfileIds: [],
        wait: true,
      },
    });
    const sessionId = (created.json() as { session: { id: string } }).session.id;

    const sent = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/turns/start`,
      payload: { userContent: "Say OK." },
    });
    expect(sent.statusCode).toBe(202);
    // Canonical SendResult: the enqueued turn comes back as running.
    const body = sent.json() as { turn: { id: string; status: string } };
    expect(body.turn.status).toBe("running");
  });
});
