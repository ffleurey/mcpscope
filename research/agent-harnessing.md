## Motivation / Question

When it come to the next step to start more elaborate analysis protocol than the "one shot" prompt based approache we have tried so far, we need to figure out how we are going to experiment with this "semi automatically / manually" and how we can implement such prototols in a good way and without re-inventing the wheel.

This is for that kind of think that people talk about agentic framework and use the agent "harnessing" expression these days. I would like to research a bit how people are implementing such multiturn agent before we impelment anything. 

This is a pure research task which we can put in the research folder as "agent_harnessing" and for which we can do a search online and in key project to undestand how people are implementing the agentic loop and combining deterministic workflows with llm turns/rounds to acheive a goal.

For our session analysis, we are talking about having the agent look at the various turns and tool calls in detail, extract a set of info from each and then processed to combine the information in a second pass to undestnand rounds and turns.

Here is one way we could implement this:
* Start the analysis and feed the model with the overall goals and outline of the conversation (the result of "inspect session"). The session will always keep that in its context. 
* Then we force one turn per tool call in the session where we force the model to read the full resoning before the tool call and the tool call itself as well as maybe the resoning after and ask the model to answer the specific questions about "Why the tool call was choosen?" and "how did it go?" (questions and output format should be way more specific that this). At then end of the turn for each such turn, we strip the context from the verbose result from calling "inspect" for teh resoning blocks and tool call which probably use a lot of context and which are no longer relevant since we have not the facts as the output from the turn. it is a  a special session-compaction strategy.
* After all tool calls have been processed we should be left in the context with the facts about each of them and it is at this point that the sequence can be analysed based on that.

This example is very tool call oriented, after experimentation we might have more steps but the question here is the architecture and workflow to do these kind of custome agents to whom we impose a workflow and for which we are adapting our context compation to fit the usecase and have the model focus on the exact data we want ti to consider.

I think this approach is cool and elegant but I want to know what people are doing. And I can see that we can also implement the same kind of workflow to be a deterministic workflow (not a session) and then use a bunch of session with a single turn in which we feed all the information in the prompt and ask for the answer. Ie. a set of simple session, for example one per tool call and then the deterministic workflow agregates the results and control excaly what is given to the next session. This is more adhoc and in a way simpler but it is more rigid, I like the idea of having a guided session in which we may experiment giving more or less autonomy to the model to see what works best as opossed to impelmenting a rigid framework. I also like the idea of using context engeeneering to keep the memory about the ongoing analysis and potentially the fact that we might be way more token efficient since we are building a single session and compacting each turns.

## Research results

## High-level conclusion

The strongest current practice is not "make one smart autonomous session and hope it behaves".

Across the frameworks and projects reviewed, the dominant pattern is:

- keep the workflow shape explicit in code
- persist explicit state between steps
- require structured intermediate outputs
- use the model for bounded judgments inside that workflow
- add checkpoints, tracing, and optional human approval where mistakes are costly

In other words, the industry trend is closer to "controlled orchestration with LLM steps" than to "one unconstrained long-running conversation".

That does not mean your guided-session idea is wrong. It means that when teams make it work in production, they usually add deterministic scaffolding around it:

- explicit step boundaries
- explicit state artifacts
- explicit stop/retry/approval conditions
- explicit memory or compaction policy

For mcpscope, this is a very good match for the direction we are already moving toward in the session-analysis protocol.

## What the ecosystem currently does

### 1. Anthropic: start with workflows, add autonomy only when necessary

Anthropic's "Building effective agents" is the clearest public statement of the current best-practice direction.

Their main distinction is:

- workflows: LLMs and tools orchestrated through predefined code paths
- agents: LLMs dynamically decide their own process and tool usage

Their recommendation is to start with the simplest pattern that works and only add more autonomy when the task truly requires it.

The workflow patterns they explicitly recommend are:

- prompt chaining
- routing
- parallelization
- orchestrator-workers
- evaluator-optimizer

That matters for our case because session analysis is not an open-ended exploration problem in the usual sense. It is a grounded evidence-processing problem with known object types and known questions. That is much closer to workflow territory than to a highly autonomous agent.

Anthropic also emphasizes two points that are directly relevant to mcpscope:

- tool results are the ground truth inside the loop
- tool interfaces and descriptions deserve as much engineering attention as the prompt itself

That lines up almost perfectly with what we observed in `MTFC`, `XZDA`, `YFRC`, and `K5BA`.

