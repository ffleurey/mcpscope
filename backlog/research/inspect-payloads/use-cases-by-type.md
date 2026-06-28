# Micro use-cases by object type

A brainstorm at the **micro level**: for each inspectable type, *who* is looking and *what
single question* are they trying to answer with one fetch. The goal is to name the **key**
use-cases worth optimizing each payload + granularity for — so payload design follows real
value, not symmetry.

This complements the other two use-case views:
- per-type READMEs = the object in isolation;
- [`use-cases.md`](use-cases.md) = end-to-end **workflow** fetch paths (UC-1…UC-7);
- **this file** = the **micro** question catalogue, audience-tagged, with the keepers flagged.

## The four audiences (who fetches, and what they value)

| Audience | What they value |
|---|---|
| **Judge** (pull-on-demand LLM, rubric as oracle) | enough to score, *economically*; ID-citeable evidence |
| **Analysis workflow** (deterministic, pre-injected) | exact, ID-stable, **bounded** evidence slices |
| **Report/analysis agent** (e.g. writing a run report, comparing runs) | aggregate first, drill on anomaly |
| **Developer at the CLI** | readable, fast navigation, "why did this break" |

`[KEY]` = a use-case we should explicitly optimize the payload/granularity for. `g:` = the
granularity that best serves it.

---

## session (`SSS`)

Audience: judge, analysis, developer, report agent.

- `[KEY]` **"Did it answer the question correctly?"** — `g:full`. One fetch must carry
  user_prompt + assistant_answer (it does). The judge's most common criterion; settle it
  without further fetches.
- `[KEY]` **"Which tools did it call, in what order, with what arguments?"** — `g:full`.
  The per-round tool_call list with (capped) args. Drives every tool-selection judgement.
- `[KEY]` **"Map the tree — what can I drill into?"** — `g:summary`. Child IDs + token
  counts, no content. The router fetch; must stay cheap (this is the F3 token win).
- **"How expensive was this, and where did the tokens go?"** — `g:summary`. context_window
  + per-part token counts. Server/prompt optimization.
- `[KEY]` **"Did it fail, and why?"** — `g:summary`. *Currently weak* (F9): the header
  shows no terminal status; failure hides in a turn step + diagnostic part. A failure
  summary belongs on the session payload.
- **"What model / MCP / settings produced this trace?"** — `g:summary`. The header
  snapshot; the join key for run comparison.

## setup (`SSS.S`)

Audience: judge (config relevance), analysis (target env), developer, MCP-server author.

- `[KEY]` **"What instructions + system prompt did the model actually see?"** — `g:full`.
  The "was the failure the server's fault, not the model's?" question.
- `[KEY]` **"What tools were offered, and are the schemas good?"** — direct `tool_definitions`
  part (names only in the overview — F6). The MCP-server-quality question.
- **"How many tokens does the tool surface cost?"** — `g:summary`. Per-part token weight;
  the "trim the tool surface" optimization read.

## turn (`SSS.NT`)

Audience: judge (targeted drill), analysis (turn-scoped unit), developer.

- `[KEY]` **"What happened in this one request?"** — `g:full`. Whole-turn read; the unit
  for multi-turn sessions and the judge's "fetch a turn when the session view omits a detail".
- `[KEY]` **"Did it loop / how many rounds did it take?"** — `g:summary`. Round list +
  token counts; spot the runaway turn (cf. the N8GF 20-round spiral) before reading content.
- **"How costly was this turn vs another?"** — `g:summary`. Per-turn token comparison.

## round (`SSS.W.NT.N`)

Audience: analysis (evidence packets), developer.

- `[KEY]` **"What did the model do in this single iteration — reasoning + the call?"** —
  `g:full`. The analysis evidence packet; isolate one iteration.
- **"Which exact part do I drill for the result?"** — `g:summary`. Pinpoints the leaf.
- **"The iteration where the retry/error happened"** — isolate one round in a noisy turn.

## part (`SSS.W.NT.N.N-X`)  ·  *always full (F5)*

Audience: all — this is the evidence leaf.

- `[KEY]` **tool_call: "What were the exact arguments and the full result?"** — the single
  most important leaf. Tool-use scoring (judge) + "did the model have to work around the
  result shape?" (server quality).
- `[KEY]` **tool_call: "Is the result payload bloated / awkward?"** — result size + shape;
  the MCP-server-optimization read (ties to run report per-tool `result_payload_chars`).
- `[KEY]` **tool_definitions: "Is this tool's description/schema specific enough?"** — the
  only place with full schemas (F6). The server-recommendation read.
- **reasoning: "Why did it pick this tool / how did it read the result?"** — analysis +
  judge edge cases; reasoning is omitted from overviews, so this is a deliberate drill.
