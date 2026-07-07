/**
 * Shared helpers for the primary-session creation operations (create.ts,
 * launchPrimarySession.ts) and the session-ID error mapping used by all four
 * session-creating operations (those two plus createExplicit.ts and
 * launchAnalysis.ts).
 *
 * Extracted to remove the duplicated default/model/LM/MCP resolution, the
 * copy-pasted MCP snapshot builder, and the repeated SessionId* -> OperationError
 * mapping that previously lived independently in each operation.
 */
import {
  getSessionCreationDefaults,
  listLmConnections,
  listMcpServerProfiles,
  listModelConfigs,
} from "../persistence/repository.js";
import { type McpServerProfile } from "../domain/configuration.js";
import type { McpProfileSnapshot, ModelProfileSnapshot } from "../domain/model.js";
import { OperationError } from "./errors.js";
import {
  SessionIdConflictError,
  SessionIdGenerationError,
  SessionIdInputError,
} from "../runtime/modelTurns.js";

export function buildMcpSnapshot(
  mcpProfile: McpServerProfile,
): McpProfileSnapshot {
  return {
    id: mcpProfile.id,
    name: mcpProfile.name,
    url: mcpProfile.url,
    transport: mcpProfile.transport,
    authType: mcpProfile.authType ?? null,
    authValue: mcpProfile.authValue ?? null,
    createdAt: mcpProfile.createdAt,
    updatedAt: mcpProfile.updatedAt,
  };
}

/**
 * Maps the SessionId* errors thrown by createSession into the canonical
 * OperationError codes. Returns null for any other error so callers can rethrow.
 */
export function mapSessionIdError(error: unknown): OperationError | null {
  if (error instanceof SessionIdInputError) {
    return new OperationError(error.message, "invalid_session_id");
  }
  if (error instanceof SessionIdConflictError) {
    return new OperationError(error.message, "duplicate_session_id");
  }
  if (error instanceof SessionIdGenerationError) {
    return new OperationError(error.message, "session_id_generation_failed");
  }
  return null;
}

export interface ResolvePrimarySessionInputsParams {
  /** Explicit model config ID, or undefined to fall back to the configured default. */
  modelConfigId?: string | undefined;
  /** Explicit MCP profile IDs, or undefined to use the default-enabled selection. */
  mcpProfileIds?: string[] | undefined;
}

/** Successful resolution: a fully-built model snapshot plus the resolved MCP snapshots. */
export interface ResolvedPrimarySessionInputs {
  ok: true;
  modelConfigId: string;
  modelConfigName: string;
  modelProfileSnapshot: ModelProfileSnapshot;
  mcpProfileSnapshots: McpProfileSnapshot[];
}

/** Resolution failure, expressed as a ready-to-throw OperationError. */
export interface FailedPrimarySessionInputs {
  ok: false;
  error: OperationError;
}

/**
 * Resolves the model config (explicit or default), its LM connection, and the
 * MCP profile snapshots (explicit or default-enabled), then builds the canonical
 * model profile snapshot. Must be called inside a DB transaction by the caller.
 */
export function resolvePrimarySessionInputs(
  params: ResolvePrimarySessionInputsParams,
): ResolvedPrimarySessionInputs | FailedPrimarySessionInputs {
  const defaults = getSessionCreationDefaults();
  const resolvedModelConfigId =
    params.modelConfigId ?? defaults.defaultModelConfigId;

  if (!resolvedModelConfigId) {
    return {
      ok: false,
      error: new OperationError(
        "No default model config is configured for new sessions. Pass a model "
          + "explicitly (--model-config <id> / model_config_id — discover ids with "
          + "list_model_configs), or set a default in the Web UI Configuration "
          + "screen or in mcpscope.config.json (see CONFIG.md).",
        "default_model_not_configured",
      ),
    };
  }

  const modelConfig = listModelConfigs().find(
    (c) => c.id === resolvedModelConfigId,
  );
  if (!modelConfig) {
    return {
      ok: false,
      error: new OperationError(
        `Model config "${resolvedModelConfigId}" not found.`,
        "model_config_not_found",
      ),
    };
  }

  const lmConnection = listLmConnections().find(
    (c) => c.id === modelConfig.connectionId,
  );
  if (!lmConnection) {
    return {
      ok: false,
      error: new OperationError(
        `LM connection "${modelConfig.connectionId}" referenced by the selected model config no longer exists.`,
        "lm_connection_not_found",
      ),
    };
  }

  const allProfiles = listMcpServerProfiles();
  const resolvedMcpIds =
    params.mcpProfileIds ??
    allProfiles.filter((p) => p.defaultEnabled).map((p) => p.id);

  const mcpProfileSnapshots: McpProfileSnapshot[] = [];
  const notFoundIds: string[] = [];
  const disabled: string[] = [];
  for (const profileId of resolvedMcpIds) {
    const mcpProfile = allProfiles.find((p) => p.id === profileId);
    if (!mcpProfile) {
      notFoundIds.push(profileId);
    } else if (mcpProfile.disabledReason) {
      // Key-gated companion whose upstream key is not configured: refuse rather
      // than create a session whose tools would all fail in-band. The message
      // names the config key to set. (The GUI also greys these out.)
      disabled.push(`${profileId} (${mcpProfile.disabledReason})`);
    } else {
      mcpProfileSnapshots.push(buildMcpSnapshot(mcpProfile));
    }
  }
  if (notFoundIds.length > 0) {
    return {
      ok: false,
      error: new OperationError(
        `MCP profile(s) not found: ${notFoundIds.join(", ")}`,
        "mcp_profile_not_found",
      ),
    };
  }
  if (disabled.length > 0) {
    return {
      ok: false,
      error: new OperationError(
        `MCP profile(s) unavailable: ${disabled.join(", ")}`,
        "mcp_profile_disabled",
      ),
    };
  }

  const modelProfileSnapshot: ModelProfileSnapshot = {
    id: modelConfig.id,
    name: modelConfig.name,
    connectionBaseUrl: lmConnection.baseUrl,
    apiKey: lmConnection.apiKey ?? null,
    modelKey: modelConfig.modelKey,
    modelDisplayName: modelConfig.modelDisplayName,
    systemPrompt: modelConfig.systemPrompt,
    temperature: modelConfig.temperature ?? null,
    reasoning: modelConfig.reasoning ?? null,
    contextSize: modelConfig.contextSize ?? null,
    providerType: lmConnection.providerType ?? null,
    createdAt: modelConfig.createdAt,
    updatedAt: modelConfig.updatedAt,
  };

  return {
    ok: true,
    modelConfigId: modelConfig.id,
    modelConfigName: modelConfig.name,
    modelProfileSnapshot,
    mcpProfileSnapshots,
  };
}