### 2. OpenAI Agents SDK: managed loop plus explicit sessions, guardrails, and code orchestration

OpenAI's current SDK exposes a built-in agent loop, but it also explicitly distinguishes between:

- letting the LLM orchestrate via tools and handoffs
- orchestrating via code for more deterministic and predictable behavior

Their docs are very clear that code orchestration is the better fit when you want:

- speed predictability
- cost predictability
- structured intermediate outputs
- evaluator loops
- deterministic sequencing

The most relevant implementation details for us are:

- persistent sessions as a first-class abstraction
- hooks to customize what history is actually sent to the model on each run
- explicit compaction wrappers around session memory
- guardrails running alongside the loop
- tool-output trimming and filtering before later calls

This is important because it validates the exact kind of idea you proposed: keep a persistent session if useful, but aggressively control what prior material is forwarded into later turns.

The interesting nuance is that OpenAI treats memory management as an explicit runtime layer, not something hidden inside the prompt. That suggests that if mcpscope experiments with guided analysis sessions, compaction should be a named, inspectable mechanism rather than an invisible optimization.

### 3. LangGraph: explicit graph state, checkpoints, interrupts, reducers, and state snapshots

LangGraph represents the "graph-first" camp.

The core idea is very simple:

- define a typed shared state
- define nodes that read the current state and return partial state updates
- define edges and conditional edges between nodes
- compile the graph with checkpointing, interrupts, retry policies, cache policies, and durable execution

The recurring implementation pattern is not a chat transcript. It is a typed state object plus deterministic node transitions.

The parts most relevant to mcpscope are:

- `StateGraph` with explicit state schemas
- reducers for merging partial outputs from multiple nodes
- checkpointers for durable execution and replay
- interrupts before or after nodes for approval or inspection
- state snapshots that make the workflow inspectable at each step

This is a strong reference model for a future mcpscope analysis harness because it matches our needs unusually well:

- the source session is fixed
- the analysis passes are known in advance
- intermediate artifacts should be structured
- we want inspectable checkpoints between passes

If we were to implement the analysis protocol outside a session transcript, a graph/state model like this is one of the cleanest fits.

### 4. AutoGen: event-driven runtime and multi-agent message protocols

AutoGen is useful mainly as an example of the event-driven, message-oriented end of the spectrum.

The current architecture emphasizes:

- routed agents with typed handlers
- an agent runtime that dispatches messages and events
- explicit orchestration patterns such as sequential workflows, graph flows, handoffs, and orchestrator-worker setups
- group-chat and ledger-based orchestration patterns

The most interesting point for us is that AutoGen's deeper runtime model is not really "prompt engineering" at all. It is closer to:

- define message types
- define routing behavior
- define who handles what next
- let the runtime manage dispatch and persistence

That is a better fit for distributed multi-agent systems than for our immediate analysis use case, but two ideas transfer well:

- explicit behavior contracts between stages
- ledger-style orchestration instead of free-form narrative memory

The Magentic-One orchestrator is especially notable because it uses a structured progress ledger rather than relying only on raw conversational history. That is very close in spirit to the per-round or per-tool-call ledgers we are discussing.

### 5. Semantic Kernel: process framework with step state and event-driven routing

Semantic Kernel's process framework is the clearest example of a business-process style implementation.

The core shape is:

- a process contains steps
- steps expose functions and may have persisted state
- steps emit events
- event routing determines which step runs next
- execution is inspectable and auditable

This is especially relevant because it shows how teams implement "AI inside a process" rather than "AI as the whole process".

The recurring implementation ideas are:

- step builders and process builders
- stateful steps with explicit activation and persisted step state
- event emission and event routing
- nested processes and fan-in/fan-out patterns
- local runtime or durable actor-backed runtime

For mcpscope, this is probably the closest conceptual match if we think of the analysis protocol as a product feature rather than an experimental chat trick.

Our passes already look like process steps:

- build coverage map
- assess tool-choice and tool-call outcomes
- adjudicate turn success
- synthesize MCP-surface diagnosis

Semantic Kernel reinforces that this kind of workflow is usually implemented as a process with explicit state transitions, not as a single evolving natural-language conversation.

### 6. Pydantic AI: typed outputs, explicit history passing, and durable wrappers

Pydantic AI represents another important current practice: make everything typed and inspectable.

The most relevant ideas are:

- output schemas for agent results
- tool and dependency typing
- explicit `message_history` passing between runs
- programmatic hand-off between agents
- durable execution wrappers using workflow engines such as Temporal, DBOS, and Prefect
- event streams and observability built around the run

