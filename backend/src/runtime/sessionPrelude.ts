import type { PartRecord, SessionRecord } from "../domain/model.js";
import { formatSetupPartId } from "../domain/hierarchicalIds.js";
import { deriveExactDeltaTokenMetadata } from "../domain/tokenAccounting.js";
import {
  updatePartRecord,
  updateSessionRecord,
} from "../persistence/repository.js";
import type { BackendDatabase } from "../persistence/db.js";
import type { ChatCompletionGateway } from "./modelTurns.js";
import type { ApiMessage } from "../domain/selectors.js";
import { buildLmToolDefinitions } from "../domain/selectors.js";
import { probeRequestPromptTokens } from "./promptTokenProbing.js";
import {
  detectProvider,
  getProviderContextLength,
} from "../services/provider/index.js";

function now(): number {
  return Date.now();
}

export function createSystemPromptPart(
  session: SessionRecord,
  ordinal: number,
  preludePartNumber: number,
  createdAt = now(),
): PartRecord | null {
  const prompt = session.modelProfileSnapshot.systemPrompt.trim();
  if (!prompt) {
    return null;
  }

  return {
    id: formatSetupPartId(session.id, preludePartNumber, "system-prompt"),
    sessionId: session.id,
    turnId: null,
    roundId: null,
    parentPartId: null,
    ordinal,
    partType: "system-prompt",
    roleLabel: "system",
    payload: {
      text: prompt,
      json: null,
      mimeType: "text/plain",
      summary: "Model system prompt",
    },
    display: {
      state: "diagnostic",
      collapsedByDefault: true,
    },
    context: {
      state: "included",
      note: "Session-level system prompt included in every turn",
      strippedByCompactionAtTurnId: null,
    },
    tokens: {
      count: null,
      source: "unknown",
      confidence: "unknown",
      note: "Exact prompt token count has not been probed yet",
    },
    provenanceJson: null,
    createdAt,
    updatedAt: createdAt,
  };
}

export async function ensureSystemPromptTokenMetadata(
  database: BackendDatabase,
  chatCompletionGateway: ChatCompletionGateway,
  session: SessionRecord,
  parts: PartRecord[],
): Promise<PartRecord[]> {
  const systemPromptPart = parts.find(
    (part) => part.turnId === null && part.partType === "system-prompt",
  );
  if (!systemPromptPart || systemPromptPart.tokens.count != null) {
    return parts;
  }

  const promptTokens = await probeRequestPromptTokens(
    chatCompletionGateway,
    session,
    [
      {
        role: "system",
        content: systemPromptPart.payload.text,
      },
    ],
    undefined,
    {
      database,
      sessionId: session.id,
      turnId: null,
      roundId: null,
    },
  );

  if (promptTokens == null) {
    return parts;
  }

  const updatedAt = now();
  const updatedPart: PartRecord = {
    ...systemPromptPart,
    tokens: {
      count: promptTokens,
      source: "exact-api",
      confidence: "exact",
      note: "Exact LM Studio prompt token count for the system prompt message",
    },
    provenanceJson: {
      derivedFrom: "lmstudio.prompt_tokens.probe",
    },
    updatedAt,
  };

  session.systemPromptTokens = promptTokens;
  session.updatedAt = updatedAt;

  const tx = database.connection.transaction(() => {
    updatePartRecord(database.connection, updatedPart);
    updateSessionRecord(database.connection, session);
  });
  tx();

  return parts.map((part) => (part.id === updatedPart.id ? updatedPart : part));
}

function updatePartTokens(
  part: PartRecord,
  tokenMetadata: PartRecord["tokens"],
  provenanceJson: unknown,
  updatedAt: number,
): PartRecord {
  return {
    ...part,
    tokens: tokenMetadata,
    provenanceJson,
    updatedAt,
  };
}

function buildSessionPreludeMessages(parts: PartRecord[]): ApiMessage[] {
  return parts
    .filter((part) => part.turnId === null && part.context.state === "included")
    .filter(
      (part) =>
        part.partType === "system-prompt" ||
        part.partType === "mcp-instructions",
    )
    .map((part) => ({
      role: "system" as const,
      content: part.payload.text,
    }))
    .filter(
      (message): message is ApiMessage & { role: "system"; content: string } =>
        typeof message.content === "string",
    );
}

