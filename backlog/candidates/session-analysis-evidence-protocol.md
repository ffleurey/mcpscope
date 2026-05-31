# Session analysis evidence protocol

The shipped workflow that absorbed the main conclusions from this protocol work is now documented in:

- `SESSION-ANALYSIS.md`
- `backlog/completed/analysis-session-as-proper-session.md`

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

### 5. Controlled evidence reduction with explicit adjudication

- pass 1 builds a required-coverage map for the target turn: setup parts, rounds, reasoning parts, tool calls, tool results, and final answer parts
- pass 2 produces a compact fact ledger for each round, especially:
	- why the model appears to have chosen the next tool or answer
	- what tool was called
	- whether that tool call was relevant to the user goal in that round
	- whether the tool result succeeded, failed, or returned mixed guidance
	- the exact error or guidance text that changed the next step
	- token counts or cost signals only as secondary efficiency evidence
- pass 3 makes a narrow turn-outcome judgment from the extracted facts only: was the request answered, unsupported, partially answered, or unanswered
- pass 4 produces the final compact diagnosis about path efficiency and MCP-surface quality from the earlier structured artifacts, not from fresh free-form trace reading

Current candidate protocol to test first:

- stage A: coverage and object inventory
- stage B: per-round tool-choice and tool-call assessment
- stage C: turn success adjudication
- stage D: compact MCP-surface diagnosis

The intended flow is deliberately narrow:

- first establish what was inspected
- then establish why each tool or answer step was taken
- then establish whether the turn actually succeeded
- only then explain what this implies about the MCP surface

This ordering matters because the current failure mode is not only missing evidence. It is also premature interpretation. The protocol should therefore delay diagnosis until the session facts have already been reduced into a constrained ledger.

Starting point for the specific questions in the protocol:

For each relevant round, the analysis should answer only tightly scoped questions such as:

- what was the user goal in this round?
- why was this tool selected next according to the inspected reasoning part?
- if no tool was selected, why did the model choose to answer instead?
- was the selected tool relevant to the user goal in this round?
- what exact result did the tool call return?
- did that result match what the inspected reasoning appeared to expect from the tool call?
- if the result did not match expectations, is the most direct observed cause:
	- wrong parameters supplied by the model
	- misunderstanding of the tool's purpose, fields, or result shape
	- a tool limitation or mismatch with the task
	- unclear tool description or setup guidance
- after seeing the tool result, did the next reasoning step show that the model understood the failure, partial result, or guidance?
- if the model repeated or varied the call, what exactly changed?
- if the round ended in an answer, is that answer supported by the inspected evidence from earlier rounds?

These questions should be treated as reporting questions, not invitations to write a broad summary. The protocol should prefer short factual answers tied to inspected IDs over prose descriptions of the whole round.

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

#### Baseline experiments recorded so far

Keep a compact record of early experiments before drawing design conclusions.

- Pair `MTFC` -> `XZDA`: inspect a primary session and its analysis session, then compare what the analysis claimed against the specific inspected IDs, tool-call payloads, tool results, and final answers.
- Pair `QU8X` -> `MSYQ`: repeat the same inspection pattern on a second captured session and its analysis session, including later user follow-ups that pushed the analysis model to inspect more specific parts.
- Pair `MTFC` -> `YFRC`: rerun analysis on the same primary session with a much more specific one-shot prompt that explicitly requires setup inspection, per-round inspection, reasoning inspection, tool-result inspection, and a per-round ledger before synthesis.
- Pair `MTFC` -> `K5BA`: run the same tighter one-shot prompt shape against the same primary session with a different and much larger model to compare prompt-following and evidence discipline.

Models used in the recorded runs so far:

- `google/gemma-4-e4b` with `temperature = 0.5`
- `qwen3.6-35b-a3b-apex` with `temperature = 0.5`

This is not a controlled Gemma-vs-Qwen benchmark. The Qwen run used a significantly larger MoE model, so treat it as an illustration of model sensitivity rather than a head-to-head quality claim.

Observed baseline patterns from these experiments:

- a single root-level `mcpscope_inspect` call on the source session often led the analysis model to synthesize conclusions before it had inspected the relevant setup parts, tool-call payloads, or specific evidence-bearing parts
- the analysis model sometimes overstated what had been inspected, claiming access to reasoning content or detailed tool results that were not actually fetched in the initial pass
- user follow-up pressure improved specificity, but only after the model had already produced confident early judgments
- in both experiment pairs, the analysis was willing to write strong conclusions about request satisfaction or MCP-surface quality before coverage of the relevant turn was demonstrably complete
- these experiments are enough to justify treating the current shipped workflow as a weak baseline, but not enough yet to lock in the final solution shape