Their multi-agent docs are notable because they explicitly show programmatic hand-off where application code decides which agent runs next.

That is very close to one of the options you described:

- many small bounded runs
- deterministic code decides what to send next
- only structured outputs are forwarded

Pydantic AI also makes an important philosophical point through its API shape: a conversation can be composed of multiple runs, and run boundaries are a design tool, not a failure of the abstraction. That supports the idea that one session per tool call, or one run per analysis step, is a perfectly normal design choice rather than an inelegant fallback.

## Cross-framework patterns that appear consistently

Across all of the sources above, the same implementation practices keep reappearing.

### A. Explicit state beats implicit transcript memory

The common production pattern is to keep important state in a structured object, store, or process state instead of relying on the full chat history remaining in context forever.

Examples:

- LangGraph state schemas and state snapshots
- Semantic Kernel step state
- OpenAI sessions with input filtering and compaction
- Pydantic AI message history and typed outputs
- AutoGen message protocols and routed-agent state

This is the most important result for our question. The default industry move is not to trust a growing transcript. It is to extract the facts into state.

### B. Intermediate artifacts are structured and typed

The current practice is to ask the model for bounded outputs that code can inspect.

Typical forms include:

- JSON or typed schema outputs
- ledgers
- classifications
- step-local reports
- evaluator results

That is directly aligned with our plan to ask narrow questions like:

- why was this tool selected?
- did the result match what the model appeared to expect?
- if not, was the issue wrong parameters, poor tool understanding, or a tool limitation?

### C. Checkpointing and resumability are first-class

Current frameworks assume long-running or multi-step workflows may pause, fail, or need approval.

Common mechanisms:

- LangGraph checkpointers and interrupts
- OpenAI session persistence and resumable runs
- Pydantic durable execution wrappers
- Semantic Kernel process state and actor runtimes

This suggests that if mcpscope moves toward a guided analysis harness, we should design interruption and resume points from the beginning instead of bolting them on later.

### D. Human approval and explicit gates are normal, not exceptional

Another repeated pattern is that the workflow often has code-level gates:

- approve a tool call
- verify structured output
- reject incomplete evidence
- retry a step with narrower instructions

That supports the direction of adding machine-checkable gates to the session analysis workflow rather than relying only on prompt wording.

### E. Tool and tool-description design is treated as part of the system, not a side detail

Anthropic says this explicitly, but the same assumption shows up in every framework that invests in structured tools, schema validation, or tool guardrails.

For mcpscope, this is reassuring: our focus on tool-choice rationale and tool-call success diagnostics is not unusual. It is exactly the kind of lens used in mature agent workflows.

### F. Orchestrator plus workers or extractor plus synthesizer is common

The decomposition we are considering is standard:

- workers extract facts from bounded evidence slices
- a later stage synthesizes those facts
- an evaluator or gate checks that the synthesis is admissible

That is effectively the same family of pattern as:

- Anthropic orchestrator-workers
- Anthropic evaluator-optimizer
- AutoGen orchestrator + workers / ledger manager
- code-orchestrated runs in OpenAI Agents SDK
- programmatic hand-offs in Pydantic AI

## What this means for the specific mcpscope design question

### Your guided session idea is valid, but only if the session is tightly scaffolded

The idea of a single guided session with compaction after each pass is not weird. It is actually close to what newer runtimes are trying to make possible.

But the evidence from current frameworks suggests that this should not be an unconstrained chat loop. It should look more like:

- one persistent analysis session
- deterministic system-owned turn sequence
- each turn receives a bounded evidence slice and a fixed question set
- each turn returns a structured artifact
- compaction replaces the bulky evidence slice with the resulting artifact
- later turns see only the compact ledger plus any newly required evidence

That can be elegant, but only if the workflow rules are owned by the harness, not improvised by the model.

### A purely deterministic multi-run workflow is also a normal and respectable design

Your alternative idea, where each bounded analysis step becomes its own simple session or run and code aggregates the outputs, is also exactly in line with current practice.

In fact, most frameworks make this style easier to reason about than a single persistent conversational agent.

Main strengths:

- easier to test
- easier to cache
- easier to compare across models and prompts
- easier to retry only the failing step
- much easier to prove what evidence each step saw

Main weakness:

- less flexibility for adaptive multi-step reasoning inside one persistent working memory

### The best near-term shape is probably hybrid

The current ecosystem evidence suggests that the strongest starting point for mcpscope is probably not at either extreme.

