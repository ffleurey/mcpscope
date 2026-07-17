import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigStore } from "mcpscope-engine/config/configStore.js";
import { companionProfiles } from "./index.js";

// companionProfiles() reads the given config store, so each test builds one
// from a fresh temp config file and inspects the synthesized built-in profiles.
let tempDir: string | undefined;

function initStoreWith(companions: unknown): ConfigStore {
  tempDir = `.tmp-test-data/${crypto.randomUUID()}`;
  fs.mkdirSync(tempDir, { recursive: true });
  const filePath = path.join(tempDir, "mcpscope.config.json");
  const data: Record<string, unknown> = {
    lm_connections: [],
    model_configs: [],
    mcp_server_profiles: [],
    session_creation_defaults: null,
  };
  if (companions !== undefined) data.companions = companions;
  fs.writeFileSync(filePath, JSON.stringify(data), "utf-8");
  const store = new ConfigStore(filePath);
  store.load();
  return store;
}

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("companion built-in profile synthesis", () => {
  it("gates key-requiring companions and leaves keyless ones enabled", () => {
    const store = initStoreWith(undefined); // no companions section at all
    const byId = Object.fromEntries(
      companionProfiles(store, "127.0.0.1", 3066).map((p) => [p.id, p]),
    );

    // Keyless companions are always enabled.
    expect(byId["builtin-open-meteo"]?.disabledReason).toBeNull();
    expect(byId["builtin-hackernews"]?.disabledReason).toBeNull();
    expect(byId["builtin-open-meteo"]?.source).toBe("builtin");

    // Key-gated companions are listed but disabled with a directive tooltip.
    expect(byId["builtin-guardian"]?.disabledReason).toContain(
      "companions.guardian.api_key",
    );
    expect(byId["builtin-websearch"]?.disabledReason).toContain(
      "companions.brave.api_key",
    );

    // URLs track the given host/port.
    expect(byId["builtin-guardian"]?.url).toBe(
      "http://127.0.0.1:3066/companions/guardian/mcp",
    );
  });

  it("brackets an IPv6 host in the synthesized profile URL", () => {
    const store = initStoreWith(undefined);
    const profile = companionProfiles(store, "::1", 3066).find(
      (p) => p.id === "builtin-open-meteo",
    );
    expect(profile?.url).toBe("http://[::1]:3066/companions/open-meteo/mcp");
  });

  it("enables a key-gated companion once its key is configured", () => {
    const store = initStoreWith({
      guardian: { api_key: null },
      brave: { api_key: "brave-key" },
    });
    const byId = Object.fromEntries(
      companionProfiles(store, "127.0.0.1", 3066).map((p) => [p.id, p]),
    );
    expect(byId["builtin-websearch"]?.disabledReason).toBeNull(); // key present
    expect(byId["builtin-guardian"]?.disabledReason).not.toBeNull(); // still unset
  });
});