export async function ensureSessionPreludeTokenMetadata(
  database: BackendDatabase,
  chatCompletionGateway: ChatCompletionGateway,
  session: SessionRecord,
  parts: PartRecord[],
): Promise<PartRecord[]> {
  // Capture the loaded context window size once (on first call, before probing tokens).
  if (
    session.loadedContextLength == null &&
    chatCompletionGateway.getLoadedContextLength
  ) {
    const contextLength = await chatCompletionGateway.getLoadedContextLength(
      session.modelProfileSnapshot.connectionBaseUrl,
      session.modelProfileSnapshot.apiKey ?? undefined,
      session.modelProfileSnapshot.modelKey,
    );
    if (contextLength != null) {
      session.loadedContextLength = contextLength;
    }
  }

  // For providers where the native gateway didn't return context length,
  // try the provider-specific fallback (Ollama /api/show, OAI /v1/models, etc.).
  if (session.loadedContextLength == null) {
    const provider = detectProvider(
      session.modelProfileSnapshot.connectionBaseUrl,
    );
    const contextLength = await getProviderContextLength(
      session.modelProfileSnapshot.connectionBaseUrl,
      session.modelProfileSnapshot.apiKey ?? undefined,
      session.modelProfileSnapshot.modelKey,
      provider,
      session.modelProfileSnapshot.contextSize,
    );
    if (contextLength != null) {
      session.loadedContextLength = contextLength;
    }
  }

  if (session.loadedContextLength != null) {
    session.updatedAt = now();
    updateSessionRecord(database.connection, session);
  }

  let nextParts = await ensureSystemPromptTokenMetadata(
    database,
    chatCompletionGateway,
    session,
    parts,
  );
  const updatedAt = now();
  const updates = new Map<string, PartRecord>();

  const systemPromptPart =
    nextParts.find(
      (part) => part.turnId === null && part.partType === "system-prompt",
    ) ?? null;
  const mcpInstructionsPart =
    nextParts.find(
      (part) => part.turnId === null && part.partType === "mcp-instructions",
    ) ?? null;
  const toolDefinitionsPart =
    nextParts.find(
      (part) => part.turnId === null && part.partType === "tool-definitions",
    ) ?? null;

  if (
    mcpInstructionsPart &&
    mcpInstructionsPart.tokens.count == null &&
    mcpInstructionsPart.payload.text
  ) {
    const prefixMessages = systemPromptPart?.payload.text
      ? [{ role: "system" as const, content: systemPromptPart.payload.text }]
      : [];
    const combinedMessages = [
      ...prefixMessages,
      { role: "system" as const, content: mcpInstructionsPart.payload.text },
    ];

    const combinedTokens = await probeRequestPromptTokens(
      chatCompletionGateway,
      session,
      combinedMessages,
      undefined,
      {
        database,
        sessionId: session.id,
        turnId: null,
        roundId: null,
      },
    );
    const prefixTokens =
      prefixMessages.length > 0 ? (systemPromptPart?.tokens.count ?? null) : 0;
    const metadata = deriveExactDeltaTokenMetadata(
      combinedTokens,
      prefixTokens,
      "Derived as exact session-prelude prompt delta for MCP instructions",
      "Exact MCP instruction tokens could not be probed",
    );

    if (metadata.count != null) {
      updates.set(
        mcpInstructionsPart.id,
        updatePartTokens(
          mcpInstructionsPart,
          metadata,
          { derivedFrom: "lmstudio.prompt_tokens.prelude-delta" },
          updatedAt,
        ),
      );
    }
  }

  if (toolDefinitionsPart && toolDefinitionsPart.tokens.count == null) {
    const preludeMessages = buildSessionPreludeMessages(
      nextParts.map((part) => updates.get(part.id) ?? part),
    );
    const anchorMessages =
      preludeMessages.length > 0
        ? preludeMessages
        : [{ role: "user" as const, content: "Token probe anchor." }];
    const tools = buildLmToolDefinitions([toolDefinitionsPart]);
    const withoutToolsTokens = await probeRequestPromptTokens(
      chatCompletionGateway,
      session,
      anchorMessages,
      undefined,
      {
        database,
        sessionId: session.id,
        turnId: null,
        roundId: null,
      },
    );
    const withToolsTokens = await probeRequestPromptTokens(
      chatCompletionGateway,
      session,
      anchorMessages,
      tools,
      {
        database,
        sessionId: session.id,
        turnId: null,
        roundId: null,
      },
    );
    const metadata = deriveExactDeltaTokenMetadata(
      withToolsTokens,
      withoutToolsTokens,
      "Derived as exact prompt delta introduced by LM Studio tool definitions",
      "Exact tool-definition tokens could not be probed",
    );

    if (metadata.count != null) {
      session.toolDefinitionsTokens = metadata.count;
      session.updatedAt = updatedAt;
      updates.set(
        toolDefinitionsPart.id,
        updatePartTokens(
          toolDefinitionsPart,
          metadata,
          { derivedFrom: "lmstudio.prompt_tokens.tools-delta" },
          updatedAt,
        ),
      );
    }
  }

  if (updates.size === 0) {
    return nextParts;
  }

  nextParts = nextParts.map((part) => updates.get(part.id) ?? part);

  const tx = database.connection.transaction(() => {
    nextParts
      .filter((part) => updates.has(part.id))
      .forEach((part) => updatePartRecord(database.connection, part));
    updateSessionRecord(database.connection, session);
  });
  tx();

  return nextParts;
}

export function deriveExactToolPreludeTokens(
  parts: PartRecord[],
): number | null {
  const includedPreludeParts = parts.filter(
    (part) =>
      part.turnId === null &&
      part.context.state === "included" &&
      (part.partType === "system-prompt" ||
        part.partType === "mcp-instructions" ||
        part.partType === "tool-definitions"),
  );

  if (includedPreludeParts.some((part) => part.tokens.count == null)) {
    return null;
  }

  return includedPreludeParts.reduce(
    (sum, part) => sum + (part.tokens.count ?? 0),
    0,
  );
}