Likely best first experimental shape:

- deterministic outer workflow
- bounded model calls inside each stage
- structured artifacts passed between stages
- optional session-like memory only inside a stage or between tightly related stages
- explicit compaction or artifact substitution between stages

That gives us most of the benefits of agent harnessing without making the workflow opaque.

## Recommended architecture options for mcpscope

### Option 1. Deterministic multi-run pipeline

Shape:

- run A: build coverage map
- run B: per-tool-call assessment entries
- run C: per-round ledger
- run D: turn success adjudication
- run E: final MCP-surface synthesis

Characteristics:

- easiest to validate
- easiest to diff across prompts or models
- easiest to parallelize some stages later
- least agentic, most workflow-like

This is the safest first implementation if the goal is trustworthy research rather than maximum elegance.

### Option 2. Guided analysis session with session-owned artifact memory

Shape:

- create one analysis session
- seed it with session root and protocol goals
- drive deterministic turns that each inspect one evidence slice or one batch of slices
- after each turn, compact out the bulky inspected evidence and keep only the structured artifact
- final turn performs synthesis from the accumulated artifacts

Characteristics:

- elegant and potentially token efficient
- keeps one coherent analysis narrative
- good experimental surface for testing different amounts of model autonomy
- harder to guarantee exactly what remains in context unless compaction is very inspectable

This is the best option if we want to explore context engineering as part of the product itself.

### Option 3. Graph/process runtime with explicit checkpoints

Shape:

- represent each analysis pass as a graph node or process step
- store artifacts in explicit shared state
- add retry, interrupt, approval, and resume points between nodes
- use sessions only as execution traces or UI affordances, not as the source of truth for state

Characteristics:

- strongest long-term architecture
- closest to LangGraph or Semantic Kernel process style
- best fit for later benchmark or batch analysis
- more engineering overhead up front

This is probably where the product should head if session analysis becomes a serious backend-owned workflow.

## Recommended starting position

Based on current public practice, I would not recommend starting with a highly autonomous multi-turn analysis agent.

I would recommend:

1. use a deterministic outer workflow
2. make every intermediate artifact structured and inspectable
3. keep tool-call assessment as a first-class stage
4. treat success adjudication as its own stage
5. experiment with guided-session compaction only after the artifact contracts are stable

That gives us a clean research path:

- first learn what artifacts are actually needed
- then decide whether those artifacts should live in one compacted guided session or in multiple deterministic runs

## Specific implications for the tool-call-focused analysis idea

Your proposed workflow of one turn per tool call is very plausible, but it should probably be reframed slightly.

Instead of "one turn per tool call" as the concept, the stronger abstraction is:

- one bounded evidence-assessment unit per relevant evidence slice

Sometimes that slice will be one tool call.
Sometimes it may need to include:

- reasoning before the call
- the call payload
- the exact tool result
- the next reasoning block if the question is whether the model understood the outcome

That means the unit of orchestration should probably be an `assessment task`, not a raw session turn.

Each assessment task should produce a structured record such as:

- target IDs inspected
- local user goal
- why the tool was selected
- what the tool was expected to provide
- what the tool actually returned
- whether the result matched expectations
- if not, whether the most direct cause appears to be:
	- wrong parameters
	- misunderstanding of the tool
	- unclear tool description
	- real tool limitation
- whether the next step showed that the model understood the result

This is very close to the ledger-oriented practice visible in current frameworks.

## What to avoid

The research strongly suggests avoiding the following traps:

- relying on one large running transcript as the authoritative state
- asking for broad summaries of reasoning blocks instead of narrow factual judgments
- letting the model decide coverage boundaries for an evidence-grounded task
- mixing extraction, adjudication, and product diagnosis in one prompt
- making compaction opaque instead of inspectable
- introducing a framework abstraction that hides prompts, intermediate artifacts, or control flow too early

## Provisional recommendation for mcpscope

Short term:

- keep the session-analysis work centered on explicit artifacts and deterministic stage boundaries
- use the current captured sessions to discover the minimal artifact set
- prototype with simple orchestration before adopting a heavy framework

Medium term:

- if a persistent guided analysis session still looks attractive, implement it as a harnessed workflow with explicit turn types and explicit compaction artifacts
- otherwise move directly to a backend-owned graph/process workflow

Long term:

- treat analysis, compaction, and later benchmark synthesis as related typed workflows with shared inspectability principles

## Concrete reference cases worth studying

