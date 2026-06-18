# Research: benchmark success criteria & evaluation vocabulary

The hard, open part of `completed/benchmark-v1.md`: how to define a **simple, useful**
success signal for a prompt run — robust to LLM non-determinism, useful to an MCP-server
tester, and (for V1) evaluable **deterministically without an LLM judge** — and what
**vocabulary** to use. Findings are grounded in current eval-framework practice (sources at end).

## How serious tool-use / agent benchmarks define success

The strongest benchmarks decide pass/fail **deterministically against a verifiable artifact**,
not by asking a model whether it succeeded:

- **BFCL (Berkeley Function-Calling Leaderboard)** — checks *which function was called with
  which arguments* via AST matching (function name, required params, types/values vs a
  reference) and executable matching. This is exactly our "expected tools called" + argument
  validity angle.
- **τ-bench (Sierra)** — checks the **final database state** against an annotated goal state,
  not the chat text.
- **SWE-bench** — runs the repo's actual test suite (`FAIL_TO_PASS`/`PASS_TO_PASS`).

Pattern: anchor success to a verifiable artifact (chosen tool + args, end state, passing
tests) because answer *text* is noisy and gameable. LLM-as-judge shows up only for open-ended
generation quality (chat, RAG faithfulness), not tool-behavior pass/fail.

**Implication for mcpscope:** we get BFCL-style *tool-call* checks for free from persisted
state (which tools, with what args, did any error). τ-bench-style *state* checks are **not
generically possible** — an MCP server's internal state is opaque to us — which is why any
answer/state-level success beyond tool behavior needs either user-provided programmatic checks
or (later) an LLM judge.

## Non-determinism: report pass@k AND pass^k

- **pass@k** = at least one of k repetitions succeeds (optimistic / best-case).
- **pass^k** ("pass-hat-k") = *all* k repetitions succeed (reliability / consistency).
  Introduced by τ-bench for exactly this non-determinism problem; decays fast (a 90%-per-run
  case is ~57% at pass^8; GPT-4o dropped <50% → <25% from pass^1 to pass^8 on τ-retail).

The **gap between pass@k and pass^k is the most decision-relevant signal** for "is this
prompt's success reliable or flaky." Inspect operationalizes this with **epochs**
(repetitions) + **reducers** (`pass_at`, `pass_k`, `at_least`, `mean`). Report both per case.

## LLM-as-judge bias, and why we avoid self-judging

Documented biases: **self-preference/self-enhancement** (a model favors its own outputs),
**position bias**, **verbosity bias**. Standard mitigations: a *different/stronger* judge
model, pairwise comparison with order-swapping, rubrics, ensembles, human calibration.

On a model judging **its own** output or being asked "did you succeed?": the evidence is
clearly negative — "LLMs Cannot Self-Correct Reasoning Yet" (Huang et al., ICLR 2024) and the
self-correction survey (Kamoi et al., TACL) show reliable self-correction needs *external*
signals, and verbalized confidence is poorly calibrated. **So self-judging is out.** It is
also methodologically bad here: a self-reflection turn pollutes the task session and biases
behavior. If we want qualitative success later, use a **separate** judge model (Phase C).

## Recommendation (ranked) for mcpscope

1. **Deterministic tool-behavior checks (V1 default).** Assert on which tools were called /
   not called, argument validity, and no tool errors. Reliable, reproducible, cheap, not
   gameable — and the observable contract for an MCP server *is* its tool calls.
2. **Programmatic answer checks** (contains / regex / number±tolerance) — secondary, opt-in,
   phrasing-brittle; keep loose.
3. **LLM-as-judge with a separate model + rubric** — deferred (Phase C), open-ended only.
4. **Self-judging — do not implement.**

Aggregate per case as **success rate + pass@k + pass^k** over the repetitions.

## Vocabulary (build on community terms, not xUnit)

"Test suite / test case" assumes a deterministic green/red on a single run; we produce a
*distribution* across repetitions. The LLM-eval frameworks dropped "test case" for
sample/example + epochs/repetitions + a reducer for exactly this reason.

| Framework | suite | case | one suite execution | repeated attempt of a case | check unit |
|---|---|---|---|---|---|
| Inspect (AISI) | Task/Dataset | **Sample** | (eval) | **Epoch** | **Scorer** (+reducer) |
| OpenAI Evals | Eval | Sample | **Run** | — | Grader |
| promptfoo | config | Test | run | `repeat` | **Assertion** |
| LangSmith | Dataset | Example | **Experiment** | (repetitions) | Evaluator |
| Braintrust | Dataset | row | **Experiment** | — | **Scorer** |
| DeepEval/Ragas | dataset | Test case | run | — | Metric |

Notes: "Scorer" is the most cross-framework term for the check unit ("assertion" for a single
deterministic rule); avoid "metric" (overloaded with our collected stats). "Run" is universal
but **collides** (W&B/LangSmith "run" = one case's output; OpenAI/colloquial "run" = whole
execution) — be explicit. "Epoch" (Inspect) is the only first-class name for a per-case
repetition.

**Recommended for mcpscope:** benchmark (suite) · **case** (not "test case") · **run** (one
execution) · each repetition is **a session** (mcpscope already has this noun — reuse it
rather than invent "trial/epoch") · **check** (deterministic rule; "scorer" is the community
synonym) · report **pass@k + pass^k**.

## Open questions

- `answer_number` extraction (units, multiple numbers): start with "any extracted number
  within tolerance passes, flag ambiguity," revisit with real traces.
- `answer_contains`: support OR-of-alternatives to reduce brittleness (cheap).
- Tool-call ordering checks (A before B): defer; set-membership only for V1.

## Sources

BFCL: openreview.net/pdf?id=2GmDdhBdDk · github.com/ShishirPatil/gorilla (berkeley-function-call-leaderboard).
τ-bench: arxiv.org/abs/2406.12045 · sierra.ai/blog/benchmarking-ai-agents.
SWE-bench: arxiv.org/pdf/2310.06770 · openai.com/index/introducing-swe-bench-verified.
Self-correction: arxiv.org/abs/2310.01798 · direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00713.
LLM-judge bias: arxiv.org/pdf/2410.21819.
Vocabulary: inspect.aisi.org.uk/scorers.html · github.com/openai/evals · promptfoo.dev/docs/configuration/test-cases ·
docs.langchain.com/langsmith/evaluation-concepts · braintrust.dev/foundations/what-is-an-eval · github.com/confident-ai/deepeval.
