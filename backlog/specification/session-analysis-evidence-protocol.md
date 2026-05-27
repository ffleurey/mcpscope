# Session analysis evidence protocol

This task is an experimentation and specification task.

Its purpose is to use the current shipped analysis workflow to discover what process, workflow shape, and prompt discipline are actually needed for trustworthy session analysis before mcpscope locks down detailed product contracts.

## Problem

The current analysis MVP proves that the product can launch an analysis session and produce an answer, but that answer is not yet reliable enough to support MCP-server improvement work.

This is a critical product problem because the longer-term goal is to close the loop across many analyzed sessions or runs and aggregate their findings into concrete recommendations about how to improve MCP tools, tool descriptions, and parameter design.

If single-session analysis is not well grounded, then later aggregation will only amplify noise, plausible stories, and bad recommendations.

Observed failure mode:

- the analysis model inspects too little of the session
- it minimizes tool calls
- it writes a plausible-sounding story early
- it hallucinates explanations instead of systematically grounding conclusions in the session evidence

This is especially obvious on smaller or lazier models, but it should be treated as a product-design problem rather than only a model-selection problem.

If mcpscope scales analysis to repeated runs or benchmark workflows before fixing this, it risks automating bad judgment.

## Goal

Experiment with the current analysis workflow and define an evidence-grounded protocol for one session that:

1. forces sufficient coverage of the session before judgment
2. separates evidence extraction from final interpretation
3. produces compact outputs that remain useful to human testers
4. is robust enough to work acceptably even with smaller models

The immediate output of this task is clarity, not a finished implementation.

The motivating product goal is to make future cross-session or repeated-run aggregation acceptable and valuable. That requires single-session analysis outputs that are grounded enough to be trusted as inputs to later synthesis.

This task should answer questions such as:

- which parts of the workflow can stay prompt-driven
- which parts need deterministic scaffolding or gates
- what intermediate artifacts are actually necessary
- what exact inputs and outputs the later product increments should standardize

## Product direction

This task is not about making the prompt longer.

The likely solution is a constrained multi-step workflow with machine-checkable gates, not a single free-form analysis prompt.

At this stage, that is still a working hypothesis to test experimentally against real captured sessions and weaker models.

The product should prefer:

- deterministic structure where possible
- explicit evidence collection
- compact synthesis only after coverage is proven
- backend-owned orchestration of the analysis process

But the exact balance between deterministic preparation, prompt design, multi-turn analysis, and gated retries should be discovered here before later tasks freeze detailed interfaces.

## Candidate protocol shapes to evaluate

Keep this short and empirical. The point is to compare a few plausible workflow shapes against real bad cases.

### 1. Single model, staged passes

- pass 1: required coverage and setup inspection
- pass 2: evidence ledger for rounds, tool calls, and issues
- pass 3: compact final synthesis from the gathered evidence only

### 2. Deterministic digest plus model judgment

- backend prepares a structural digest and ordered evidence skeleton
- model focuses only on interpretation, diagnosis, and recommendations

### 3. Gated retry workflow

- model attempts analysis
- backend or a checker rejects unsupported claims or missing coverage
- model retries with explicit gaps to fill rather than free-form reconsideration

### 4. Extractor then synthesizer split

- one stage extracts grounded observations only
- a later stage produces the compact report from those observations

This task should determine which of these is good enough, simple enough, and robust enough to become the basis for later product work.

## Scope

### 0. Experimental discovery using the current product

Use the currently shipped analysis session workflow as a test harness.

This task should explicitly include manual and repeatable experiments with:

- the current analysis session launch flow
- the current session-analysis prompt and prompt variants
- stronger and weaker models where available
- real captured sessions that expose lazy inspection and hallucinated explanations

The point is to learn what process produces trustworthy output, not to assume the first draft of the protocol is already correct.

### 1. Define the required coverage for a serious analysis

The protocol should make explicit which objects must be inspected before conclusions are allowed, at least:

- the session root
- the full setup
- the relevant turn or turns
- the relevant round or rounds
- the specific parts used as evidence

It should also define when the analysis is allowed to stop and synthesize.

### 2. Define intermediate artifacts

The workflow may need structured intermediate outputs such as:

- setup/tooling summary
- user-request summary
- per-round or per-tool-call evidence ledger
- observed issue candidates tied to IDs
- final compact report

The important rule is that the final report should be derived from these intermediate artifacts rather than from a vague end-of-run impression.

This task should also decide which of these artifacts are truly necessary and which are over-design.

### 3. Decide what should be deterministic vs model-driven

The task should explicitly decide what mcpscope can prepare without asking the model to improvise, for example:

- session tree and object inventory
- ordered list of tool calls
- adjacency between reasoning, tool calls, results, and answers
- coverage checklist for the analysis pass

The model should spend its effort on interpretation, not on rediscovering basic session structure.

This is a design decision that should be informed by experiments, not fixed in advance.

### 4. Define gates against lazy or unsupported synthesis

Examples of useful gates:

- the analysis must cite inspected object IDs
- the analysis must reference setup before judging tool use
- the analysis may not issue a final judgment before required coverage is complete
- unsupported claims should cause a retry or a failed analysis outcome rather than a confident-looking report

This task should also decide whether those gates should be enforced through prompt instructions, deterministic backend checks, multi-stage orchestration, or some combination of the three.

### 5. Keep the result compact for testers

The goal is not to dump a huge trace summary on the user.

The workflow should still end in a compact report that answers:

- was the request satisfied
- was the path efficient
- what in the MCP surface appears to have helped or hurt
- what the most actionable next improvement is

## Non-goals

- no final freeze yet on the exact machine-readable input or output schema for analysis sessions
- no benchmark-wide synthesis yet
- no multi-session batch orchestration yet
- no requirement that the first version works perfectly on every weak model
- no attempt to turn mcpscope into a generic autonomous judge framework

## Testability

This task should be validated with captured sessions that are known to trigger lazy or hallucinatory analysis behavior.

Validation should include:

1. proving that required coverage actually happened
2. proving that final claims can be traced back to inspected evidence
3. comparing current free-form analysis quality vs protocol-driven analysis quality
4. testing at least one smaller model where laziness is obvious, not only a stronger flagship model
5. deciding which exact protocol pieces are mature enough to become productized inputs, outputs, or backend-owned stages

At this stage, evaluation can stay pragmatic: the current baseline is weak enough that improvement should be visible on a small set of concrete known-bad sessions before formal scoring is needed.

## Expected result

After this task:

- mcpscope has an experimentally grounded analysis protocol for one session, not just a prompt
- the project knows which parts of the analysis workflow should remain prompt-level and which need deterministic or backend-owned structure
- later analysis tasks can define exact inputs and outputs with much less guesswork
- single-session analysis becomes trustworthy enough to serve as the base layer for future repeated-run and benchmark workflows
- future batch and benchmark work can build on a stronger analysis primitive instead of amplifying bad judgments