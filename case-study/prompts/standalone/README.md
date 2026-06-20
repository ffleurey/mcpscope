# Standalone Benchmark Prompts

This folder contains an initial standalone benchmark set derived from the manual transcript prompts
captured before mcpscope was introduced.

## Selection rules

- one prompt per file
- standalone only, so each prompt can run in a fresh session
- selected from the manual prompt inventory in
  `evaluation/archive/prompt-sources/manual-test-prompts.md`
- chosen to cover a mix of simple, composite, discovery-heavy, and behavior-inference tasks

## Prompt set

- `01-list-temperature-entities.txt`
  - entity discovery / inventory
- `02-outdoor-april-low.txt`
  - simple historical scalar statistic
- `03-olivia-min-max-30d.txt`
  - bedroom diagnostics, simple two-call analysis
- `04-olivia-heating-composite.txt`
  - multi-part composite heating benchmark
- `05-ev-charging-sessions-30d.txt`
  - monthly EV charging overview with per-session table, kWh, and peak power
- `06-freezing-days-feb-march.txt`
  - filtered day-bucket weather analysis
- `07-bedtime-last-10-days.txt`
  - motion-based bedtime inference
- `08-leave-home-tellu-2-weeks.txt`
  - routine inference from person/location history

## Why this set

This first set intentionally excludes follow-up-dependent prompts such as:

- `Thanks, what about in march?`
- `Was the car charged last night?`
- `Yes, good to have both peak power and the total energy in kWh`

Those are useful later for a multi-turn benchmark, but they are not suitable for the first
single-prompt-session benchmark harness.

## Intended usage

Each file is plain text so a runner can load it and send it directly to mcpscope in a fresh
session.

Example future harness behavior:

1. enumerate `evaluation/prompts/standalone/*.txt`
2. create a fresh session per file
3. send the file contents as the user prompt
4. collect answer, trace, and metrics

## Current runner

The first standalone batch runner is:

- `bash evaluation/scripts/run-standalone-benchmark.sh`

Default behavior:

- runs every `evaluation/prompts/standalone/*.txt` prompt
- creates a fresh mcpscope session for every run
- executes each prompt `6` times by default
- stores artifacts under `evaluation/results/raw/benchmark-runs/<timestamp>/`

Useful environment overrides:

- `MCPSCOPE_RUNS_PER_PROMPT=3`
- `MCPSCOPE_BENCHMARK_DIR=evaluation/prompts/standalone`
- `MCPSCOPE_BENCHMARK_OUTPUT_DIR=evaluation/results/raw/my-run`