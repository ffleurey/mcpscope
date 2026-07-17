import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createEngine, type Engine } from "./index.js";

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
});