- `[KEY]` **diagnostic: "What exactly stopped this turn?"** — the failure reason
  (`-DN` part). Cheap, decisive for triage.
- **mcp_instructions: "Did the instructions mislead the model?"** · **assistant_answer:
  "exact final text"** (verify, don't over-trust) · **user_prompt: "exact ask"** (rarely
  standalone — already inlined upstream).

## step — compaction / workflow (`SSS.NW` / `SSS.CN`)

Audience: developer; (no dogfooding consumer today — F13).

- **"What did compaction remove, and why?"** — `g:full`. `stripped_parts` + per-part reason.
  Context-budget debugging.
- **"How much context did it reclaim?"** — `g:summary`. before/after/removed.
- `[KEY]` **"Why did this analysis/workflow step fail?"** — `latest_error` (kind + message).
  *Currently invisible in text — F8.* This is the cheapest high-value fix in the register.

## benchmark (`B-XXXX`)  ·  *summary == full (F5)*

Audience: authoring agent/developer, report agent.

- `[KEY]` **"What does this suite test — cases, prompts, rubrics?"** — the documentation
  read (the "document a benchmark" use-case). One fetch carries it all.
- **"Read the current cases before I add/edit one."** — the authoring pre-read.
- **"What runs exist and how did they do?"** — navigation to runs (today the run list is
  thin on outcome — could carry status/score for at-a-glance history).

## benchmark_case (`B-XXXX.N`)  ·  *summary == full (F5)*

Audience: authoring agent, report agent, (judge indirectly via inlined rubric).

- `[KEY]` **"What exactly is asked, what's the answer key (rubric), and the tool
  expectations?"** — the full case-spec read; documents/edits a case in one fetch.
- **"Where did this case come from?"** — `source_session_id` provenance.
- **"Is this case LLM-scored?"** — rubric-presence check.

## benchmark_run (`R-XXXX`)  ·  *real summary/full dial*

Audience: report agent, developer, compare.

- `[KEY]` **"Write the report for this run."** — `g:full`. The metrics report is the report
  backbone (per-case pass rates, token stats, per-session metrics).
- `[KEY]` **"Which tools are flaky or return bloated payloads?"** — `g:full`, per-tool
  rollup (`error_rate`, `result_payload_chars`). The MCP-server-improvement read.
- `[KEY]` **"Compare this run to another (different model / settings / MCP version)."** —
  `g:summary`. Needs config + IDs + status only — *currently bloated by the full rubric (F12)*.
- `[KEY]` **"Is the model/server reliable, or non-deterministic?"** — `g:full`, `pass_at_k`
  vs `pass_hat_k` + token stddev.
- **"Which repetitions failed and why?"** — `g:full`, per-session `terminal_status` + error
  → drill to the failed session.

## benchmark_evaluation (`E-XXXX`)  ·  *summary == full today (F5)*

Audience: report agent, developer; the eval **is** the judge's scored output.

- `[KEY]` **"What's the overall score, and is the pass even complete?"** — *should be*
  `g:summary` and cheap, but today the full grid is always computed (F5/F11). overall_pct +
  judged/expected + status.
- `[KEY]` **"Show the per-criterion scoring grid."** — `g:full`. Rubric × awarded points +
  the judge's ID-citing notes. The detailed-report read.
- `[KEY]` **"Compare judge models / passes on one run."** — overall_pct per pass (we now
  have two: kimi 50% vs Gemma 58.5%-but-incomplete). Judge-stability read.
- `[KEY]` **"Why did the judge give this low score?"** — `analysis_session_id` → inspect
  the judge session → follow its cited session/turn IDs. The audit chain.
- **"Did the judge itself fail?"** — status / incompleteness (the E-2BPM case).

---

## The shortlist — what to optimize for first

If we optimize payloads for just these, we cover the highest-value paths:

1. **session `g:summary`** as the cheap, legible **router** (token-efficient text) — every
   workflow starts here. [F3]
2. **session `g:full`** answering *correctness* + *tool-selection* in one fetch. [the judge's core]
3. **tool_call part** = the evidence atom (exact args + full result + payload size). [server + tool-use]
4. **run `g:full`** = the report backbone; **run `g:summary`** = the *lean* compare unit. [F12]
5. **A uniform "how did this end and why"** across session kinds + visible `latest_error`. [F8–F10]
6. **evaluation: a genuinely cheap summary** (score + completeness) vs the full grid. [F5/F11]

Each shortlist item maps to a finding in [`FINDINGS.md`](FINDINGS.md) — the use-cases are
the *why*, the findings are the *what to change*.
