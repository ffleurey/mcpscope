import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  lmStudioConnectionSchema,
  modelConfigSchema,
  mcpServerProfileSchema,
  type LmStudioConnection,
  type ModelConfig,
  type McpServerProfile,
  type ListedMcpServerProfile,
} from "../domain/configuration.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SessionCreationDefaults {
  defaultModelConfigId: string | null;
  updatedAt: number;
}

/**
 * Upstream API keys for the key-gated companion servers. Supplied via the config
 * file only (no GUI) — these are companion→upstream credentials, distinct from a
 * profile's mcpscope→server auth. Each is null until the user sets it.
 */
export interface CompanionsConfig {
  guardian: { api_key: string | null };
  brave: { api_key: string | null };
}

export class ConfigFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigFileError";
  }
}

// ─── File schema ──────────────────────────────────────────────────────────────

const sessionDefaultsSchema = z.object({
  default_model_config_id: z.string().nullable(),
});

const companionKeySchema = z.object({
  api_key: z.string().nullable().default(null),
});

const companionsConfigSchema = z
  .object({
    guardian: companionKeySchema.default({ api_key: null }),
    brave: companionKeySchema.default({ api_key: null }),
  })
  .default({ guardian: { api_key: null }, brave: { api_key: null } });

const configFileSchema = z.object({
  lm_connections: z.array(lmStudioConnectionSchema).default([]),
  model_configs: z.array(modelConfigSchema).default([]),
  mcp_server_profiles: z.array(mcpServerProfileSchema).default([]),
  session_creation_defaults: sessionDefaultsSchema.nullable().default(null),
  companions: companionsConfigSchema,
});

type ConfigFile = z.infer<typeof configFileSchema>;

// ─── Singleton store ──────────────────────────────────────────────────────────

