# mcpscope-engine

The embeddable chat/session engine extracted from [mcpscope](https://github.com/ffleurey/mcpscope):
an in-process agent runtime for Node.js/TypeScript apps that need MCP tool
calling against local-first models, with durable sessions and fine-grained
transparency — and almost no dependencies.

- **Agent loop** — model turn → MCP tool calls → repeat, bounded by `maxToolRounds`.
- **MCP client** over streamable-HTTP/SSE with bearer/basic auth (hand-rolled JSON-RPC, zero SDK).
- **Local-first providers** — OpenAI-compatible endpoints, LM Studio, Ollama, OpenRouter.
- **Durable sessions** in Node's built-in `node:sqlite` (`:memory:` supported), with crash recovery.
- **Transparency** — token deltas, per-part token attribution, context-window state, full trace bundles.
- **One runtime dependency: `zod`.** No Fastify, no MCP SDK, no native modules, no telemetry.

> Requires **Node.js >= 24** (for a stable `node:sqlite`). Apache-2.0.

## Install

```sh
npm install mcpscope-engine
```

## Quick start

```ts
import { createEngine } from 'mcpscope-engine'

const engine = await createEngine({
  storage: { sqlitePath: '/var/lib/my-app/engine.db' }, // or { memory: true }
  config: {                                             // programmatic — no file needed
    lmConnections: [
      { id: 'lmstudio', name: 'LM Studio', providerType: 'lmstudio',
        baseUrl: 'http://127.0.0.1:1234/v1', apiKey: null },
    ],
    modelConfigs: [
      { id: 'qwen', connectionId: 'lmstudio', /* … model settings … */ } as ModelConfig,
    ],
    sessionCreationDefaults: { defaultModelConfigId: 'qwen', updatedAt: Date.now() },
  },
  maxToolRounds: 8,
})

// Stream every turn/tool/token event to your own transport (WebSocket, SSE, …).
const stop = engine.onEvent((event) => myTransport.publish(event))

const { session } = await engine.createSession({ title: 'Support chat' })
await engine.send({ session_id: session.id, prompt: 'What is the weather in Oslo?' })

const trace = engine.getTrace(session.id) // transcript + context views + per-part tokens
stop()
engine.close()
```

## API

`createEngine(options)` assembles the runtime (database, config store, scheduler,
default LM/MCP gateways) and returns an `Engine`:

| Member | Purpose |
|---|---|
| `createSession(input)` | Create a session (title, optional model/MCP/compaction). |
| `send(input)` | Enqueue a user turn (`{ session_id, prompt, wait? }`). |
| `status(input)` | Lifecycle + latest turn for a session. |
| `listSessions()` | All sessions, newest first. |
| `inspect(input)` | Resolve any hierarchical ID (`ABCD`, `ABCD.1T`, `ABCD.1T.2.3-R`). |
| `getTrace(sessionId)` | Full trace bundle, or `null` if unknown. |
| `onEvent(listener)` | Subscribe to scheduler/turn events; returns an unsubscribe fn. |
| `abortActive()` | Abort the active job, if any. |
| `close()` | Close the database. |
| `config` | The instance-owned `ConfigStore` (upsert LM connections, models, MCP profiles at runtime). |
| `opCtx`, `scheduler` | The assembled context and scheduler, for advanced/custom operations. |

### Options

- **`storage`** — `{ sqlitePath: string }` or `{ memory: true }`.
- **`configPath?`** — load a `mcpscope.config.json`; omit for a purely programmatic, file-less engine.
- **`config?`** — programmatic LM connections / model configs / MCP profiles / defaults, applied after any `configPath`.
- **`maxToolRounds?`** — model↔tool rounds per turn (default: engine default).
- **`logger?`** — `{ error(data, msg) }` for background errors.
- **`dependencies?`** — override the LM/MCP gateways (e.g. scripted models in tests).

## What the engine does *not* do

It has **no user or auth concept** — access control and user↔session mapping are
the embedder's job. It exposes **no HTTP surface**; you own the transport and
fan events out to your own clients. Benchmarking, evaluation, and analysis live
in the mcpscope workbench, not here.

## Full guide

This README is the summary. The complete integration tutorial — configuration,
the event/transparency model, a full Express example, testing, and a
coding-agent quick reference — is in
[EMBEDDING.md](https://github.com/ffleurey/mcpscope/blob/main/EMBEDDING.md).

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
