import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createEngine, type Engine, type SchedulerEvent } from "./index.js";
import type { ChatCompletionGateway } from "./runtime/modelTurns.js";
import {
  providerConnectionSchema,
  modelConfigSchema,
} from "./domain/configuration.js";

/**
 * A scripted chat gateway: no network. Returns a fixed system-prompt probe and
 * a single "stop" completion, enough to drive one model-only turn (no tools).
 */
function makeScriptedGateway(): ChatCompletionGateway {
  return {
    async probePromptTokens() {
      return 8;
    },
    async probePromptTokensDetailed(_baseUrl, _apiKey, body) {
      return {
        promptTokens: 8,
        completion: {
          id: "probe",
          model: "model-key",
          created: 1,
          choices: [],
          usage: { prompt_tokens: 8, completion_tokens: 0, total_tokens: 8 },
        },
        rawExchange: {
          requestUrl: "https://example.test/v1/chat/completions",
          requestMethod: "POST",
          requestHeadersJson: { "Content-Type": "application/json" },
          requestBody: JSON.stringify(body),
          responseStatus: 200,
          responseHeadersJson: { "content-type": "application/json" },
          responseBody: JSON.stringify({ usage: { prompt_tokens: 8 } }),
        },
      };
    },
    async getLoadedContextLength() {
      return null;
    },
    async createChatCompletion() {
      return {
        id: "cmpl-1",
        model: "model-key",
        created: 2,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "PONG" },
          },
        ],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 2,
          total_tokens: 10,
        },
      };
    },
  };
}

describe("createEngine", () => {
  let engine: Engine | undefined;

  afterEach(() => {
    engine?.close();
    engine = undefined;
  });

  it("assembles an in-memory engine with no disk writes", async () => {
    const configPath = ".tmp-test-data/should-not-be-written.json";
    fs.rmSync(configPath, { force: true });

    engine = await createEngine({
      storage: { memory: true },
      // No configPath → purely in-memory config; upserts must not touch disk.
      config: {
        lmConnections: [
          {
            id: "lm-1",
            name: "Local",
            baseUrl: "http://127.0.0.1:1234/v1",
            apiKey: null,
            providerType: "lmstudio",
          } as never,
        ],
      },
    });

    expect(engine.opCtx.db).toBeDefined();
    expect(engine.opCtx.maxToolRounds).toBeGreaterThan(0);
    // Seeded config is visible through the store.
    expect(engine.config.listLmConnections().map((c) => c.id)).toEqual(["lm-1"]);
    // In-memory mode wrote no config file.
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it("exposes engine operations over the assembled context", async () => {
    engine = await createEngine({ storage: { memory: true }, maxToolRounds: 3 });

    // A fresh in-memory engine has no sessions.
    const sessions = await engine.listSessions();
    expect(sessions).toEqual({ api_version: 1, sessions: [] });

    // Trace of an unknown session is null (not a throw).
    expect(engine.getTrace("NOPE")).toBeNull();

    // Event subscription hands back a working unsubscribe.
    const unsubscribe = engine.onEvent(() => {});
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();

    // maxToolRounds override is threaded into the context.
    expect(engine.opCtx.maxToolRounds).toBe(3);
  });

  it("runs a full model-only turn end-to-end with no workbench wiring", async () => {
    // A valid connection + model config, built through the real schemas.
    const connection = providerConnectionSchema.parse({
      id: "lm-1",
      name: "Scripted",
      baseUrl: "http://127.0.0.1:1234/v1",
      providerType: "lmstudio",
    });
    const modelConfig = modelConfigSchema.parse({
      id: "m-1",
      name: "Scripted model",
      connectionId: "lm-1",
      modelKey: "model-key",
      systemPrompt: "You are a test.",
    });

    engine = await createEngine({
      storage: { memory: true },
      config: {
        lmConnections: [connection],
        modelConfigs: [modelConfig],
        sessionCreationDefaults: { defaultModelConfigId: "m-1", updatedAt: 1 },
      },
      dependencies: { chatCompletionGateway: makeScriptedGateway() },
    });

    // Capture the turn-committed execution event as it flows through the scheduler.
    const events: SchedulerEvent[] = [];
    const unsubscribe = engine.onEvent((e) => events.push(e));

    // Create the session and wait for initialization to finish.
    const created = await engine.createSession({
      title: "Turn test",
      model_config_id: "m-1",
      wait: true,
    });
    expect(created.session.init_status).toBe("ready");

    // Send a prompt and wait for the turn to reach a terminal state.
    const sent = await engine.send({
      session_id: created.session.id,
      prompt: "ping",
      wait: true,
    });
    expect(sent.turn.status).toBe("complete");

    // The assistant's committed content is in the persisted trace.
    const trace = engine.getTrace(created.session.id);
    expect(trace).not.toBeNull();
    expect(JSON.stringify(trace)).toContain("PONG");

    // A turn-committed event was relayed through the scheduler — proving the
    // pure engine's agent loop ran with zero workbench registrations.
    const committed = events.some(
      (e) =>
        e.type === "scheduler-execution-event" &&
        e.event.type === "turn-committed",
    );
    expect(committed).toBe(true);

    unsubscribe();
  });
});