export class ConfigStore {
  private lmConnections = new Map<string, LmStudioConnection>();
  private modelConfigs = new Map<string, ModelConfig>();
  private mcpServerProfiles = new Map<string, McpServerProfile>();
  private sessionCreationDefaults: SessionCreationDefaults = {
    defaultModelConfigId: null,
    updatedAt: 0,
  };
  private companions: CompanionsConfig = {
    guardian: { api_key: null },
    brave: { api_key: null },
  };
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** Load config from the JSON file. If the file doesn't exist, start empty. */
  load(): void {
    if (!fs.existsSync(this.filePath)) {
      this.clearAll();
      return;
    }

    let raw: unknown;
    try {
      const text = fs.readFileSync(this.filePath, "utf-8");
      raw = JSON.parse(text);
    } catch (err) {
      const detail = err instanceof SyntaxError ? err.message : String(err);
      throw new ConfigFileError(
        `Failed to parse config file at ${this.filePath}: ${detail}`,
      );
    }

    const parseResult = configFileSchema.safeParse(raw);
    if (!parseResult.success) {
      const issues = parseResult.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new ConfigFileError(
        `Config validation failed in file ${this.filePath}:\n${issues}`,
      );
    }

    const config = parseResult.data;

    // Validate cross-references: each model_config.connectionId must exist
    const connectionIds = new Set(config.lm_connections.map((c) => c.id));
    for (const mc of config.model_configs) {
      if (!connectionIds.has(mc.connectionId)) {
        const ids = Array.from(connectionIds).join(", ");
        throw new ConfigFileError(
          `Config validation failed in file ${this.filePath}:\n` +
            `  model_configs["${mc.id}"].connectionId: "${mc.connectionId}" does not match any existing LM connection ID\n` +
            `  Existing LM connection IDs: [${ids}]`,
        );
      }
    }

    this.loadFromParsed(config);
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private clearAll(): void {
    this.lmConnections.clear();
    this.modelConfigs.clear();
    this.mcpServerProfiles.clear();
    this.sessionCreationDefaults = { defaultModelConfigId: null, updatedAt: 0 };
    this.companions = { guardian: { api_key: null }, brave: { api_key: null } };
  }

  private loadFromParsed(config: ConfigFile): void {
    this.lmConnections = new Map(config.lm_connections.map((c) => [c.id, c]));
    this.modelConfigs = new Map(config.model_configs.map((m) => [m.id, m]));
    this.mcpServerProfiles = new Map(
      config.mcp_server_profiles.map((p) => [p.id, p]),
    );
    this.sessionCreationDefaults = {
      defaultModelConfigId:
        config.session_creation_defaults?.default_model_config_id ?? null,
      updatedAt: Date.now(),
    };
    this.companions = {
      guardian: { api_key: config.companions.guardian.api_key },
      brave: { api_key: config.companions.brave.api_key },
    };
  }

  private flush(): void {
    const data: ConfigFile = {
      lm_connections: Array.from(this.lmConnections.values()),
      model_configs: Array.from(this.modelConfigs.values()),
      mcp_server_profiles: Array.from(this.mcpServerProfiles.values()),
      session_creation_defaults:
        this.sessionCreationDefaults.defaultModelConfigId != null
          ? {
              default_model_config_id:
                this.sessionCreationDefaults.defaultModelConfigId,
            }
          : null,
      companions: this.companions,
    };
    const dir = path.dirname(this.filePath);
    if (dir !== "" && dir !== ".") {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Write atomically: a crash mid-write must not corrupt the config file.
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.filePath);
  }

  // ── LM Connections ────────────────────────────────────────────────────────

  listLmConnections(): LmStudioConnection[] {
    return Array.from(this.lmConnections.values());
  }

  upsertLmConnection(record: LmStudioConnection): void {
    this.lmConnections.set(record.id, record);
    this.flush();
  }

  deleteLmConnection(id: string): boolean {
    const existed = this.lmConnections.has(id);
    this.lmConnections.delete(id);
    if (existed) this.flush();
    return existed;
  }

  // ── Model Configs ─────────────────────────────────────────────────────────

  listModelConfigs(): ModelConfig[] {
    return Array.from(this.modelConfigs.values());
  }

  upsertModelConfig(record: ModelConfig): void {
    this.modelConfigs.set(record.id, record);
    this.flush();
  }

  deleteModelConfig(id: string): boolean {
    const existed = this.modelConfigs.has(id);
    this.modelConfigs.delete(id);
    if (existed) this.flush();
    return existed;
  }

  // ── MCP Server Profiles ───────────────────────────────────────────────────

  listMcpServerProfiles(): McpServerProfile[] {
    return Array.from(this.mcpServerProfiles.values());
  }

  upsertMcpServerProfile(record: McpServerProfile): void {
    this.mcpServerProfiles.set(record.id, record);
    this.flush();
  }

  deleteMcpServerProfile(id: string): boolean {
    const existed = this.mcpServerProfiles.has(id);
    this.mcpServerProfiles.delete(id);
    if (existed) this.flush();
    return existed;
  }

  // ── Session Creation Defaults ─────────────────────────────────────────────

  getSessionCreationDefaults(): SessionCreationDefaults {
    return { ...this.sessionCreationDefaults };
  }

  upsertSessionCreationDefaults(defaults: SessionCreationDefaults): void {
    this.sessionCreationDefaults = { ...defaults, updatedAt: Date.now() };
    this.flush();
  }

  // ── Companion API keys ────────────────────────────────────────────────────

  /** Upstream API keys for key-gated companion servers (read-only, config-file only). */
  getCompanionsConfig(): CompanionsConfig {
    return {
      guardian: { api_key: this.companions.guardian.api_key },
      brave: { api_key: this.companions.brave.api_key },
    };
  }
}

// ─── Module-level instance ─────────────────────────────────────────────────────
// Initialized at startup by app.ts. The repository re-exports delegate to this.

let instance: ConfigStore | null = null;

export function initializeConfigStore(filePath: string): ConfigStore {
  const store = new ConfigStore(filePath);
  store.load();
  instance = store;
  return store;
}

export function getConfigStore(): ConfigStore {
  if (!instance) {
    throw new ConfigFileError(
      "Config store not initialized. Call initializeConfigStore() first.",
    );
  }
  return instance;
}

// ─── Standalone wrappers (delegated via module-level instance) ─────────────────
// These are re-exported from repository.ts so callers don't need to know about
// the ConfigStore class. They work on the module-level instance initialized at startup.

export function listLmConnections(): LmStudioConnection[] {
  return getConfigStore().listLmConnections();
}

export function upsertLmConnection(record: LmStudioConnection): void {
  getConfigStore().upsertLmConnection(record);
}

export function deleteLmConnection(id: string): boolean {
  return getConfigStore().deleteLmConnection(id);
}

export function listModelConfigs(): ModelConfig[] {
  return getConfigStore().listModelConfigs();
}

export function upsertModelConfig(record: ModelConfig): void {
  getConfigStore().upsertModelConfig(record);
}

export function deleteModelConfig(id: string): boolean {
  return getConfigStore().deleteModelConfig(id);
}

export function getCompanionsConfig(): CompanionsConfig {
  return getConfigStore().getCompanionsConfig();
}

// ─── Built-in companion profile provider ────────────────────────────────────────
// Bundled companion MCP servers surface as read-only "builtin" profiles that are
// never persisted to the user's config file. app.ts registers the provider at
// startup (it needs the backend host/port to build the URLs). `listMcpServerProfiles`
// merges these ahead of the user's own profiles so they appear in every listing
// consumer (UI/CLI/MCP) and resolve by id at session creation.

const BUILTIN_PROFILE_PREFIX = "builtin-";

let companionProfileProvider: () => ListedMcpServerProfile[] = () => [];

export function setCompanionProfileProvider(
  provider: () => ListedMcpServerProfile[],
): void {
  companionProfileProvider = provider;
}

export function listMcpServerProfiles(): ListedMcpServerProfile[] {
  const userProfiles: ListedMcpServerProfile[] = getConfigStore()
    .listMcpServerProfiles()
    .map((p) => ({ ...p, source: "user", disabledReason: null }));
  return [...companionProfileProvider(), ...userProfiles];
}

export function upsertMcpServerProfile(record: McpServerProfile): void {
  if (record.id.startsWith(BUILTIN_PROFILE_PREFIX)) {
    throw new ConfigFileError(
      `Cannot modify built-in companion profile "${record.id}"`,
    );
  }
  getConfigStore().upsertMcpServerProfile(record);
}

export function deleteMcpServerProfile(id: string): boolean {
  if (id.startsWith(BUILTIN_PROFILE_PREFIX)) {
    throw new ConfigFileError(
      `Cannot delete built-in companion profile "${id}"`,
    );
  }
  return getConfigStore().deleteMcpServerProfile(id);
}

export function getSessionCreationDefaults(): SessionCreationDefaults {
  return getConfigStore().getSessionCreationDefaults();
}

export function upsertSessionCreationDefaults(
  defaults: SessionCreationDefaults,
): void {
  getConfigStore().upsertSessionCreationDefaults(defaults);
}
