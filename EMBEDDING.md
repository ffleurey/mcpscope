<!-- markdownlint-disable MD013 -->
# Embedding `mcpscope-engine`

A step-by-step guide to importing the mcpscope chat/session engine into your own
Node.js/TypeScript app. If you just want to read the package's one-page summary,
see [`packages/engine/README.md`](packages/engine/README.md); this document is
the full tutorial and integration reference.

> **Audience:** developers (and coding agents) integrating the engine in-process.
> Every code snippet is written against the real public API and is meant to
> compile as-is.

## Contents

1. [What the engine is (and isn't)](#1-what-the-engine-is-and-isnt)
2. [Requirements & install](#2-requirements--install)
3. [Mental model](#3-mental-model)
4. [Quick start](#4-quick-start)
5. [Configuration](#5-configuration)
6. [Sessions and turns](#6-sessions-and-turns)
7. [Transparency: the event stream](#7-transparency-the-event-stream)
8. [Reading history: traces, inspect, list](#8-reading-history-traces-inspect-list)
9. [Persistence & crash recovery](#9-persistence--crash-recovery)
10. [A complete example: Express + per-user sessions](#10-a-complete-example-express--per-user-sessions)
11. [Multi-tenancy & security](#11-multi-tenancy--security)
12. [Testing your integration](#12-testing-your-integration)
13. [API reference](#13-api-reference)
14. [Troubleshooting / FAQ](#14-troubleshooting--faq)
15. [Quick reference (for coding agents)](#15-quick-reference-for-coding-agents)

---

## 1. What the engine is (and isn't)

`mcpscope-engine` is the **chat/session runtime** extracted from mcpscope. It runs
an agent loop — a model turn, then any MCP tool calls it requested, then another
model turn, up to `maxToolRounds` — and persists everything with fine-grained
transparency.

**It owns:** sessions, turns, the agent loop, MCP tool calling, LM provider
connections, SQLite persistence, crash recovery, and the transparency event
stream.

**It does *not* own:** HTTP/transport, users, authentication, or access control.
There is no server and no user concept — your app owns those and drives the engine
in-process. Benchmarking, evaluation, and analysis live in the mcpscope
*workbench*, not in the engine.

Use it when you want an embedded, local-first agent runtime with an audit trail
and a tiny dependency surface. Don't use it if you need a turnkey multi-user chat
server out of the box — you'd be building the transport and auth layer yourself
(which is the point: that layer is yours).

## 2. Requirements & install

- **Node.js >= 24** — the engine uses the built-in `node:sqlite`, which stabilized
  in Node 24. There is no `better-sqlite3`/native module.
- **ESM** — the package is `"type": "module"`; import it, don't `require()` it.
- **One runtime dependency: `zod`.** No Fastify, no MCP SDK, no telemetry.

```sh
npm install mcpscope-engine
```

## 3. Mental model

```
your app  ─┬─►  engine.createSession()  ──►  session (persisted)
           │
           ├─►  engine.send(session, prompt)  ──►  a TURN is scheduled
           │                                        │
           │        ┌───────────────────────────────┘
           │        ▼
           │   model turn ──► (tool calls?) ──► MCP tools ──► model turn ──► …   (≤ maxToolRounds)
           │        │
           ├─►  engine.onEvent(cb)  ◄── token deltas, part/round/turn commits, usage, context state
           │
           └─►  engine.getTrace(session)  ──►  transcript + context views + per-part tokens
```

- A **session** is a durable conversation. It has a model config and zero or more
  MCP server profiles attached.
- A **turn** is one user prompt and the model/tool work it triggers. Turns for a
  single session are strictly ordered (the scheduler enforces per-session
  ordering; by default the scheduler runs one job at a time globally).
- A **part** is the smallest committed unit (a chunk of assistant text, a tool
  call, a tool result, a reasoning block). Parts carry token attribution and
  context-window state — this is the transparency layer.
- The **scheduler** owns turn ordering and emits events. You subscribe with
  `onEvent`.

## 4. Quick start

The smallest possible engine — in-memory database, no config file, talking to a
local LM Studio server:

```ts
import { createEngine } from 'mcpscope-engine'

const engine = await createEngine({
  storage: { memory: true },              // or { sqlitePath: '/var/lib/app/engine.db' }
  configPath: './mcpscope.config.json',   // or omit and seed programmatically (see §5)
  maxToolRounds: 8,
})

// Stream everything the engine does to your own transport.
const unsubscribe = engine.onEvent((event) => {
  console.log(event.type, event)
})

const { session } = await engine.createSession({ title: 'Demo', wait: true })
await engine.send({ session_id: session.id, prompt: 'Say hello in one word.', wait: true })

const trace = engine.getTrace(session.id)
console.log(JSON.stringify(trace, null, 2))

unsubscribe()
engine.close()
```

`wait: true` blocks until the operation reaches a terminal state (init finished,
turn complete/error). Omit it to drive things asynchronously and observe progress
through `onEvent` instead — that's what a real UI does.

## 5. Configuration

The engine needs at least one **LM connection** and one **model config** to run a
turn. MCP **server profiles** are optional (a session with none is a plain chat).

You can supply config two ways; they compose (file first, then programmatic).

### 5a. From a config file

Point `configPath` at a `mcpscope.config.json`. The format is documented in
[`CONFIG.md`](CONFIG.md). Missing file → the engine starts empty.

```ts
const engine = await createEngine({
  storage: { sqlitePath: '/var/lib/app/engine.db' },
  configPath: '/etc/my-app/mcpscope.config.json',
})
```

### 5b. Programmatically (no file)

Pass records directly. With `{ memory: true }` storage and no `configPath`,
nothing is written to disk.

```ts
const engine = await createEngine({
  storage: { memory: true },
  config: {
    lmConnections: [
      {
        id: 'lmstudio',
        name: 'LM Studio (local)',
        baseUrl: 'http://127.0.0.1:1234/v1',
        providerType: 'lmstudio',       // 'lmstudio' | 'ollama' | 'openrouter' | 'openai-compatible'
        // apiKey: process.env.LM_KEY,  // optional
      },
    ],
    modelConfigs: [
      {
        id: 'qwen',
        name: 'Qwen 3 (small)',
        connectionId: 'lmstudio',
        modelKey: 'qwen3-4b',           // the provider's model id
        systemPrompt: 'You are a concise assistant.',
        temperature: 0.4,               // optional; omit to use the provider default
        contextSize: 32768,             // optional
      },
    ],
    mcpProfiles: [
      {
        id: 'weather',
        name: 'Weather MCP',
        url: 'https://mcp.example.com/mcp',
        transport: 'streamable-http',
        authType: 'bearer',             // 'none' | 'bearer' | 'basic'
        authValue: process.env.MCP_TOKEN ?? null,
        defaultEnabled: true,           // attached to new sessions unless overridden
      },
    ],
    sessionCreationDefaults: { defaultModelConfigId: 'qwen', updatedAt: Date.now() },
  },
})
```

### 5c. Mutating config at runtime

`engine.config` is the live `ConfigStore`. Upserts take effect immediately and
(for file-backed stores) persist atomically:

```ts
engine.config.upsertLmConnection({ id: 'ollama', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', providerType: 'ollama' })
engine.config.upsertModelConfig({ id: 'llama', name: 'Llama', connectionId: 'ollama', modelKey: 'llama3.1' })
engine.config.listModelConfigs()   // → ModelConfig[]
```

**Field reference**

| Record | Required | Notable optional |
|---|---|---|
| LM connection | `id`, `name`, `baseUrl`, `providerType` | `apiKey`, `autoSwapModel` (LM Studio) |
| Model config | `id`, `name`, `connectionId`, `modelKey` | `systemPrompt`, `temperature`, `reasoning` (`'on'`/`'off'`), `contextSize` |
| MCP profile | `id`, `name`, `url` | `transport`, `authType`, `authValue`, `defaultEnabled` |

## 6. Sessions and turns

### Create a session

```ts
const { session } = await engine.createSession({
  title: 'Support chat',          // optional — defaults to 'New session'; auto-titled from first prompt
  model_config_id: 'qwen',        // optional; falls back to sessionCreationDefaults
  mcp_profile_ids: ['weather'],   // optional; overrides the default-enabled selection
  compaction: 'strip-reasoning',  // optional: 'none' | 'strip-reasoning' (default)
  wait: true,                     // block until init finishes
})
// session = { id, title, status, init_status, model: { id, name } }
```

Session initialization connects to the MCP servers and probes the model. With
`wait: true`, `session.init_status` is terminal (`ready` or `error`) on return.

When `title` is omitted (or default), the engine auto-titles the session from the
first user prompt and emits a `session-title-changed` event on `onEvent`.

### Manage sessions

```ts
// Rename a session.
const { session_id, title } = await engine.renameSession({
  session_id: session.id,
  title: 'New title',
})

// Delete a session and all its child sessions, turns, rounds, parts, and raw
// exchanges. Rejects if the session has an active or queued job.
const { deleted } = await engine.deleteSession({ session_id: session.id })
```

### Send a turn

```ts
const { turn } = await engine.send({
  session_id: session.id,
  prompt: 'What is the weather in Oslo?',
  wait: true,   // block until the turn is complete/error/aborted
})
// turn = { id, status }
```

Without `wait`, `send` returns as soon as the turn is scheduled (`turn.status`
is `running`); observe completion via `onEvent`.

### Check state

```ts
const status = await engine.status({ session_id: session.id })
// status.session.state: 'initializing' | 'ready' | 'running' | 'error'
// status.session.latest_error?: { step_id, error_kind, message }
// status.active_turn: { id, status } | null
// status.queue_position?: number   // 1-based queue position when queued
```

When a session has a pending (draft) turn that hasn't started executing yet,
`queue_position` gives its 1-based position in the scheduler queue.

### Abort a session

```ts
// Targeted abort: aborts the active turn if running, dequeues if pending,
// or reports not-running. Use this instead of abortActive() for per-session control.
const { outcome } = await engine.abortSession({ session_id: session.id })
// outcome: 'aborted' | 'dequeued' | 'not-running'

// Legacy: abort whatever is currently running (session-agnostic).
engine.abortActive()   // returns boolean; true if an active job was signalled
```

## 7. Transparency: the event stream

This is the engine's differentiator. `onEvent` gives you every scheduler and turn
event; you fan them out to your own clients (WebSocket, SSE, a queue, a log).

```ts
const unsubscribe = engine.onEvent((event) => {
  switch (event.type) {
    case 'scheduler-job-enqueued':
    case 'scheduler-job-started':
    case 'scheduler-job-completed':
    case 'scheduler-job-failed':
      // Lifecycle of a scheduled job. event.job carries the target session.
      break
    case 'scheduler-execution-event':
      // The rich per-turn stream. event.sessionId / event.jobId identify it;
      // event.event is the actual turn/tool event (see below).
      handleTurnEvent(event.sessionId, event.event)
      break
  }
})
```

`scheduler-execution-event.event` is a **turn stream event**. The important
`type` values:

| `event.event.type` | Meaning |
|---|---|
| `turn-started` | A turn began. |
| `round-started` | A model↔tool round began. |
| `part-delta` | Incremental token/text delta (streaming). |
| `part-committed` | A finished part — full `PartRecord` incl. token attribution + context-window state. |
| `round-committed` | A round finished. |
| `turn-committed` | The turn finished; carries the full trace bundle. |
| `turn-failed` | The turn errored. `errorType` distinguishes `'aborted'` (user stop), `'provider_unreachable'` (connection refused/DNS), and `'internal'` (other failures). |
| `session-title-changed` | The engine auto-titled the session from the first prompt (emitted once per session, on turn 1). |

So a live token stream comes from `part-delta`; durable, attributable records come
from `part-committed`; and `turn-committed` hands you the whole trace without a
separate `getTrace` call.

> Types: `SchedulerEvent`, `TurnStreamEvent`, `PartRecord`, and
> `SessionTraceBundle` are all exported from `mcpscope-engine`.

## 8. Reading history: traces, inspect, list

```ts
// Full trace bundle: transcript + context views + per-part token accounting.
const trace = engine.getTrace(session.id)   // SessionTraceBundle | null

// List sessions (newest first).
const { sessions } = await engine.listSessions()

// Inspect any hierarchical ID — session, turn, round, or part.
const node = await engine.inspect({ id: session.id })            // the session tree
const part = await engine.inspect({ id: `${session.id}.1T.2.3-R` }) // a specific part
// inspect returns { id, type, mode, data }; pass { short: true } for token-only.
```

Hierarchical IDs (`ABCD`, `ABCD.1T`, `ABCD.1T.2.3-R`) are how you drill from a
session down to an individual tool payload. See [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md)
for the grammar.

## 9. Persistence & crash recovery

- **Storage** is `{ sqlitePath: '/path/to.db' }` (a WAL-mode `node:sqlite` file,
  directory auto-created) or `{ memory: true }` (`:memory:`, ideal for tests).
- **Crash recovery** is automatic. `createEngine` calls `recoverInterruptedState`
  on open: any turn/session left mid-flight by an unclean shutdown is marked
  aborted/errored so the session is immediately usable again — no stuck
  `running` state. You don't call anything.
- **Config persistence** follows storage: a `configPath` file is written
  atomically on every upsert; an in-memory config (`{ memory: true }` + no
  `configPath`) is never written to disk.

## 10. A complete example: Express + per-user sessions

This is the canonical integration shape: your app owns auth and the user↔session
mapping; the engine owns everything else. (Auth middleware elided.)

```ts
import express from 'express'
import { createEngine } from 'mcpscope-engine'

const engine = await createEngine({
  storage: { sqlitePath: process.env.ENGINE_DB ?? '/var/lib/app/engine.db' },
  configPath: process.env.ENGINE_CONFIG,
})

const app = express()
app.use(express.json())

// You own auth. Assume req.userId is populated by your middleware, and that you
// persist a userId → sessionId[] mapping in your own store (not shown).
app.post('/api/sessions', async (req, res) => {
  const { session } = await engine.createSession({ title: req.body.title, wait: true })
  await myStore.linkSessionToUser(req.userId, session.id)   // your responsibility
  res.json(session)
})

app.post('/api/sessions/:id/messages', async (req, res) => {
  await assertOwnership(req.userId, req.params.id)           // your responsibility
  const { turn } = await engine.send({ session_id: req.params.id, prompt: req.body.prompt })
  res.json(turn)   // returns immediately; the client watches the SSE stream below
})

// Per-user SSE stream: forward only this session's execution events.
app.get('/api/sessions/:id/events', async (req, res) => {
  await assertOwnership(req.userId, req.params.id)
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })

  const unsubscribe = engine.onEvent((event) => {
    if (event.type === 'scheduler-execution-event' && event.sessionId === req.params.id) {
      res.write(`event: ${event.event.type}\n`)
      res.write(`data: ${JSON.stringify(event.event)}\n\n`)
    }
  })
  req.on('close', unsubscribe)
})

app.get('/api/sessions/:id/trace', async (req, res) => {
  await assertOwnership(req.userId, req.params.id)
  res.json(engine.getTrace(req.params.id))
})

app.listen(3000)
process.on('SIGTERM', () => engine.close())
```

## 11. Multi-tenancy & security

- **No user concept.** The engine has no notion of "who". Enforce ownership in
  your layer (as `assertOwnership` above); never pass a session ID from client
  input to the engine without checking it belongs to the caller.
- **Config holds secrets.** LM `apiKey` and MCP `authValue` live in the config
  store / config file. Protect the file and the DB the way you'd protect any
  credential store.
- **MCP calls leave your process.** A tool call reaches out to the configured MCP
  server URL with the configured auth. Vet the servers you attach.
- **Errors are verbatim.** Operation errors carry raw messages (useful for
  debugging a local-first tool). If you surface them to end users, sanitize.

## 12. Testing your integration

Use an in-memory engine and inject scripted gateways so tests never hit a real
model or network. `dependencies.chatCompletionGateway` / `.mcpGateway` replace the
defaults:

```ts
import { createEngine } from 'mcpscope-engine'

const engine = await createEngine({
  storage: { memory: true },
  dependencies: {
    chatCompletionGateway: myScriptedChatGateway,  // returns canned completions
    mcpGateway: myScriptedMcpGateway,              // returns canned tool results
  },
})
```

An in-memory engine with no config and no gateways is still enough to assert the
wiring — `listSessions()`, `getTrace()`, `onEvent()` all work without a model.

## 13. API reference

### `createEngine(options): Promise<Engine>`

| Option | Type | Notes |
|---|---|---|
| `storage` | `{ sqlitePath: string } \| { memory: true }` | Required. |
| `configPath` | `string` | Load a `mcpscope.config.json`. Omit for file-less. |
| `config` | `{ lmConnections?, modelConfigs?, mcpProfiles?, sessionCreationDefaults? }` | Programmatic seed, applied after `configPath`. |
| `maxToolRounds` | `number` | Rounds per turn. Defaults to the engine default. |
| `logger` | `{ error(data, msg) }` | Background error logging. |
| `dependencies` | `{ chatCompletionGateway?, mcpGateway? }` | Override the default gateways (tests). |

### `Engine`

| Member | Signature |
|---|---|
| `createSession` | `(input: CreateInput) => Promise<CreateResult>` |
| `send` | `(input: SendInput) => Promise<SendResult>` |
| `status` | `(input: StatusInput) => Promise<StatusResult>` |
| `listSessions` | `() => Promise<ListResult>` |
| `inspect` | `(input: InspectInput) => Promise<InspectResult>` |
| `getTrace` | `(sessionId: string) => SessionTraceBundle \| null` |
| `renameSession` | `(input: RenameInput) => Promise<RenameResult>` |
| `deleteSession` | `(input: DeleteInput) => Promise<DeleteResult>` |
| `abortSession` | `(input: AbortInput) => Promise<AbortResult>` |
| `onEvent` | `(listener: (e: SchedulerEvent) => void) => () => void` |
| `abortActive` | `() => boolean` |
| `close` | `() => void` |
| `config` | `ConfigStore` |
| `opCtx`, `scheduler` | The assembled context and scheduler (advanced use). |

Exported types include: `Engine`, `CreateEngineOptions`, `EngineStorage`,
`EngineConfigSeed`, `SessionRecord`, `TurnRecord`, `PartRecord`,
`SessionTraceBundle`, `SchedulerEvent`, `TurnStreamEvent`, `ProviderConnection`,
`ModelConfig`, `McpServerProfile`, and the per-operation `*Input`/`*Result` types.

## 14. Troubleshooting / FAQ

- **`SyntaxError: Cannot use import statement` / `require` fails** — the package is
  ESM. Use `import`, set `"type": "module"` (or `.mjs`), and target Node 24+.
- **`no such table` / SQLite errors on open** — you're likely on Node < 24, where
  `node:sqlite` is missing or unstable. Upgrade Node.
- **A turn never completes** — the model endpoint is unreachable or the model id
  (`modelKey`) is wrong. Check `engine.status()` → `latest_error`, and confirm the
  `baseUrl` serves an OpenAI-compatible API.
- **Tool calls do nothing** — the session has no MCP profiles attached, or the
  profile's `url`/`authValue` is wrong. Attach via `mcp_profile_ids` on
  `createSession` or set `defaultEnabled: true` on the profile.
- **I need parallel sessions** — the default scheduler runs one job at a time
  globally; per-session ordering is always enforced. (Per-session concurrency is
  a planned engine option.)

## 15. Quick reference (for coding agents)

```ts
import { createEngine } from 'mcpscope-engine'   // ESM, Node >= 24, dep: zod only

const engine = await createEngine({
  storage: { memory: true } | { sqlitePath: string },
  configPath?: string,                    // mcpscope.config.json
  config?: { lmConnections?, modelConfigs?, mcpProfiles?, sessionCreationDefaults? },
  maxToolRounds?: number,
})

engine.onEvent(e => {                     // e: SchedulerEvent
  if (e.type === 'scheduler-execution-event') { /* e.sessionId, e.event: TurnStreamEvent */ }
})                                        // → returns unsubscribe()

const { session } = await engine.createSession({ title?, model_config_id?, mcp_profile_ids?, wait? })
const { turn }    = await engine.send({ session_id: session.id, prompt, wait? })
const status      = await engine.status({ session_id: session.id })
const { sessions }= await engine.listSessions()
const node        = await engine.inspect({ id, short?, format? })
const trace       = engine.getTrace(session.id)         // SessionTraceBundle | null
const { deleted } = await engine.deleteSession({ session_id })
const { outcome } = await engine.abortSession({ session_id })  // 'aborted' | 'dequeued' | 'not-running'
await engine.renameSession({ session_id, title })
engine.abortActive()
engine.close()

// Rules: engine owns sessions/turns/tools/persistence/events. YOU own transport,
// users, auth, and session↔user mapping. No HTTP server, no user concept inside.
```

---

For the engine's design and how it was carved out of the workbench, see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). For provider specifics (LM Studio,
Ollama, OpenRouter), see [`docs/PROVIDERS.md`](docs/PROVIDERS.md).
