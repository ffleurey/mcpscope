import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigStore, ConfigFileError } from "./configStore.js";
import type {
  LmStudioConnection,
  ModelConfig,
  McpServerProfile,
} from "../domain/configuration.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeValidConfig() {
  return {
    lm_connections: [
      {
        id: "lm-local",
        name: "Local LM Studio",
        baseUrl: "http://localhost:1234",
        apiKey: "sk-test",
        providerType: "lmstudio" as const,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ],
    model_configs: [
      {
        id: "mc-deepseek",
        name: "DeepSeek V4",
        connectionId: "lm-local",
        modelKey: "deepseek-v4",
        modelDisplayName: "DeepSeek V4 Flash",
        systemPrompt: "",
        temperature: 0.7,
        reasoning: "on" as const,
        createdAt: 1001,
        updatedAt: 1001,
      },
    ],
    mcp_server_profiles: [
      {
        id: "mp-home-assistant",
        name: "Home Assistant",
        url: "http://host:8123/mcp",
        transport: "streamable-http" as const,
        authType: null,
        authValue: null,
        defaultEnabled: true,
        createdAt: 1002,
        updatedAt: 1002,
      },
    ],
    session_creation_defaults: {
      default_model_config_id: "mc-deepseek",
    },
  };
}

let tempDir: string | undefined;

