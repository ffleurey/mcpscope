---
applyTo: '**'
---

# Build A Highly Optimized MCP Server For Small Models

You are creating a new MCP server project intended to work well with small local or resource-constrained models. The server must be designed as an LLM interface, not as a thin wrapper around an existing API.

Before deciding on tool structure, data layout, or progressive disclosure strategy, identify the exact use cases the server must support. A useful MCP server is shaped by the real tasks the model must complete, the mistakes it tends to make in that domain, and the minimum context it needs to succeed. Structure follows use case.

The central optimization target is always the same: keep the model's active context as useful, concrete, and concise as possible.

## Core Goal

Build an MCP server that helps a small model complete real tasks reliably by giving it:

- minimal but sufficient tool choice
- deterministic, bounded context retrieval
- flattened, low-ambiguity arguments
- strong docstrings and paved tool-use paths
- compact, pre-chewed outputs instead of large raw dumps
- repeatable evaluation against realistic task transcripts

The project must stay domain-agnostic. Apply this method whether the target domain is Home Assistant, infrastructure, finance, hardware, developer tooling, or anything else.

## First Principle

Start with the exact use case, not with the API surface, document corpus, or backend capabilities. The right MCP shape depends on:

- what the model is actually expected to do
- what information it needs at decision time
- what it tends to hallucinate or misuse
- what can be deferred through progressive disclosure
- what must be immediately present to avoid failure

Only after that should you decide:

- the tool hierarchy
- the curation units
- the progressive disclosure layers
- the payload format
- whether examples, recipes, exact lookups, or state inspection should dominate the interface

## Non-Goals

Do not optimize for feature count, raw API coverage, or exposing every backend operation. Do not begin with RAG, embeddings, or fuzzy search unless deterministic retrieval has already been shown to be insufficient for the target use cases.

## Required Design Principles

### 1. Outcomes, Not Operations

Design tools around user-visible outcomes. The server should do orchestration internally instead of making the model stitch together multiple fragile low-level calls.

### 2. Deterministic Retrieval First

Prefer exact or constrained lookups over open-ended search. Small models do better when they can request a specific topic, entity, device, feature, or mode instead of receiving a broad search result set.

### 3. Progressive Disclosure

Return the happy path first. Expose advanced details only through a second explicit call. If advanced data does not exist, degrade gracefully and say so in-band.

### 4. Flattened Schemas

Use top-level primitives, enums, and constrained strings. Avoid nested objects unless they are clearly necessary. Defaults should reduce decisions, not create more.

### 5. Tight Tool Surface

Start with a small set of high-value tools. Every extra tool, property, and error variant consumes model attention.

### 6. Pre-Chewed Output

Tool returns should already be distilled into bullet points, short tables, examples, and exact next steps. Do not return raw manuals, long logs, or giant JSON payloads unless the user task genuinely requires them.

### 7. Example-First Documentation

Small models usually learn better from compact patterns than from abstract reference. When a tool returns syntax or rules, it should usually also return 2 to 3 compact examples that demonstrate the valid pattern the model should copy.

Prefer:

- short definition plus worked examples
- normal example plus edge-case example
- example pairs that contrast correct and incorrect usage

If the right pattern matters, put it in the tool output, not only in the prompt.

### 8. Paved Paths

Each tool response should help the model decide the next valid step. Include explicit follow-up tool suggestions, exact IDs, or exact parameter names where helpful.

### 9. Inline Anti-Hallucination Constraints

Keep critical negative constraints close to the retrieved facts. Do not rely only on the global system prompt for rules like "do not guess syntax" or "do not invent unsupported functions". If a tool returns information about a command, entity, or workflow, append the relevant warnings directly in the payload so they remain in the model's active context.

Examples of useful inline constraints:

- unsupported syntax to avoid
- common hallucinated alternatives to avoid
- exact replacement the model must use instead
- format restrictions that frequently cause failure

### 10. Evaluation Drives Design

Do not assume a tool is good because it is logically correct. Validate whether real target models actually use it correctly and early enough.

## Small-Model Constraints

Assume the target model:

- has limited reasoning headroom under large context
- may ignore instructions unless the path is simple and explicit
- may treat documentation as advisory instead of authoritative
- may guess when a lookup feels inconvenient
- is better at copying patterns than generalizing from abstract documentation
- degrades sharply when outputs are long, ambiguous, or too nested

Design accordingly:

- keep tool payloads small; treat roughly 1000 to 2000 tokens as a practical upper ceiling, and prefer much less
- split broad topics into drill-down tools before they become long
- make the correct path shorter than the guessing path
- put the preferred pattern directly in the payload and keep the warnings beside it
- return exact next-call hints
- use explicit fencing or stable formatting for tool output