Observed changes after tightening the one-shot prompt:

- the more process-oriented prompt materially improved behavior on the same `MTFC` session by pushing the analysis model to inspect more of the runtime tree before writing its report
- under `YFRC`, the Gemma-based analysis moved in the right direction: it inspected setup parts and all three turns, and it adopted the requested report shape, but it still overclaimed coverage and still treated turn-level inspection as if it were enough to justify per-round statements
- under `K5BA`, the Qwen-based analysis followed the stricter inspect discipline much better: it inspected the detailed round objects for the relevant turns, correctly recognized repeated tool failures in `MTFC.3`, and correctly concluded that the final `16.8 °C` answer was unsupported by the inspected evidence
- the prompt therefore appears capable of improving one-shot analysis substantially, but model capability still matters a great deal for whether that prompt is actually followed rigorously

What the current experiments support about prompt quality vs model sensitivity:

- prompt specificity clearly matters; the tighter prompt improved behavior compared with the earlier weaker-prompt runs on the same source session
- model choice also clearly matters; the stronger Qwen run produced materially better evidence discipline than the smaller Gemma run under a similar prompt shape
- the current evidence is enough to justify continued work on the one-shot prompt before moving to more complex orchestration
- the current evidence is also enough to justify treating model sensitivity as a first-class concern in later evaluation, not as a secondary implementation detail

What these experiments currently support:

- preserve these session pairs as known baseline cases for future protocol comparisons
- continue evaluating whether the key problem is insufficient coverage discipline, unsupported synthesis, poor use of admissible evidence, or some combination of the three
- continue testing one-shot prompt variants on the same captured sessions before freezing a more complex multi-stage workflow
- compare prompt variants across more than one model family before treating any single-model result as representative
- avoid freezing a winning architecture yet; the immediate goal is to accumulate a small set of repeatable bad cases and compare protocol variants against them

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
- per-round reasoning-for-action summary limited to tool choice, retry choice, or answer choice
- per-tool-call outcome record including relevance, exact error text or guidance text, and token usage when available
- turn-outcome adjudication record comparing the user request against the final answer and inspected evidence
- observed issue candidates tied to IDs
- final compact report

A good starting artifact set for experiments is:

- `coverage_map`: which setup parts, rounds, reasoning parts, tool calls, tool results, and answers were inspected
- `round_action_ledger`: one entry per round explaining the chosen next action and the evidence for that explanation
- `tool_call_assessment`: one entry per relevant tool call recording expected purpose, observed result, relevance, exact failure or guidance text, and whether the mismatch appears to come from parameters, tool understanding, or tool limitations
- `turn_outcome_assessment`: a narrow decision about whether the request was answered, unsupported, partially answered, or unanswered
- `mcp_surface_findings`: only the final compact diagnosis derived from the earlier artifacts

The important rule is that the final report should be derived from these intermediate artifacts rather than from a vague end-of-run impression.

This task should also decide which of these artifacts are truly necessary and which are over-design.

Working hypothesis from the current experiments:

- a dedicated evidence-reduction pass is likely useful because it removes most narrative noise while preserving the facts that later judgment actually needs
- reasoning should be reduced narrowly, not summarized broadly; the valuable question is usually why a tool or answer was chosen next, not a prose retelling of all hidden chain-of-thought content
- tool-call summaries should preserve exact failure or guidance text because unsupported final answers often come from ignored or misunderstood tool results
- a separate turn-success pass is likely worth keeping because request satisfaction should be judged against the inspected user prompt, inspected tool outcomes, and inspected final answer, not mixed together with broader MCP-surface diagnosis
- the most important diagnostic target is not generic conversation quality; it is whether the model followed a good tool path and, when it did not, whether the evidence points to tool choice, parameter choice, tool-description clarity, or tool-surface mismatch

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

That final report should be explicitly downstream of the earlier passes. It should not have to rediscover why tools were chosen or whether tool calls actually succeeded. Those questions should already have been answered in the structured artifacts.

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

Concrete first implementation candidate derived from this protocol work:

- `backlog/candidates/session-analysis-hybrid-workflow-v1.md`