import { describe, expect, it } from "vitest";
import { probeRequestPromptTokens } from "./promptTokenProbing.js";
import type { ChatCompletionGateway } from "./modelTurns.js";
import type { SessionRecord } from "../domain/model.js";
import type { ApiMessage } from "../domain/selectors.js";

// The probe is best-effort token accounting. OpenRouter/OpenAI reject the
// `max_tokens: 1` probe with a 400 when the prompt would trigger a tool call, so
// a throwing probe must NOT abort the caller for OpenRouter — it degrades to an
// estimate. Other providers keep the previous fail-fast behavior.

function sessionWithProvider(providerType: string | null): SessionRecord {
  return {
    modelProfileSnapshot: {
      connectionBaseUrl: "https://openrouter.ai/api/v1",
      apiKey: "k",
      modelKey: "m",
      reasoning: null,
      temperature: null,
      providerType,
    },
  } as unknown as SessionRecord;
}

const messages: ApiMessage[] = [
  { role: "user", content: "What is the weather in Oslo?" } as ApiMessage,
];

const throwingGateway: ChatCompletionGateway = {
  async probePromptTokensDetailed() {
    throw new Error(
      "Completion failed: 400 Bad Request: max_tokens or model output limit was reached",
    );
  },
} as unknown as ChatCompletionGateway;

describe("probeRequestPromptTokens — probe failure handling", () => {
  it("falls back to an estimate (does not throw) for OpenRouter when the probe 400s", async () => {
    const result = await probeRequestPromptTokens(
      throwingGateway,
      sessionWithProvider("openrouter"),
      messages,
    );
    // Estimate is derived from message text length, so it must be a positive number.
    expect(typeof result).toBe("number");
    expect(result as number).toBeGreaterThan(0);
  });

  it("re-throws for non-OpenRouter providers (preserves fail-fast)", async () => {
    await expect(
      probeRequestPromptTokens(
        throwingGateway,
        sessionWithProvider("lmstudio"),
        messages,
      ),
    ).rejects.toThrow(/max_tokens/);
  });

  it("returns null for an empty message list without calling the gateway", async () => {
    const result = await probeRequestPromptTokens(
      throwingGateway,
      sessionWithProvider("openrouter"),
      [],
    );
    expect(result).toBeNull();
  });
});
