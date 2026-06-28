# Inspect payload tuning — investigation workspace

> Backlog task: [`tuning-of-inspect-payload.md`](../../tuning-of-inspect-payload.md)

`inspect` is the single most important read surface in mcpscope. The same operation
([`backend/src/operations/inspect.ts`](../../../backend/src/operations/inspect.ts))
backs the CLI (`mcpscope inspect`), the MCP tool (`mcpscope_inspect`), and the UI id-pill,
so **the quality of these payloads is the quality of the product** for any agent or
developer working through the trace. This folder holds the systematic baseline that drove
the tuning: for every inspectable object type, the `summary` and `full` payloads and the
use-cases each granularity serves.

This folder began as a documentation / analysis pass to make the behaviour legible, then
drove **two phases of implementation**. The captured baseline and the cross-cutting findings
below are the *original* investigation (kept as the rationale); the current shipped state is:

- **[`phase-2-pass.md`](phase-2-pass.md)** — the per-type content proposal + the assessed
  good-start + the remaining (defaulted, low-risk) design questions for review. **Start here.**
- **[`phase-2-usecase-trials.md`](phase-2-usecase-trials.md)** — the use-cases (UC‑1…7) actually
  *performed* on real runs/sessions, judging each payload's information fit.
- **[`FINDINGS.md`](FINDINGS.md)** — the tracked register F1–F16 with each finding's outcome.

> **Cross-cutting research notes & specs** live alongside the per-type folders:
> - [`formats.md`](formats.md) — text vs JSON, content parity, and **measured token
>   efficiency** (JSON costs **2.8–3.1×** the tokens of text for tree/overview payloads).
> - [`use-cases.md`](use-cases.md) — the workflow-level investigation goals (analyse a
>   session, write/compare run reports, document a case…) mapped to **fetch paths** under
>   the "gradual exploration" principle. Distilled token measurements:
>   [`_measurements/token-efficiency.tsv`](_measurements/token-efficiency.tsv).
> - [`use-cases-by-type.md`](use-cases-by-type.md) — the **micro** use-case catalogue:
>   per type, who asks what, with the key ones to optimize for flagged.
> - [`gui-navigator-spec.md`](gui-navigator-spec.md) — the GUI inspect-dialog **navigator**
>   spec (browser-like history, clickable ids); the locked decisions and deferred items.
> - [`serialization-architecture.md`](serialization-architecture.md) — the implementation
>   pattern (per-type serializer + single text renderer derived from the JSON payload) that
>   makes text/JSON equivalent **by construction**.

## How this folder is organised

One folder per inspectable object type. Each folder has:

- a **`README.md`** — what the object is, the use-cases for inspecting it, and
  summary-vs-full guidance, grounded in the project docs and source (file:line cited);
- one or more **`example-*.md`** files — the real captured payloads, in both modes, as
  readable text.

| Folder | ID form | Object |
|---|---|---|
| [`session/`](session/) | `SSS` | a full runtime trace (one conversation / analysis run) |
| [`setup/`](setup/) | `SSS.S` | session prelude (system prompt, mcp instructions, tool defs) |
| [`turn/`](turn/) | `SSS.NT` | one user-request → response lifecycle |
| [`round/`](round/) | `SSS.W.NT.N` | one model/tool iteration inside a turn |
| [`part/`](part/) | `SSS.W.NT.N.N-X` | one content node (prompt, reasoning, tool call, answer, …) |
| [`step/`](step/) | `SSS.NW` / `SSS.CN` | a deterministic step (shipped case: compaction) |
| [`benchmark/`](benchmark/) | `B-XXXX` | a benchmark suite blueprint |
| [`benchmark-case/`](benchmark-case/) | `B-XXXX.N` | one case (prompt + tool checks + rubric) |
| [`benchmark-run/`](benchmark-run/) | `R-XXXX` | one immutable run of a suite |
| [`benchmark-evaluation/`](benchmark-evaluation/) | `E-XXXX` | one LLM-judge scoring pass over a run |
| [`errors/`](errors/) | (cross-cutting) | failed sessions, judge errors, incomplete evaluations — the non-success scenarios |

## How the examples were captured

The per-type `example-*.md` files were **re-captured from the rebuilt backend** (Phase 2,
2026-06-28) so they reflect the shipped payloads. Rendering is now a **backend domain feature**
(`backend/src/inspect/renderInspect.ts`) consumed identically by the CLI, the MCP tool, and the
API — text is the default; `format: json` returns the structural payload (no longer CLI-only).

