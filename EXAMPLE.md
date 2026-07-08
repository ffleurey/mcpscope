# Worked example: change one thing, watch the metric move

This is mcpscope's core loop, end to end, on a real server and a real small model — copy-paste
ready. It answers the questions that decide whether an MCP server is any good: does the model
pick the right tool? do the tool descriptions earn their tokens? what does an answer actually
cost in context? And it shows the answers as **measurements you can re-run**, not impressions.

The target is the bundled **Open-Meteo Weather** companion — zero setup, no API key — and the
loop is:

> inspect one session → make it a repeatable benchmark → change one thing → re-run →
> the metric moves.

Everything below is driven from the CLI. Every command is also an MCP tool with the same name
(`mcpscope benchmark_run` ↔ `mcpscope_benchmark_run`), so a coding agent can run this whole page
— and everything both of you do lands in the same store, visible in the Web UI under the same
IDs. That is the point of the tool, and [the last section](#run-this-loop-with-your-coding-agent)
comes back to it.

The numbers shown are from a live run (Qwen 3.5 9B on LM Studio, 65k context). Yours will
differ; the *shape* of the result is what reproduces.

## Setup (once, ~2 minutes)

```bash
npm install -g mcpscope
mcpscope serve
```

In the Web UI that opens: **Configuration → add an LM connection** (LM Studio:
`http://localhost:1234/v1`, with the server started and a small model loaded), **add a model
config** for that model, and **set it as the default model**. No MCP profile is needed — the
companion is built in. Details: [TUTORIAL.md](TUTORIAL.md).

## Step 1 — Watch the model work, part by part

Create a session on the companion (built-ins are selected per session, never defaults):

```bash
mcpscope create "weather-example" --mcp-profile builtin-open-meteo --wait
# → DHQD  weather-example        (your ID will differ — use it below; --wait returns it ready)
mcpscope send DHQD "What's the weather in Paris this week?" --wait
mcpscope inspect DHQD.1T
```

(No default model set yet? Add `--model-config <id>` — `mcpscope list_model_configs` lists the
ids and marks the default. The same flag works on `benchmark_run` below.)

What comes back (abridged):

```text
DHQD.1T  turn  complete  3 rounds  (2866 tokens)
DHQD.1T.1.1-U  user_prompt  (19 tokens)
DHQD.1T.1.2-R  reasoning  (78 tokens - stripped)
DHQD.1T.1.3-T  tool_call  geocode_place  (539 tokens)
  {"name":"Paris","count":5}
DHQD.1T.2.1-T  tool_call  get_forecast  (915 tokens)
  {"latitude":48.85341,"longitude":2.3488,"days":7}
DHQD.1T.3.1-A  assistant_answer  (358 tokens)
  Here is the weather forecast for Paris for the coming week: …
```

Three things are now facts instead of guesses:

- **The model chained tools correctly** — it resolved "Paris" with `geocode_place` before
  calling `get_forecast`. You can see the exact arguments it chose.
- **Every part has a token price.** The forecast payload (915) costs more than the model's
  entire answer (358). `mcpscope inspect DHQD.S` shows the standing cost too: the four tool
  definitions alone are ~1,000 tokens of every single turn.
- **Context management is visible**: the reasoning part was stripped by the session's
  compaction step after the turn (`DHQD.2C` in the full `mcpscope inspect DHQD`).

The same trace, with a color-coded context bar per turn, is in the Web UI — click through to
session `DHQD`.

## Step 2 — Turn it into a benchmark you can re-run

One session is an anecdote. A benchmark makes it evidence: the same prompts, run N times,
with deterministic checks per case. Note the third command — a **probe case** that *forbids*
the plausible-but-wrong tool, which is how tool-confusion shows up as a number instead of a
vibe. Rubrics are added now, **before running** — a run snapshots its cases (rubric included),
and the judge in step 4 reads that snapshot:

```bash
mcpscope benchmark_create "open-meteo-weather"      # → B-F7VM
mcpscope benchmark_add_case B-F7VM "What's the forecast for Paris tomorrow?" \
  --name forecast-brief --expect-tool get_forecast                       # → B-F7VM.1
mcpscope benchmark_add_case B-F7VM "How did the temperature in Paris change over the last 7 days?" \
  --name historical-vs-forecast --expect-tool get_historical_weather --forbid-tool get_forecast
mcpscope benchmark_add_case B-F7VM "Is it raining in Oslo right now?" \
  --name current-conditions --expect-tool get_current_weather
mcpscope benchmark_update_case B-F7VM.2 --rubric-json \
  '[{"id":1,"description":"Describes how the temperature actually changed over the past 7 days with concrete values (not a forecast)","points":3},
    {"id":2,"description":"Answer is concise and directly addresses the question","points":2}]'

mcpscope benchmark_run B-F7VM --repetitions 3 --mcp-profile builtin-open-meteo --wait   # → R-2A75
mcpscope benchmark_run_report R-2A75
```

The report (abridged):

```text
Per-tool rollup
  TOOL                           CALLS  ERRORS    ERR%  CASES
  geocode_place                      9       0      0%      3
  get_forecast                       3       0      0%      1
  get_historical_weather             3       0      0%      1
  …

Cases (3)
  B-F7VM.1  forecast-brief          success 100%  pass@k yes  pass^k yes  (3/3)
      total tokens  min 1975  mean 1989.7  max 1999
  B-F7VM.2  historical-vs-forecast  success 100%  pass@k yes  pass^k yes  (3/3)
      total tokens  min 3062  mean 3470  max 4092
  B-F7VM.3  current-conditions      success 100%  pass@k yes  pass^k yes  (3/3)
      total tokens  min 1938  mean 1939  max 1941
```

How to read it:

- **pass@k / pass^k** — did any repetition pass, did *all* of them. For tool use on small
  models, `pass^k` is the honest number; a case that only sometimes picks the right tool is a
  case you can't ship.
- Qwen 3.5 9B passes the confusion probe cleanly here. A weaker model — or a weaker
  *description* — shows up as `get_forecast` calls on case 2 and a red `pass^k: no`. When you
  point mcpscope at your own server, these probe cases are where your tool-description work
  pays off or doesn't.
- The token columns already tell a story: the historical case costs ~75% more than the others
  *and* has 30% spread between repetitions — worth an `inspect` to see why.

## Step 3 — Change one thing, run it again

`get_forecast` has a `response_format` parameter: `concise` (daily summary) or `detailed`
(adds the hour-by-hour series). Its description tells the model when detail is worth the
tokens. So change **the prompt only** — ask for hour-by-hour — and re-run just that case:

```bash
mcpscope benchmark_update_case B-F7VM.1 --prompt "Give me the hour-by-hour forecast for Paris tomorrow."
mcpscope benchmark_run B-F7VM --case B-F7VM.1 --repetitions 3 --mcp-profile builtin-open-meteo --wait   # → R-9QAU
mcpscope benchmark_run_report R-9QAU
```

Side by side:

| | run R-2A75 (concise) | run R-9QAU (detailed) |
|---|---|---|
| prompt | "What's the forecast for Paris tomorrow?" | "Give me the hour-by-hour forecast…" |
| `get_forecast` call the model made | `{"days":1,"response_format":"concise"}` ≈ **333 tokens** | `{"days":1,"response_format":"detailed"}` ≈ **1,944 tokens** |
| case total tokens (mean) | **1,990** | **3,933** |
| pass@k / pass^k | yes / yes | yes / yes |

One prompt change, and the model itself flipped `response_format` — you can verify with
`mcpscope inspect` on any session from the second run and read the tool-call arguments. Same
question shape, roughly **2× the context cost**. On an 8k-context model, that difference decides
whether a multi-turn conversation fits at all. This is the whole argument for token-aware tool
design: `response_format`-style switches let the *question* decide what detail costs, and the
benchmark turns that design decision into a measured, repeatable number.

Two mechanics worth noticing:

- Each run is an **immutable snapshot** — `benchmark_run_report R-2A75` still shows the old
  prompt and old numbers. Editing the suite never rewrites your history; comparisons stay valid.
- `--case` re-runs a subset; the rest of the suite doesn't burn time or tokens.

## Step 4 (optional) — Score answer quality with a judge model

Deterministic checks say the right tools were called; they don't say the *answer* was good.
For that, a **separate judge model** scores each session against the per-case rubric you
authored in step 2. Evaluate the full-suite run from step 2 (`R-2A75` above — the rubric lives
in that run's snapshot, which is why step 2 authored it before running). Only sessions whose
case has a rubric are judged; the others are **skipped, not failed**. We used Gemma 4 12B to
judge Qwen's answers:

```bash
mcpscope benchmark_evaluate R-2A75 --judge-model gemma-4-12b-qat   # → E-5K4P
mcpscope benchmark_run_evaluations R-2A75                          # poll until complete
```

```text
E-5K4P  complete  judge gemma-4-12b-qat  overall 80%
  skipped  6 session(s) — their case has no rubric
  historical-vs-forecast                    min 40%  mean 80%  max 100%
```

That **min 40%** is the judge earning its keep: the deterministic scorecard shows this case
100% green (right tools, no protocol errors), but in one repetition the model queried dates the
upstream API rejected and answered with an apology — an *in-band* upstream error that, by
design, doesn't count as a tool error (see [BENCHMARK.md](BENCHMARK.md)). Only the judge caught
it. Each judged session is itself inspectable, and the judge *pulls its own evidence* — it reads
the target trace through `mcpscope_inspect` tool calls and cites part IDs in its verdict:

```text
ELBE.2W.1T.2.1-T  tool_call  mcpscope_inspect  {"id":"6LK9.1T.2.1-T"}
ELBE.2W.1T.3.1-A  assistant_answer
  { "criteria": [
      { "id": 1, "points": 3, "note": "…describes how the temperature changed … with concrete
        values (e.g., Oct 27: High of 15°C / Low of 9.7°C) as seen in 6LK9.1T.3.2-A." },
      { "id": 2, "points": 2, "note": "…concise and directly addresses the question…" } ],
    "comment": "…clear, data-driven response with a day-by-day breakdown…" }
```

Run it again with a different judge or temperature; evaluation passes accumulate side by side
on the same run. Rubric every case if you want full coverage — a run with no rubric'd case at
all is refused up front (`benchmark_no_rubric`).

## Run this loop with your coding agent

Every command above is an MCP tool on `http://localhost:3066/mcp`. An agent iterating on your
MCP server runs the identical loop:

```jsonc
mcpscope_create               { "title": "weather", "mcp_profile_ids": ["builtin-open-meteo"], "wait": true }
mcpscope_send                 { "session_id": "DHQD", "prompt": "…", "wait": true }
mcpscope_benchmark_run        { "benchmark_id": "B-F7VM", "repetitions": 3, "mcp_profile_ids": ["builtin-open-meteo"] }
mcpscope_benchmark_run_report { "run_id": "R-9QAU" }
```

…while you watch the same runs, the same sessions, the same IDs in the Web UI. The agent does
the sweeps; you read the one trace that looks wrong, fix a description or a rubric, and say
"run it again." IDs like `B-F7VM.2` and `DHQD.1T.2.1-T` are the shared language — precise
enough for an agent, readable enough for a human. That tight loop, with both of you in it, is
what turns an average benchmark score into a good MCP server.

## Point it at your own server

```bash
# after adding your MCP profile in the UI (Configuration → MCP Server Profiles)
mcpscope create "my-server-eval" --mcp-profile my-server --wait
mcpscope benchmark_run B-YYYY --mcp-profile my-server --repetitions 5 --wait
```

Start with 3–5 prompts your server must handle, one probe case per plausible confusion, a
rubric on the case where answer quality matters most — then change one thing at a time and
watch the numbers. More depth: [BENCHMARK.md](BENCHMARK.md) (metrics, rubric authoring, judge
details), [COMPANIONS.md](COMPANIONS.md) (the other bundled servers), [MCP.md](MCP.md) (the
agent-facing surface).