The frameworks above are easier to reason about once we pin them to specific examples and repos.

### 1. OpenAI Agents SDK: deterministic flows, approvals, memory, and compaction in one repo

The OpenAI Agents SDK repo is one of the clearest examples of a modern "managed loop plus explicit control" stack.

Concrete examples worth reading:

- `examples/agent_patterns/deterministic.py`: sequential bounded workflow where one agent produces an outline, another judges quality, and later steps only run if the gate passes
- `examples/agent_patterns/forcing_tool_use.py`: explicit control over how tool results are turned into final output, which is directly relevant to tool-grounded analysis workflows
- `examples/agent_patterns/human_in_the_loop.py` and `human_in_the_loop_stream.py`: interrupt, serialize run state, approve or reject tool calls, then resume
- `examples/memory/compaction_session_example.py` and `compaction_session_stateless_example.py`: explicit session compaction wrappers rather than silent history growth
- `examples/mcp/tool_filter_example`: narrow MCP tool surface enforced by code
- `examples/sandbox/healthcare_support/`: larger orchestrated workflow with persistent memory, approval gates, structured outputs, and tracing
- `examples/research_bot/` and `examples/financial_research_agent/`: useful as "complex research workflow" references, even though their domains differ from ours

Why this matters for mcpscope:

- this is the strongest concrete reference for a guided session that is still harness-owned
- sessions, approvals, filtering, and compaction are explicit runtime mechanisms, not hidden prompt tricks
- it supports the idea that a "steered session" can still be deterministic if the harness owns turn inputs, tool availability, and what history survives compaction

### 2. Anthropic cookbooks: minimal implementations of workflow patterns, plus managed-agent recovery loops

Anthropic's public material is split between simple workflow notebooks and more managed-agent demos.

Concrete references worth reading:

- `anthropics/claude-cookbooks/patterns/agents/basic_workflows.ipynb`: minimal chain, parallelization, and routing implementations; good for understanding the smallest useful control layer
- `patterns/agents/orchestrator_workers.ipynb`: explicit orchestrator that generates structured worker tasks, then collects outputs
- `patterns/agents/evaluator_optimizer.ipynb`: generator plus evaluator loop with clear pass/fail feedback contracts
- `managed_agents/CMA_orchestrate_issue_to_pr.ipynb`: realistic multi-turn coding loop with CI failure recovery and review feedback handling
- `managed_agents/linear/`: concrete webhook-backed managed-agent integration with `sessions.create`, metadata routing, and async reply handling

Why this matters for mcpscope:

- the small notebooks are good references for the first experimental version of our protocol because they show the workflow shape without much framework noise
- the managed-agent examples are useful once we care about long-lived sessions, webhooks, external events, and recovery points
- Anthropic is also the clearest reference for evaluator-style loops, which may be relevant if we later add a rejection pass for unsupported analysis claims

### 3. AutoGen: deterministic graph flow plus explicit message filtering

AutoGen is especially relevant when the question is not just "who runs next" but also "what context should each step actually see".

Concrete references worth reading:

- `python/docs/src/user-guide/core-user-guide/design-patterns/sequential-workflow.ipynb`: deterministic publish-subscribe pipeline for concept extraction -> writing -> proofing
- `python/docs/src/user-guide/agentchat-user-guide/graph-flow.ipynb`: graph examples for sequential flow, parallel fan-out, conditional loop, and filtered summary
- `python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_graph/_graph_builder.py`: builder surface for sequential, fan-out, conditional, and cyclic workflows
- `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_message_filter_agent.py`: selective visibility over prior messages
- `python/packages/autogen-agentchat/tests/test_group_chat_graph.py`: useful because it shows what the runtime authors themselves consider important enough to test: joins, loops, resume, serialization, and filtering
- older .NET workflow examples such as `Example07_Dynamic_GroupChat_Calculate_Fibonacci.cs`: concrete code-review/run/fix loop with explicit transitions and error-triggered re-entry

Why this matters for mcpscope:

- AutoGen is the best public reference we found for separating the execution graph from the message graph
- that is very close to the compaction problem we care about: later steps may need the analysis artifacts, but not the full raw inspect payloads that produced them
- if we ever build a steered session abstraction, this message-filtering idea is one of the most relevant external precedents

### 4. LangGraph: typed state plus checkpoints and resumable interrupts

LangGraph is still one of the clearest references for "stateful workflow first, transcript second".

Concrete references worth reading:

- `libs/cli/examples/graphs/storm.py`: substantial multi-stage research graph with subgraphs, parallel interview execution, outline refinement, indexing, section writing, and final article synthesis
- `examples/rag/langgraph_self_rag.ipynb`, `langgraph_crag.ipynb`, and `langgraph_adaptive_rag.ipynb`: retrieval/evaluation/regeneration loops with conditional routing
- `langgraph/types.py` interrupt support: resumable human-in-the-loop primitive tied to checkpointed execution
- `graph/state.py` compile path: explicit checkpointer, cache, store, and interrupt configuration
- `pregel/main.py` and `pregel/protocol.py`: runtime support for `get_state`, `get_graph`, subgraphs, interrupts, and state snapshots

Why this matters for mcpscope:

- LangGraph is the strongest reference if we decide the real product should be a backend-owned graph with explicit artifacts in shared state
- it also shows that interrupts and resume are not exotic features; they are normal expectations once workflows become multi-step and inspectable
- its subgraph examples are a good match for a future design where each turn or round assessment is a reusable sub-workflow

### 5. Semantic Kernel processes: event-routed steps with persisted state and versioned sub-processes

Semantic Kernel is less about chat and more about building inspectable process runtimes.

Concrete references worth reading:

- `dotnet/samples/GettingStartedWithProcesses/Step01/Step01_Processes.cs`: small loop with explicit events and conditional exit
- `dotnet/samples/GettingStartedWithProcesses/Step03/Processes/FriedFishProcess.cs`: sequential stateful process with retries on failure events and versioned process definitions
- `dotnet/samples/GettingStartedWithProcesses/Step03/Processes/FishAndChipsProcess.cs`: fan-out/fan-in process using subprocesses as steps
- `dotnet/samples/GettingStartedWithProcesses/Step03/Step03a_FoodPreparation.cs`: save state locally, load it back, and run later versions against stored state
- `python/samples/concepts/processes/cycles_with_fan_in.py`: compact Python example of cycles, fan-in, persisted step state, and explicit stop events
- `samples/Demos/ProcessFrameworkWithSignalR/README.md` and `ProcessWithDapr`: good references for user approval and distributed/runtime-backed process execution

Why this matters for mcpscope:

- this is the strongest concrete precedent for treating the analysis protocol as a product workflow with explicit state contracts
- it is also a strong reference for versioned workflows and persisted process state, which may matter once we want to compare protocol revisions over saved artifacts

## How these references map to the steered-session idea

The key clarification from this research pass is that a steered session does not have to mean "let the model improvise for many turns".

There are at least three concrete interpretations that all have public precedents:

- harness-owned guided session: closest to the OpenAI Agents SDK session plus compaction examples, where a persistent session exists but the harness owns tool surface, approvals, and history forwarding
- execution graph plus filtered memory: closest to AutoGen GraphFlow and LangGraph, where control flow and visible memory are both explicit runtime concerns
- process runtime with persisted artifacts: closest to Semantic Kernel, where the authoritative state is the process state and chat-like interaction is only one interface over it

So the distinction is not really "session" versus "deterministic workflow".
The more useful distinction is:

- where the authoritative analysis state lives
- who decides what each step can see next
- whether compaction is inspectable and replayable

That is helpful for mcpscope because it means the elegant version of the idea is still viable, but only if we make these rules first-class:

- the harness owns the turn sequence
- the harness owns which inspect payloads are reduced into which artifacts
- the harness owns which artifacts survive into later turns
- the resulting memory changes are inspectable, not hidden

If we do not want to build that machinery yet, the deterministic multi-run pipeline remains the simpler first step and is still completely aligned with current ecosystem practice.

## Sources reviewed

Primary public references reviewed for this note:

- Anthropic: Building effective agents
- OpenAI Agents SDK docs: orchestration and sessions
- LangGraph docs and repository patterns around `StateGraph`, checkpoints, and interrupts
- Microsoft AutoGen docs and repository patterns around routed agents, graph flow, and ledger orchestration
- Microsoft Semantic Kernel docs and repository patterns around the Process Framework
- Pydantic AI docs and repository patterns around typed outputs, programmatic hand-off, and durable execution

## Bottom line

The ecosystem consensus is fairly strong:

- use the model inside a controlled workflow
- store facts as structured state
- checkpoint and inspect the workflow
- compact or trim context explicitly
- keep synthesis downstream of extraction

That is encouraging for mcpscope because it means the direction we are discovering through experiments is not unusual. It is close to the way current serious agent runtimes are already being built.