The canonical single-turn example is session **`9LJM`** (benchmark run `R-RZNP`, Gemma 4 12B QAT
on `ha-replay`). Phase 2 added multi-turn (`2ZHT` clean, `RH8P` mid-stream error) and
analysis/judge (`ZTJE`) session examples, and a 2nd run (`R-AW4J`, Gemma 4 E4B) for the run
comparison trial. The distilled token-efficiency numbers (Phase-1 measurement) are in
[`_measurements/token-efficiency.tsv`](_measurements/token-efficiency.tsv).

---

## The themes (original baseline → outcome)

These were the cross-cutting findings from the baseline capture. The full register with
per-finding evidence and **current outcome** is [`FINDINGS.md`](FINDINGS.md) (F1–F16); the
shipped design is [`phase-2-pass.md`](phase-2-pass.md). In brief:

- **Format & efficiency** — MCP returned JSON only (no readable text), double-encoded
  (`content` + `structuredContent`), and JSON costs **2.79–3.10×** the tokens of text for
  tree/overview payloads ([`formats.md`](formats.md)). *Shipped:* one backend renderer,
  `format: text|json` (text default), single channel. (F1–F3, F15, F16)
- **Granularity** — `summary`/`full` was a real dial only for runtime containers + `R-`;
  inert for parts, `B-`, `B-.N`, `E-`. *Shipped:* genuine `B-`/`E-` splits; `B-.N` + parts
  are leaves by decision. (F5, F12)
- **Reachability** — tool schemas, tool results, and reasoning are not inlined in overviews
  (by design, to keep them lean); the part **ID + token weight** are the drill signal.
  (F6, F7)
- **Error inspection** (the weakest surface) — failures were invisible or inconsistent in
  text. *Shipped:* uniform top-level `terminal_status` + failure summary across all session
  kinds, `latest_error` rendered, eval `incomplete` flag. (F8–F11)
- **Dog-fooding** drives the requirements: the **analysis workflow** pre-injects inspect
  results (deterministic); the **benchmark judge** is given only a session ID and pulls on
  demand (`injectEvidence:false`) — the canonical "summary → drill" consumer and the
  sharpest tuning lens. (See [`use-cases-by-type.md`](use-cases-by-type.md) for the
  audiences.)

---

## Status — Phase 1 + Phase 2 complete

The full hand-over (branch, commits, doc map) is in the task file:
[`../../tuning-of-inspect-payload.md`](../../tuning-of-inspect-payload.md).

- [x] Folder structure + captured baseline payloads (this folder)
- [x] Use-case READMEs per type; workflow [`use-cases.md`](use-cases.md) + micro
      [`use-cases-by-type.md`](use-cases-by-type.md)
- [x] Cross-cutting findings catalogue + tracked register [`FINDINGS.md`](FINDINGS.md) (F1–F16)
- [x] Format & token-efficiency research ([`formats.md`](formats.md)) and the implementation
      pattern ([`serialization-architecture.md`](serialization-architecture.md))
- [x] **Phase 1 implemented** — backend render module + `format` param (text default), benchmark
      `B-`/`R-`/`E-` redesign, coverage test, GUI inspect **navigator**
      ([`gui-navigator-spec.md`](gui-navigator-spec.md)). Resolves F1, F2, F3, F4 (safe dir),
      F5/F12 (benchmark types), F8, F11, F15, F16.
- [x] **Phase 2 — content critique** ([`phase-2-pass.md`](phase-2-pass.md)): uniform session
      `terminal_status` + failure summary (F9/F10), `B-` summary/full split (F5), slimmer JSON
      (F4), cross-payload model-name consistency, per-turn cost, owned-turn rendering for
      analysis sessions, chronological child ordering, and run-summary `overall_pct` for run
      comparison. F6/F7/F13/F14 resolved or decided. Examples refreshed from the rebuilt backend.
- [x] **Phase 2 — use-case trials** ([`phase-2-usecase-trials.md`](phase-2-usecase-trials.md)):
      UC‑1…7 performed on real runs/sessions (incl. a 2nd local-model run for run comparison).

**Open for review (not blocking):** the defaulted design questions in
[`phase-2-pass.md`](phase-2-pass.md) §"Open design questions".
