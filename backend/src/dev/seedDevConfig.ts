import fs from "node:fs";
import path from "node:path";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";
import { getBackendConfig } from "../config.js";

const envSchema = z.object({
  lmStudioBaseUrl: z.string().url(),
  lmStudioApiKey: z.string().min(1),
  lmStudioModel: z.string().min(1),
  mcpServerUrl: z.string().url(),
});

const DEV_CONNECTION_ID = "dev-lmstudio-connection";
const DEV_MODEL_CONFIG_ID = "dev-lmstudio-model";
const DEV_MCP_PROFILE_ID = "dev-mcp-profile";

function ensureEnvLoaded(): void {
  const envPath = path.join(process.cwd(), ".env.dev");
  if (fs.existsSync(envPath)) {
    loadDotEnv({ path: envPath });
  }
}

function now(): number {
  return Date.now();
}

function main(): void {
  ensureEnvLoaded();

  const env = envSchema.parse({
    lmStudioBaseUrl: process.env.LMSTUDIO_BASE_URL,
    lmStudioApiKey: process.env.LMSTUDIO_API_KEY,
    lmStudioModel: process.env.LMSTUDIO_MODEL,
    mcpServerUrl: process.env.MCP_SERVER_URL,
  });

  const runtimeConfig = getBackendConfig();
  // Default config path matches what app.ts uses: {dataDir}/mcpscope.config.json
  const configPath =
    process.env.MCPSCOPE_CONFIG_PATH ??
    path.join(runtimeConfig.dataDir, "mcpscope.config.json");

  const timestamp = now();

  const configData = {
    lm_connections: [
      {
        id: DEV_CONNECTION_ID,
        name: "Dev LM Studio",
        baseUrl: env.lmStudioBaseUrl,
        apiKey: env.lmStudioApiKey,
        providerType: "lmstudio",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    model_configs: [
      {
        id: DEV_MODEL_CONFIG_ID,
        name: "Dev Smoke Model",
        connectionId: DEV_CONNECTION_ID,
        modelKey: env.lmStudioModel,
        modelDisplayName: env.lmStudioModel,
        systemPrompt: "",
        temperature: 0.7,
        reasoning: "on",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    mcp_server_profiles: [
      {
        id: DEV_MCP_PROFILE_ID,
        name: "Dev MCP Server",
        url: env.mcpServerUrl,
        transport: "streamable-http",
        authType: null,
        authValue: null,
        defaultEnabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    session_creation_defaults: {
      default_model_config_id: DEV_MODEL_CONFIG_ID,
    },
  };

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), "utf-8");

  console.log(`Seeded backend dev config to ${configPath}`);
  console.log(`- LM Studio connection: Dev LM Studio`);
  console.log(`- Model config: Dev Smoke Model`);
  console.log(`- MCP profile: Dev MCP Server`);
}

main();
