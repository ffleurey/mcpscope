import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSessionTraceBundle,
  computeLifecycleState,
  ConfigStore,
  createExplicitOperation,
  createOperation,
  deriveContextEntries,
  deriveTranscriptEntries,
  ExecutionScheduler,
  inspectOperation,
  launchPrimarySessionOperation,
  listMcpProfilesOperation,
  listModelConfigsOperation,
  listOperation,
  openBackendDatabase,
  OperationError,
  sendOperation,
  statusOperation,
} from "mcpscope-engine";
// buildBackendApp/BackendHandle still live in the workbench (they wire HTTP +
// benchmark/analysis); the engine barrel intentionally no longer re-exports
// them. This test exercises both: the engine surface via `mcpscope-engine`,
// the app factory via the workbench.
import { buildBackendApp, type BackendHandle } from "./app.js";

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

describe("engine barrel", () => {
  let handle: BackendHandle | undefined;
  let dataDir: string | undefined;

  afterEach(async () => {
    await handle?.app.close();
    handle = undefined;
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
  });

  it("exposes the engine runtime surface", () => {
    expect(typeof buildBackendApp).toBe("function");
    expect(typeof ExecutionScheduler).toBe("function");
    expect(typeof ConfigStore).toBe("function");
    expect(typeof OperationError).toBe("function");
    expect(typeof openBackendDatabase).toBe("function");
    expect(typeof buildSessionTraceBundle).toBe("function");
    expect(typeof deriveTranscriptEntries).toBe("function");
    expect(typeof deriveContextEntries).toBe("function");
    expect(typeof computeLifecycleState).toBe("function");

    // Catalog operations carry an id + execute.
    for (const operation of [
      createOperation,
      sendOperation,
      statusOperation,
      listOperation,
      listModelConfigsOperation,
      listMcpProfilesOperation,
      inspectOperation,
    ]) {
      expect(typeof operation.id).toBe("string");
      expect(typeof operation.execute).toBe("function");
    }

    // Non-catalog session-launch operations expose schema + execute only.
    for (const operation of [
      createExplicitOperation,
      launchPrimarySessionOperation,
    ]) {
      expect(typeof operation.execute).toBe("function");
    }
  });

  it("builds a handle and executes an operation directly, without HTTP", async () => {
    const config = makeTestConfig();
    dataDir = config.dataDir;
    handle = await buildBackendApp(config);

    expect(handle.scheduler).toBeInstanceOf(ExecutionScheduler);
    expect(handle.opCtx.scheduler).toBe(handle.scheduler);

    const result = await listOperation.execute(handle.opCtx, {});
    expect(result).toEqual({
      api_version: 1,
      sessions: [],
      total: 0,
      limit: 50,
      offset: 0,
      has_more: false,
    });
  });
});