## Phase Plan

### Phase 0. Define The Real User Tasks

Before touching code, define the narrow set of tasks the MCP server must help a model complete. Capture:

- the primary user jobs
- the top failure-prone workflows
- the exact facts, state, or actions the model will need
- what the model tends to hallucinate in this domain

Create a short benchmark list of representative prompts. These will be reused throughout the project.

### Phase 1. Review Existing MCP Servers First

This is mandatory. Before designing your own tool surface, survey existing MCP servers in the target domain and adjacent domains.

Minimum review sources:

- Official MCP Registry: https://registry.modelcontextprotocol.io/
- Model Context Protocol site: https://modelcontextprotocol.io/
- VS Code MCP server documentation: https://code.visualstudio.com/docs/copilot/customization/mcp-servers
- Phil Schmid MCP best practices: https://www.philschmid.de/mcp-best-practices
- GitHub topic and code search for MCP servers in the target domain

For each candidate server, capture in a research document:

- name
- link
- domain
- transport types
- tool count
- whether it exposes tools, resources, prompts, or all three
- whether it is action-heavy, knowledge-heavy, or mixed
- schema style: flat vs nested
- output style: compact vs verbose
- setup complexity
- strengths
- weaknesses
- lessons to borrow
- lessons to avoid

Create and maintain a survey table. Preserve original links for every server and every source. Never reduce this to paraphrase only.

### Phase 2. Gather Raw Sources With Provenance

Collect raw documentation, specs, examples, API docs, forum notes, and reference implementations relevant to the target domain.

Rules:

- preserve original source files whenever possible
- store provenance for each source: URL, author or project, license when known, retrieval date
- separate raw data from curated data
- avoid mixing source truth with your processed summaries

Recommended outputs:

- a source inventory
- a prior-art notes file
- a raw-data directory
- a curated-data directory

### Phase 3. Curate Domain Knowledge For Tool Use

Turn raw sources into compact, model-facing artifacts. The curated data should be organized around the model's decision points, not around the source documents' chapter structure.

Preferred curation units:

- exact entity lookups
- feature overviews
- normal vs advanced usage notes
- example packs for common tasks and tricky edge cases
- common failure patterns
- known edge cases
- minimal working examples
- explicit anti-pattern warnings placed next to the relevant examples
- explicit next-step hints

Avoid:

- giant catch-all pages
- broad keyword search as the first interface
- raw copy-pastes of long API reference pages
- reference-only chunks with no examples when the model must later synthesize code or structured output
- context chunks with multiple unrelated concepts mixed together

### Phase 4. Design The Tool Surface Around The Curated Data

Start with a small initial tool set, usually something like:

- one entry-point overview or navigator tool
- one or more exact lookup tools
- one drill-down tool for advanced or edge cases
- one task-pattern or workflow tool if the domain needs it

Potential patterns to reuse:

- overview tool returning valid topic IDs
- exact lookup tool returning compact facts and examples
- advanced lookup tool with graceful fallback
- example retrieval tool returning 2 to 5 reusable patterns for a narrow task
- task recipe tool for common workflows
- state inspection tool when the domain is highly dynamic

Tool naming rules:

- prefix by service or domain
- use action-oriented names
- avoid vague verbs like `handle`, `process`, or `do`
- make the purpose obvious from the name alone

Tool description rules:

- say when to use the tool
- say when not to use the tool
- say what prerequisites exist
- say what shape the result has
- state follow-up tools when useful

### Phase 5. Implement The Server With Minimal Runtime Complexity

Keep the runtime simple. Put the real effort into curation, schema design, and evaluation, not framework complexity.

Recommended implementation priorities:

- deterministic handlers
- clear schema validation
- stable formatting of responses
- helpful error strings that support self-correction
- compact example injection for syntax, workflow, and edge-case lookups
- explicit resource and prompt design when useful
- easy local testing

Do not start by building a huge orchestration layer. First prove that a compact server with good curated data can solve the benchmark tasks.

### Phase 6. Add Model Guidance

Create a short system or agent guideline that teaches the model how to use the tool hierarchy.

The guidance should:

- tell the model not to guess when a tool exists
- define the normal lookup order
- distinguish overview, exact lookup, and advanced lookup paths
- instruct the model to treat tool output as authoritative
- tell the model to re-check tools during debugging instead of explaining from memory

Keep this guidance short enough that it does not become its own context burden.

If the model keeps making the same mistake, fix the tool payload, examples, or inline warnings before expanding the prompt.

### Phase 7. Evaluate With Real Models And Real Tasks

Run repeated evaluations using the actual target models, especially small local models. Preserve full transcripts.

For every run, record:

