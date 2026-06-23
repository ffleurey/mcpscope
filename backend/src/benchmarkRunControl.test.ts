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

/**
 * A gateway whose turn (streamChatCompletion) blocks until the test releases it,
 * and which rejects when its abort signal fires. Init probes are fast. Because the
 * scheduler runs one job at a time, at most one turn is ever blocked — so a single
 * "release the current turn" handle is enough to drive the run step by step.
 */
function controllableGateways() {
  let startedTurns = 0;
  let releaseCurrent: (() => void) | null = null;

  const gateways: Parameters<typeof buildBackendApp>[1] = {
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
      async streamChatCompletion(_baseUrl, _apiKey, _body, _callbacks, signal) {
        startedTurns++;
        // Block until the test releases this turn — or the abort signal fires
        // (the hard-stop path), which must reject so the turn fails promptly.
        await new Promise<void>((resolve, reject) => {
          releaseCurrent = resolve;
          if (signal) {
            if (signal.aborted) reject(new Error("aborted"));
            else
              signal.addEventListener("abort", () => reject(new Error("aborted")), {
                once: true,
              });
          }
        });
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

  return {
    gateways,
    startedTurns: () => startedTurns,
    releaseTurn(): void {
      const r = releaseCurrent;
      releaseCurrent = null;
      r?.();
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

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("benchmark run control (pause / stop / resume)", () => {
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

  async function setupRun(reps: number): Promise<{ runId: string }> {
    const created = await app!.inject({
      method: "POST",
      url: "/api/benchmarks",
      payload: { name: "Control suite" },
    });
    const benchmarkId = created.json().benchmark.id as string;
    await app!.inject({
      method: "POST",
      url: `/api/benchmarks/${benchmarkId}/cases`,
      payload: { prompt: "What is the weather?" },
    });
    const runRes = await app!.inject({
      method: "POST",
      url: `/api/benchmarks/${benchmarkId}/runs`,
      payload: { repetitions: reps, modelConfigId: "model-config-1", mcpProfileIds: [] },
    });
    expect(runRes.statusCode).toBe(202);
    return { runId: runRes.json().run.id as string };
  }

  function getRun(runId: string) {
    return app!
      .inject({ method: "GET", url: `/api/benchmark-runs/${runId}` })
      .then((r) => r.json().run);
  }
  function sessionStatuses(run: { sessions: { status: string }[] }): string[] {
    return run.sessions.map((s) => s.status).sort();
  }

  it("stops mid-run (cancelling the in-flight session), then resumes the rest", async () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    const ctl = controllableGateways();
    app = await buildBackendApp(config, ctl.gateways);
    await seedModelConfig(app);

    const { runId } = await setupRun(3);

    // Let the first repetition complete.
    await waitFor(() => ctl.startedTurns() >= 1, "turn 1 to start");
    ctl.releaseTurn();
    // Second repetition is now in-flight (blocked on the gate).
    await waitFor(() => ctl.startedTurns() >= 2, "turn 2 to start");

    // Stop now — aborts the in-flight turn; the run comes to rest as 'stopped'.
    const stopRes = await app.inject({
      method: "POST",
      url: `/api/benchmark-runs/${runId}/stop`,
    });
    expect(stopRes.statusCode).toBe(200);

    await waitFor(async () => (await getRun(runId)).status === "stopped", "run stopped");
    let run = await getRun(runId);
    // One completed, one cancelled (the interrupted one); the third never started.
    expect(sessionStatuses(run)).toEqual(["cancelled", "complete"]);
    const turnsAfterStop = ctl.startedTurns();

    // Resume (continue): runs ONLY the never-started task; the cancelled one is left.
    const resumeRes = await app.inject({
      method: "POST",
      url: `/api/benchmark-runs/${runId}/resume`,
      payload: { mode: "continue" },
    });
    expect(resumeRes.statusCode).toBe(202);

    await waitFor(() => ctl.startedTurns() > turnsAfterStop, "the third turn to start");
    ctl.releaseTurn();
    // continue finishes the remaining task but leaves the cancelled one for review,
    // so the run rests at the resumable 'stopped' state (not 'complete').
    await waitFor(
      async () => {
        const r = await getRun(runId);
        return (
          r.status === "stopped" &&
          r.sessions.filter((s: { status: string }) => s.status === "complete").length === 2
        );
      },
      "run to rest at stopped with two complete sessions",
    );
    run = await getRun(runId);
    expect(sessionStatuses(run)).toEqual(["cancelled", "complete", "complete"]);
    expect(run.error).toBeNull();
  });

  it("retry mode re-runs the cancelled session", async () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    const ctl = controllableGateways();
    app = await buildBackendApp(config, ctl.gateways);
    await seedModelConfig(app);

    const { runId } = await setupRun(2);

    // First completes; stop while the second is in-flight.
    await waitFor(() => ctl.startedTurns() >= 1, "turn 1 to start");
    ctl.releaseTurn();
    await waitFor(() => ctl.startedTurns() >= 2, "turn 2 to start");
    await app.inject({ method: "POST", url: `/api/benchmark-runs/${runId}/stop` });
    await waitFor(async () => (await getRun(runId)).status === "stopped", "run stopped");
    expect(sessionStatuses(await getRun(runId))).toEqual(["cancelled", "complete"]);
    const turnsAfterStop = ctl.startedTurns();

    // Resume (retry): re-runs the cancelled task (superseding it).
    await app.inject({
      method: "POST",
      url: `/api/benchmark-runs/${runId}/resume`,
      payload: { mode: "retry" },
    });
    await waitFor(() => ctl.startedTurns() > turnsAfterStop, "the re-run turn to start");
    ctl.releaseTurn();
    await waitFor(async () => (await getRun(runId)).status === "complete", "run complete");

    const run = await getRun(runId);
    // The superseded cancelled session is replaced; both reps are complete now.
    expect(sessionStatuses(run)).toEqual(["complete", "complete"]);
    expect(run.sessions).toHaveLength(2);
  });

  it("pauses cleanly between tasks and resumes", async () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    const ctl = controllableGateways();
    app = await buildBackendApp(config, ctl.gateways);
    await seedModelConfig(app);

    const { runId } = await setupRun(2);

    // First repetition in-flight → request a pause (takes effect at the next boundary).
    await waitFor(() => ctl.startedTurns() >= 1, "turn 1 to start");
    const pauseRes = await app.inject({
      method: "POST",
      url: `/api/benchmark-runs/${runId}/pause`,
    });
    expect(pauseRes.statusCode).toBe(200);
    expect(pauseRes.json().run.status).toBe("paused");

    // Let the in-flight turn finish; the coordinator then holds before the next.
    ctl.releaseTurn();
    await waitFor(
      async () => (await getRun(runId)).sessions.some((s: { status: string }) => s.status === "complete"),
      "first session to complete",
    );
    // Give the loop a chance to (not) start the next task.
    await new Promise((r) => setTimeout(r, 50));
    const paused = await getRun(runId);
    expect(paused.status).toBe("paused");
    expect(ctl.startedTurns()).toBe(1); // second task did NOT start while paused
    expect(paused.sessions).toHaveLength(1);

    // Resume → the second task runs to completion.
    await app.inject({
      method: "POST",
      url: `/api/benchmark-runs/${runId}/resume`,
      payload: { mode: "continue" },
    });
    await waitFor(() => ctl.startedTurns() >= 2, "second turn to start after resume");
    ctl.releaseTurn();
    await waitFor(async () => (await getRun(runId)).status === "complete", "run complete");
    expect(sessionStatuses(await getRun(runId))).toEqual(["complete", "complete"]);
  });
});
