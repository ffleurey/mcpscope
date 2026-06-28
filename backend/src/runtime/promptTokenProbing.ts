import type { BackendDatabase } from "../persistence/db.js";
import { runInTransaction } from "../persistence/connection.js";
import { insertRawExchangeRecord } from "../persistence/repository.js";
import type { ApiMessage } from "../domain/selectors.js";
import type { RawExchangeRecord, SessionRecord } from "../domain/model.js";
import {
  probePromptTokens,
  ProviderResponseError,
  type PromptProbeResult,
} from "../services/openai/client.js";
import {
  buildReasoningParams,
  estimateTokensFromText,
} from "../services/provider/index.js";
import type { ChatCompletionGateway } from "./modelTurns.js";
import { sessionContextBody, sessionTemperatureBody } from "./modelTurns.js";

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
    // The probe is typically the *first* request to the instance, so it is what
    // triggers the model load. It must carry `num_ctx` so auto-swap loads the
    // model at the configured context window — otherwise LM Studio loads it at
    // its own default and the wrong size sticks for the whole session.
    ...sessionContextBody(session),
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
 * Estimate prompt tokens from message + tool-definition text for OpenRouter,
 * whose non-streaming responses often omit usage (and whose probe can be
 * rejected outright). Returns null for other providers, so their counts show as
 * unknown rather than fabricated.
 */
function estimatePromptTokensForOpenRouter(
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

/**
 * True for an upstream HTTP 400 — a semantic rejection of the probe request
 * itself (e.g. `max_tokens: 1` truncating a tool call). Transport/auth/5xx
 * errors return false so they keep propagating.
 */
function isProbeRejection(err: unknown): boolean {
  return err instanceof ProviderResponseError && err.status === 400;
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
      // OpenRouter/OpenAI reject the `max_tokens: 1` probe with a 400 ("max_tokens
      // ... reached") when the prompt would trigger a tool call, so any tool-using
      // OpenRouter session would otherwise fail on this token-accounting probe.
      // Degrade to an estimate ONLY for that semantic 400 — transport/auth/5xx
      // errors (and all non-OpenRouter providers) still fail fast so real
      // connection problems surface at init.
      if (provider === "openrouter" && isProbeRejection(err)) {
        return estimatePromptTokensForOpenRouter(session, messages, tools);
      }
      throw err;
    }

    if (trace) {
      const records = makeProbeRawExchangeRecords(trace, result);
      const tx = () => runInTransaction(trace.database.connection, () => {
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
    return estimatePromptTokensForOpenRouter(session, messages, tools);
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
    if (provider === "openrouter" && isProbeRejection(err)) {
      return estimatePromptTokensForOpenRouter(session, messages, tools);
    }
    throw err;
  }
}