- model and version
- temperature and other relevant settings
- benchmark prompt
- tools called and order used
- whether tool use was proactive or reactive
- whether the model guessed before lookup
- whether the payload included examples and whether the model copied them correctly
- whether inline constraints suppressed known hallucinations
- whether the first answer was correct
- whether the model recovered after failure
- final task success

Classify failures into separate buckets:

- content problem: the curated data is incomplete or misleading
- tool-surface problem: the tool path is indirect, broken, or too broad
- prompt problem: the model was not guided clearly enough
- model-behavior problem: the model ignores valid evidence or guesses anyway

Do not mix these categories. If you change multiple variables at once, you lose the signal.

### Phase 8. Iterate Using The Eval Signal

Use evaluation results to refine:

- tool names
- descriptions and docstrings
- the drill-down hierarchy
- curated data chunks
- system hints
- benchmark prompts

Only add more tools after proving the current tool surface is insufficient.

## Recommended Project Structure

Use a structure close to this:

```text
project-root/
├── README.md
├── DESIGN.md
├── REQUIREMENTS.md
├── PLAN.md
├── RELATED_PROJECTS.md
├── TOOLS.md
├── research/
│   ├── mcp-server-survey.md
│   ├── best-practices.md
│   ├── benchmark-prompts.md
│   └── source-inventory.md
├── raw_data/
│   └── ... original source material ...
├── data/
│   └── ... curated, model-facing material ...
├── results/
│   └── ... eval transcripts and summaries ...
└── src/
    └── ... MCP server implementation ...
```

The important separation is:

- research explains why
- raw_data preserves source truth
- data holds model-facing curation
- results preserves evaluation evidence
- src stays relatively small

## Reusable JavaScript / TypeScript Template

For future MCP servers, reuse the same technical stack and project shape unless the domain gives you a strong reason not to. In this project, the proven baseline is: **Node.js + TypeScript + npm + `@modelcontextprotocol/sdk` + a small Express wrapper for Streamable HTTP + `tsx` for local development**. Keep one main server factory in `src/index.ts` that defines tools and handlers once, then attach transports at the edge: use **Streamable HTTP** for web-style MCP clients such as OpenWebUI, and keep an optional **stdio** entry path in the same file for desktop-style clients when needed. Store curated model-facing content in `data/`, raw source material in `raw_data/`, keep the runtime thin, and let the curation carry the intelligence.

If you want to create a similar JavaScript project quickly, bootstrap the same way every time: `npm init -y`, install `@modelcontextprotocol/sdk`, `express`, and `cors`, add `typescript`, `tsx`, and the Node/Express type packages, then create one `src/index.ts` with a single `createServer()` factory plus transport wiring. Keep the same folder split: `raw_data/`, `data/`, `results/`, and `src/`. This shape is a good default because it is simple, local-first, and already validated against real OpenWebUI and LM Studio integration work.

## Output And Retrieval Rules

Treat output format as part of the tool design. The model should get compact, reusable answers that lead naturally to the next correct call.

Preferred traits:

- short headings
- concise bullets
- exact IDs and parameter values
- 2 to 3 compact examples when the model must generate code, queries, automations, configs, or commands
- warnings beside the examples when there are common hallucinated alternatives
- one follow-up hint when useful
- overview first, then exact lookup
- normal by default, advanced on explicit demand
- graceful fallback when advanced material is missing

Avoid:

- giant prose blocks
- multiple unrelated examples
- broad unranked search results
- raw backend dumps
- stack traces unless explicitly needed for debugging
- responses that answer more than one narrow question at once

If the domain needs structured output, keep it stable and simple.

## Anti-Patterns

Avoid these common mistakes:

- building a generic `search_docs` tool as the primary interface
- exposing a backend API one endpoint at a time
- forcing the model to join multiple low-level calls to achieve a simple task
- using deeply nested schemas for routine actions
- assuming a stronger or longer system prompt can compensate for weak tool payloads
- returning syntax reference without examples when the task requires generation
- placing anti-hallucination rules only in the system prompt instead of near the retrieved data
- returning huge result sets because pagination exists
- treating setup success as evidence of task success
- changing prompt, tool design, data, and model at the same time during evaluation
- assuming a stronger model will rescue a weak tool surface

## Required Deliverables Before Declaring Phase 1 Complete

Do not consider the project properly started until all of the following exist:

- a one-page problem statement
- a benchmark prompt set
- a survey of existing MCP servers with preserved links
- a raw source inventory with provenance
- an explicit tool-surface draft
- a first-pass curation plan
- an evaluation log template

## Generic Success Criteria

The project is on track when:

