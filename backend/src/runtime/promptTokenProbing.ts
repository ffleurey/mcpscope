import type { BackendDatabase } from "../persistence/db.js";
import { insertRawExchangeRecord } from "../persistence/repository.js";
import type { ApiMessage } from "../domain/selectors.js";
import type { RawExchangeRecord, SessionRecord } from "../domain/model.js";
import {
  probePromptTokens,
  type PromptProbeResult,
} from "../services/openai/client.js";
import {
  buildReasoningParams,
  estimateTokensFromText,
} from "../services/provider/index.js";
import type { ChatCompletionGateway } from "./modelTurns.js";
import { sessionTemperatureBody } from "./modelTurns.js";

export type LmToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

interface ProbeTraceContext {
  database: BackendDatabase;
  sessionId: string;
  turnId: string | null;
  roundId: string | null;
}

function buildProbeBody(
  session: SessionRecord,
  messages: ApiMessage[],
  tools?: LmToolDefinition[],
): Record<string, unknown> {
  return {
    model: session.modelProfileSnapshot.modelKey,
    messages,
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...sessionTemperatureBody(session),
    ...buildReasoningParams(
      session.modelProfileSnapshot.reasoning,
      session.modelProfileSnapshot.connectionBaseUrl,
      session.modelProfileSnapshot.providerType,
    ),
  };
}

function createUuid(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

function makeProbeRawExchangeRecords(
  trace: ProbeTraceContext,
  result: PromptProbeResult,
): RawExchangeRecord[] {
  const createdAt = now();
  return [
    {
      id: createUuid(),
      sessionId: trace.sessionId,
      turnId: trace.turnId,
      roundId: trace.roundId,
      kind: "llm-probe-request",
      requestUrl: result.rawExchange.requestUrl,
      requestMethod: result.rawExchange.requestMethod,
      requestHeadersJson: result.rawExchange.requestHeadersJson,
      requestBody: result.rawExchange.requestBody,
      responseStatus: null,
      responseHeadersJson: null,
      responseBody: null,
      createdAt,
    },
    {
      id: createUuid(),
      sessionId: trace.sessionId,
      turnId: trace.turnId,
      roundId: trace.roundId,
      kind: "llm-probe-response",
      requestUrl: result.rawExchange.requestUrl,
      requestMethod: result.rawExchange.requestMethod,
      requestHeadersJson: null,
      requestBody: null,
      responseStatus: result.rawExchange.responseStatus,
      responseHeadersJson: result.rawExchange.responseHeadersJson,
      responseBody: result.rawExchange.responseBody,
      createdAt,
    },
  ];
}

/**
 * Estimate prompt tokens from message + tool-definition text. Only OpenRouter
 * has an estimate fallback today (its non-streaming responses often omit usage);
 * other providers return null so the count shows as unknown rather than fabricated.
 */
function estimatePromptTokensFallback(
  session: SessionRecord,
  messages: ApiMessage[],
  tools?: LmToolDefinition[],
): number | null {
  const provider = session.modelProfileSnapshot.providerType ?? "lmstudio";
  if (provider !== "openrouter") {
    return null;
  }
  const messageText = messages
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("");
  const toolsText =
    tools && tools.length > 0
      ? JSON.stringify(tools.map((t) => t.function))
      : "";
  return estimateTokensFromText(messageText + toolsText);
}

export async function probeRequestPromptTokens(
  chatCompletionGateway: ChatCompletionGateway,
  session: SessionRecord,
  messages: ApiMessage[],
  tools?: LmToolDefinition[],
  trace?: ProbeTraceContext,
): Promise<number | null> {
  if (messages.length === 0) {
    return null;
  }

  const body = buildProbeBody(session, messages, tools);
  const provider = session.modelProfileSnapshot.providerType ?? "lmstudio";

  if (chatCompletionGateway.probePromptTokensDetailed) {
    let result;
    try {
      result = await chatCompletionGateway.probePromptTokensDetailed(
        session.modelProfileSnapshot.connectionBaseUrl,
        session.modelProfileSnapshot.apiKey ?? undefined,
        body,
      );
    } catch (err) {
      // A token-accounting probe must never abort session init or a turn.
      // OpenRouter/OpenAI reject the `max_tokens: 1` probe with a 400 ("max_tokens
      // ... reached") when the prompt would trigger a tool call, so any tool-using
      // OpenRouter session would otherwise fail. Degrade to an estimate there;
      // other providers keep the previous fail-fast behavior.
      if (provider === "openrouter") {
        return estimatePromptTokensFallback(session, messages, tools);
      }
      throw err;
    }

    if (trace) {
      const records = makeProbeRawExchangeRecords(trace, result);
      const tx = trace.database.connection.transaction(() => {
        records.forEach((record) =>
          insertRawExchangeRecord(trace.database.connection, record),
        );
      });
      tx();
    }

    if (result.promptTokens != null) {
      return result.promptTokens;
    }

    // Fallback for providers like OpenRouter whose non-streaming responses
    // don't include usage.
    return estimatePromptTokensFallback(session, messages, tools);
  }

  const runFallbackProbe = chatCompletionGateway.probePromptTokens
    ? () =>
        chatCompletionGateway.probePromptTokens!(
          session.modelProfileSnapshot.connectionBaseUrl,
          session.modelProfileSnapshot.apiKey ?? undefined,
          body,
        )
    : () =>
        probePromptTokens(
          session.modelProfileSnapshot.connectionBaseUrl,
          session.modelProfileSnapshot.apiKey ?? undefined,
          body,
        );
  try {
    return await runFallbackProbe();
  } catch (err) {
    if (provider === "openrouter") {
      return estimatePromptTokensFallback(session, messages, tools);
    }
    throw err;
  }
}