function makeTempConfig(data: unknown): string {
  tempDir = `.tmp-test-data/${crypto.randomUUID()}`;
  fs.mkdirSync(tempDir, { recursive: true });
  const filePath = path.join(tempDir, "mcpscope.config.json");
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("configStore: load", () => {
  it("parses a valid config file into in-memory stores", () => {
    const filePath = makeTempConfig(makeValidConfig());
    const store = new ConfigStore(filePath);
    store.load();

    const connections = store.listLmConnections();
    expect(connections).toHaveLength(1);
    expect(connections[0]!.id).toBe("lm-local");

    const configs = store.listModelConfigs();
    expect(configs).toHaveLength(1);
    expect(configs[0]!.id).toBe("mc-deepseek");

    const profiles = store.listMcpServerProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.id).toBe("mp-home-assistant");

    const defaults = store.getSessionCreationDefaults();
    expect(defaults.defaultModelConfigId).toBe("mc-deepseek");
  });

  it("throws ConfigFileError on malformed JSON", () => {
    const filePath = makeTempConfig("not json");
    // Overwrite with invalid content
    fs.writeFileSync(filePath, "this is not json", "utf-8");
    const store = new ConfigStore(filePath);

    expect(() => store.load()).toThrow(ConfigFileError);
    expect(() => store.load()).toThrow(/parse config/i);
    expect(() => store.load()).toThrow(filePath);
  });

  it("throws ConfigFileError on schema violations", () => {
    const filePath = makeTempConfig({
      lm_connections: [{ id: "bad", name: "", baseUrl: "not-a-url" }],
      model_configs: [],
      mcp_server_profiles: [],
    });
    const store = new ConfigStore(filePath);

    expect(() => store.load()).toThrow(ConfigFileError);
    expect(() => store.load()).toThrow(/validation failed/i);
    expect(() => store.load()).toThrow(filePath);
    // Should mention the field that failed
    expect(() => store.load()).toThrow(/baseUrl/);
  });

  it("accepts missing optional sections with defaults", () => {
    const filePath = makeTempConfig({});
    const store = new ConfigStore(filePath);
    store.load();

    expect(store.listLmConnections()).toEqual([]);
    expect(store.listModelConfigs()).toEqual([]);
    expect(store.listMcpServerProfiles()).toEqual([]);
    expect(store.getSessionCreationDefaults().defaultModelConfigId).toBeNull();
  });

  it("throws ConfigFileError when model config references a non-existent connection", () => {
    const filePath = makeTempConfig({
      lm_connections: [],
      model_configs: [
        {
          id: "mc-orphan",
          name: "Orphan",
          connectionId: "lm-nonexistent",
          modelKey: "test",
          modelDisplayName: "Test",
          systemPrompt: "",
          temperature: 0.5,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      mcp_server_profiles: [],
    });
    const store = new ConfigStore(filePath);

    expect(() => store.load()).toThrow(ConfigFileError);
    expect(() => store.load()).toThrow(/connectionId/);
    expect(() => store.load()).toThrow(/mc-orphan/);
    expect(() => store.load()).toThrow(/lm-nonexistent/);
  });

  it("starts empty when config file does not exist", () => {
    const filePath = "/tmp/nonexistent-mcpscope-test-config.json";
    const store = new ConfigStore(filePath);
    store.load();

    expect(store.listLmConnections()).toEqual([]);
    expect(store.listModelConfigs()).toEqual([]);
    expect(store.listMcpServerProfiles()).toEqual([]);
    expect(store.getSessionCreationDefaults().defaultModelConfigId).toBeNull();
  });
});

describe("configStore: CRUD", () => {
  it("creates, reads, updates, and deletes LM connections", () => {
    const filePath = makeTempConfig(makeValidConfig());
    const store = new ConfigStore(filePath);
    store.load();

    const record: LmStudioConnection = {
      id: "lm-new",
      name: "New Connection",
      baseUrl: "http://localhost:5678",
      apiKey: "sk-new",
      providerType: "lmstudio",
      createdAt: 2000,
      updatedAt: 2000,
    };

    // Create
    store.upsertLmConnection(record);
    expect(store.listLmConnections()).toHaveLength(2);
    expect(store.listLmConnections().find((c) => c.id === "lm-new")?.name).toBe(
      "New Connection",
    );

    // Update (upsert with same ID)
    store.upsertLmConnection({ ...record, name: "Updated Connection" });
    expect(store.listLmConnections()).toHaveLength(2);
    expect(store.listLmConnections().find((c) => c.id === "lm-new")?.name).toBe(
      "Updated Connection",
    );

    // Delete
    const deleted = store.deleteLmConnection("lm-new");
    expect(deleted).toBe(true);
    expect(store.listLmConnections()).toHaveLength(1);

    // Delete non-existent returns false
    expect(store.deleteLmConnection("lm-nonexistent")).toBe(false);
  });

  it("creates, reads, updates, and deletes model configs", () => {
    const filePath = makeTempConfig(makeValidConfig());
    const store = new ConfigStore(filePath);
    store.load();

    const record: ModelConfig = {
      id: "mc-new",
      name: "New Model",
      connectionId: "lm-local",
      modelKey: "new-model",
      modelDisplayName: "New Model",
      systemPrompt: "",
      temperature: 0.3,
      createdAt: 3000,
      updatedAt: 3000,
    };

    store.upsertModelConfig(record);
    expect(store.listModelConfigs()).toHaveLength(2);

    store.upsertModelConfig({ ...record, temperature: 0.8 });
    expect(
      store.listModelConfigs().find((c) => c.id === "mc-new")?.temperature,
    ).toBe(0.8);

    expect(store.deleteModelConfig("mc-new")).toBe(true);
    expect(store.listModelConfigs()).toHaveLength(1);
    expect(store.deleteModelConfig("mc-nonexistent")).toBe(false);
  });

  it("creates, reads, updates, and deletes MCP server profiles", () => {
    const filePath = makeTempConfig(makeValidConfig());
    const store = new ConfigStore(filePath);
    store.load();

    const record: McpServerProfile = {
      id: "mp-new",
      name: "New Profile",
      url: "http://localhost:9999/mcp",
      transport: "streamable-http",
      authType: null,
      authValue: null,
      defaultEnabled: false,
      createdAt: 4000,
      updatedAt: 4000,
    };

    store.upsertMcpServerProfile(record);
    expect(store.listMcpServerProfiles()).toHaveLength(2);

    store.upsertMcpServerProfile({ ...record, defaultEnabled: true });
    expect(
      store.listMcpServerProfiles().find((p) => p.id === "mp-new")
        ?.defaultEnabled,
    ).toBe(true);

    expect(store.deleteMcpServerProfile("mp-new")).toBe(true);
    expect(store.listMcpServerProfiles()).toHaveLength(1);
    expect(store.deleteMcpServerProfile("mp-nonexistent")).toBe(false);
  });

  it("reads and updates session creation defaults", () => {
    const filePath = makeTempConfig(makeValidConfig());
    const store = new ConfigStore(filePath);
    store.load();

    const defaults = store.getSessionCreationDefaults();
    expect(defaults.defaultModelConfigId).toBe("mc-deepseek");
    expect(defaults.updatedAt).toBeGreaterThan(0);

    store.upsertSessionCreationDefaults({
      defaultModelConfigId: null,
      updatedAt: 5000,
    });
    const updated = store.getSessionCreationDefaults();
    expect(updated.defaultModelConfigId).toBeNull();
    expect(updated.updatedAt).toBeGreaterThan(5000); // updatedAt is set to Date.now() internally
  });
});

describe("configStore: file flush", () => {
  it("writes config back to the file after upsert", () => {
    const filePath = makeTempConfig(makeValidConfig());
    const store = new ConfigStore(filePath);
    store.load();

    store.upsertLmConnection({
      id: "lm-after",
      name: "After Upsert",
      baseUrl: "http://localhost:9999",
      apiKey: "sk-after",
      providerType: "openrouter",
      createdAt: 6000,
      updatedAt: 6000,
    });

    // Read the file back
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(raw.lm_connections).toHaveLength(2);
    expect(
      raw.lm_connections.find((c: { id: string }) => c.id === "lm-after")?.name,
    ).toBe("After Upsert");
  });

  it("removes config from the file after delete", () => {
    const filePath = makeTempConfig(makeValidConfig());
    const store = new ConfigStore(filePath);
    store.load();

    store.deleteLmConnection("lm-local");

    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(raw.lm_connections).toHaveLength(0);
  });

  it("writes empty arrays to file when all config is cleared", () => {
    const filePath = makeTempConfig(makeValidConfig());
    const store = new ConfigStore(filePath);
    store.load();

    store.deleteLmConnection("lm-local");
    store.deleteModelConfig("mc-deepseek");
    store.deleteMcpServerProfile("mp-home-assistant");
    store.upsertSessionCreationDefaults({
      defaultModelConfigId: null,
      updatedAt: 7000,
    });

    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(raw.lm_connections).toEqual([]);
    expect(raw.model_configs).toEqual([]);
    expect(raw.mcp_server_profiles).toEqual([]);
    expect(raw.session_creation_defaults).toBeNull();
  });
});

describe("configStore: duplicate ID handling", () => {
  it("upserting with existing ID replaces the record (does not duplicate)", () => {
    const filePath = makeTempConfig(makeValidConfig());
    const store = new ConfigStore(filePath);
    store.load();

    expect(store.listLmConnections()).toHaveLength(1);

    // Upsert with same ID but different data
    store.upsertLmConnection({
      id: "lm-local",
      name: "Replaced",
      baseUrl: "http://replaced:1234",
      apiKey: "sk-replaced",
      providerType: "lmstudio",
      createdAt: 1000,
      updatedAt: 8000,
    });

    expect(store.listLmConnections()).toHaveLength(1);
    expect(store.listLmConnections()[0]!.name).toBe("Replaced");
    expect(store.listLmConnections()[0]!.updatedAt).toBe(8000);
  });
});

describe("configStore: end-to-end config lifecycle", () => {
  it("writes config via API, then reloads from file on next startup", async () => {
    // Create a config file with one connection
    const configData = makeValidConfig();
    const filePath = makeTempConfig(configData);

    // Load the store, add a second connection, flush
    const store1 = new ConfigStore(filePath);
    store1.load();
    expect(store1.listLmConnections()).toHaveLength(1);

    store1.upsertLmConnection({
      id: "lm-second",
      name: "Second Connection",
      baseUrl: "http://localhost:9999",
      apiKey: "sk-second",
      providerType: "openrouter",
      createdAt: 9000,
      updatedAt: 9000,
    });
    expect(store1.listLmConnections()).toHaveLength(2);

    // Simulate a fresh startup: create a new store reading the same file
    const store2 = new ConfigStore(filePath);
    store2.load();

    // Verify both connections are present (config persisted to file)
    expect(store2.listLmConnections()).toHaveLength(2);
    expect(
      store2.listLmConnections().find((c) => c.id === "lm-local")?.name,
    ).toBe("Local LM Studio");
    expect(
      store2.listLmConnections().find((c) => c.id === "lm-second")?.name,
    ).toBe("Second Connection");

    // Verify other sections survived the round-trip
    expect(store2.listModelConfigs()).toHaveLength(1);
    expect(store2.listMcpServerProfiles()).toHaveLength(1);
    expect(store2.getSessionCreationDefaults().defaultModelConfigId).toBe(
      "mc-deepseek",
    );
  });
});