- small models choose the right tools early
- first answers become more accurate
- tool payloads stay compact
- the model copies good examples instead of inventing unsupported patterns
- the model guesses less often
- failures become diagnosable by category
- new domain coverage comes mostly from data curation, not server complexity

## Compact Review Checklist

Before adding features, ask:

- Can this be solved by better curation instead of a new tool?
- Can the schema or payload be flatter and shorter?
- Would 2 to 3 stronger examples work better than more prose?
- Should the anti-hallucination warning live inside the payload?
- Can the model be given a more explicit next step?
- Can this be benchmarked with one concrete prompt?
- Are links and provenance preserved?
- Are we still designing for a small model instead of for ourselves?

## Final Instruction

Treat the project as an optimization problem over model attention, not as a race to maximum coverage. A smaller, sharper MCP server with disciplined data and evals is more valuable than a large server that small models misuse.

## Minimal Starter Skeleton

Use this as the shortest practical template. It intentionally keeps only the decisions that matter:

- Node.js + TypeScript + npm
- `@modelcontextprotocol/sdk` for the MCP server
- Express + CORS for Streamable HTTP
- `tsx` for local development
- one `createServer()` factory in `src/index.ts`
- Streamable HTTP by default, optional stdio in the same entrypoint
- `data/`, `raw_data/`, `results/`, and `src/` kept separate

### Bootstrap

```bash
mkdir my-mcp-server
cd my-mcp-server
npm init -y
npm install @modelcontextprotocol/sdk express cors
npm install -D typescript tsx @types/node @types/express @types/cors
mkdir -p src data raw_data results
```

Add the same basic scripts and compiler settings used in this project:

- `start: tsx src/index.ts`
- `build: tsc`
- ESM / `nodenext`
- strict TypeScript

### Minimal `src/index.ts`

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";
import express from "express";
import { randomUUID } from "crypto";

const TOOLS = [
    {
        name: "mydomain_get_topic",
        description: "Get one exact topic. Keep tool names concrete and input schemas flat.",
        inputSchema: {
            type: "object",
            properties: {
                topic: { type: "string", description: "Exact topic ID." },
            },
            required: ["topic"],
        },
    },
];

function handleTool(name: string, args: Record<string, unknown>): string {
    if (name !== "mydomain_get_topic") throw new Error(`Unknown tool: ${name}`);
    if (args.topic === "core") return "- Rule\n- Example\n- Next step";
    return `Unknown topic: ${String(args.topic)}`;
}

function createServer(): Server {
    const server = new Server(
        { name: "my-mcp-server", version: "1.0.0" },
        { capabilities: { tools: {} } }
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args = {} } = request.params;
        const text = handleTool(name, args as Record<string, unknown>);
        return { content: [{ type: "text", text }] };
    });
    return server;
}

const app = express();
app.use(cors());
app.use(express.json());

const sessions = new Map<string, StreamableHTTPServerTransport>();

async function handlePost(req: express.Request, res: express.Response) {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
        await sessions.get(sessionId)!.handleRequest(req, res, req.body);
        return;
    }
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => sessions.set(sid, transport),
        onsessionclosed: (sid) => sessions.delete(sid),
    });
    await createServer().connect(transport);
    await transport.handleRequest(req, res, req.body);
}

async function handleGet(req: express.Request, res: express.Response) {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
        res.status(400).json({ error: "Valid mcp-session-id header required" });
        return;
    }
    await sessions.get(sessionId)!.handleRequest(req, res);
}

async function handleDelete(req: express.Request, res: express.Response) {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
        await sessions.get(sessionId)!.close();
        sessions.delete(sessionId);
    }
    res.status(200).send();
}

app.post("/mcp", handlePost);
app.get("/mcp", handleGet);
app.delete("/mcp", handleDelete);

// Add /api/mcp too if you want the same compatibility pattern used in this project.

if (process.argv.includes("--stdio") || process.argv.includes("stdio")) {
    const transport = new StdioServerTransport();
    createServer().connect(transport).catch((error) => {
        console.error("Failed to connect stdio transport:", error);
        process.exit(1);
    });
} else {
    const port = 3000;
    app.listen(port, "0.0.0.0", () => {
        console.log(`MCP server running on http://0.0.0.0:${port}/mcp`);
    });
}
```

### Template Notes

- Keep the server factory separate from the transport wiring.
- Start with one overview tool and one exact lookup tool; add advanced drill-down only after proving the need.
- Keep domain intelligence in curated files and handler logic thin.
- Prefer Streamable HTTP when OpenWebUI compatibility matters.
- Keep stdio available if you may reuse the same server with LM Studio, Claude Desktop, or other desktop MCP clients.
- Keep the template short; copy the decisions, not every line of boilerplate.