# Thinking Tokens & Context Management

**Tested with:** `zai-org/glm-4.7-flash` on `lms2.fleurey.com`  
**Payload files:** `thinking-test-2a-no-reasoning.json`, `thinking-test-2b-with-reasoning.json`

---

## Core question: do thinking tokens accumulate in the context?

**Short answer: No — but only because the CLIENT chooses not to send them back.**

Thinking tokens are transient by default. Whether they accumulate across turns is entirely under the client's control through the `messages` array sent with each request.

---

## Who manages the context?

**The client (our app) manages the context, not LM Studio.**

LM Studio has no persistent session state between API calls. Each request to `/v1/chat/completions` is stateless — the server re-encodes the full conversation from scratch every time. There is no server-side session memory.

The `messages` array we send in each request IS the entire context. Whatever we put in there is what the model sees. Whatever we omit is gone.

---

## Test results: content-only vs. reasoning-included history

We ran three calls with a reasoning model:

```
Turn 1 request:  [user: "Say exactly the word: apple"]
Turn 1 response: prompt=11  completion=135  reasoning=132  total=146
                 → content: "apple"
                 → reasoning_content: "1. Analyze request... 2. Formulate: apple..." (132 tokens)

Turn 2A request: [user: "apple",  assistant: {content:"apple"},  user: "Now say: banana"]
                 ↑ reasoning_content NOT included (what our app does)
Turn 2A response: prompt=22  completion=142  reasoning=139  total=164
                  → prompt delta: +11 tokens  (content "apple" + user message)

Turn 2B request: [user: "apple",  assistant: {content:"apple", reasoning_content:"..."},  user: "Now say: banana"]
                 ↑ reasoning_content explicitly included
Turn 2B response: prompt=64  completion=110  reasoning=107  total=174
                  → prompt delta: +53 tokens  (content + reasoning text + user message)
```

**Conclusion:** Turn 2B's prompt is 42 tokens larger than 2A's — exactly the tokens in the `reasoning_content` field we sent. The API counts `reasoning_content` as prompt tokens when included in history.

---

## What our app does (correct behaviour)

In `chatStore.ts`, when building the messages array for each API call:

```typescript
const history = get(activeMessages).map(m => ({ role: m.role, content: m.content }))
```

We map messages to `{role, content}` only — **`thinking` (reasoning_content) is intentionally excluded** from history. This means:

- Reasoning tokens from turn N do **not** appear in turn N+1's `prompt_tokens`
- The persistent context grows only from the text content of each turn
- `prompt_tokens` grows monotonically with conversation length (no dramatic drops or spikes)

---

## What happens to thinking tokens during the current turn?

Thinking tokens **do consume context window space** during generation of the current response.

```
Turn N context window usage during generation:
  [all prior messages as prompt] + [thinking tokens] + [content tokens]
  = prompt_tokens(N)             + reasoning_tokens(N) + content_tokens(N)
  = total_tokens(N)
```

If the model thinks for 5000 tokens, those 5000 tokens occupy the context window during that generation. This means:
- A model with 8192 context and 4000 tokens of accumulated history only has ~4192 tokens left for thinking + response
- Long reasoning chains can hit the context limit even in short conversations

After the turn completes, **thinking tokens are not forwarded** to the next turn (our client strips them), so they don't contribute to the next turn's `prompt_tokens`.

---

## The two context metrics

This leads to two distinct and valid metrics:

| Metric | Formula | Meaning |
|---|---|---|
| **Persistent context** | `prompt_tokens(N)` | What's actually accumulated in the persistent message history. Grows monotonically. What the next turn will start with (approximately). |
| **Generation context** | `total_tokens(N)` = `prompt_tokens + completion_tokens` | The full context window occupation during generation of turn N, including transient thinking. |

**For the context bar**, `prompt_tokens` is the right metric:
- It represents what's actually building up turn over turn
- It predicts how quickly you'll run out of context across a long conversation
- Using `total_tokens` is misleading because reasoning tokens don't carry over (makes the bar shrink if next turn has less thinking)

**Note:** `prompt_tokens` at turn N is NOT just the current user message. It is the full accumulated conversation: system prompt + all prior turns' content (not reasoning) + current user message.

---

## Context size after a turn completes

After turn N finishes, the "effective" context size (what will be the starting prompt for turn N+1) is:

```
context_after_turn_N = prompt_tokens(N) + content_tokens(N)
                     = prompt_tokens(N) + completion_tokens(N) - reasoning_tokens(N)
                     ≈ prompt_tokens(N+1)
```

This is what grows monotonically. Reasoning tokens are excluded because they're stripped by our client.

---

## Can we manipulate the context?

**Yes — we have full control.** Options available to us as the client:

| Technique | How | Effect |
|---|---|---|
| **Strip reasoning from history** | Don't include `reasoning_content` in messages (current behaviour) | Reasoning tokens don't accumulate |
| **Include reasoning in history** | Add `reasoning_content` to assistant messages | Model sees its prior thinking; costs extra prompt tokens |
| **Sliding window** | Truncate old messages from `messages[]` | Older turns drop out of context; reduces prompt_tokens |
| **Summarise old turns** | Replace old messages with a summary message | Compress history; reduces prompt_tokens |
| **Strip thinking from old turns** | Keep `content` only (current), optionally replace assistant content with a shorter summary | Reduce content token accumulation |
| **MCP tool call pruning** | Remove completed tool calls from history | Reduce tool-call context overhead (future) |

**What we cannot control:**
- How much the model thinks during generation (no `max_thinking_tokens` in LM Studio's OpenAI-compat API)
- Server-side KV cache behavior (opaque; not observable via API)
- The reasoning effort when `reasoning: {effort: "high"}` is set — the model decides how much to think

---

## Implication for context bar display

Our context bar uses `prompt_tokens` (persistent context) with the label "Context". This is correct.

The per-message stat "Context: X/Y (Z%)" shows the persistent context at the end of that turn — how much of the context window is committed to conversation history. This number grows steadily and is the right indicator of "how close are we to the limit?"

**The reasoning tokens do not make the bar jump** — they only appear during generation and are then stripped from the persistent context. This is by design and is the correct behaviour for a reasoning model in multi-turn chat.

---

## Summary

1. **Thinking tokens are transient by default** in our app — they consume context during generation but are not forwarded to subsequent turns.
2. **The client (our app) fully controls this** — by including or excluding `reasoning_content` in the messages array.
3. **`prompt_tokens` is the correct context bar metric** — it represents the persistent, accumulated context and grows monotonically.
4. **`total_tokens` represents context during generation** — it includes transient reasoning and can fluctuate significantly.
5. **We can implement context management techniques** (sliding window, summarisation) in the future — the architecture supports this since we own the messages array.
6. **Limitation noted:** We cannot limit how much the model thinks per turn; long reasoning chains can still cause context exhaustion within a single turn.
