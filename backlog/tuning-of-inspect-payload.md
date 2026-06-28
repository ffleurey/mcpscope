One of the most important feature of mcpscope is the inspect tool which gives full CLI and MCP coverage to inspect efficiently and with as many details as required all the parts of sessions and now also benchmarks, runs and llm evaluations.

mcpscope is only as good as the quality of the inspect payloads it offers in order to have agent (and developers) able to work efficiently with it.

We had a pass early in the mcpscope development to tune the session and parts payloads for primary sessions and their child nodes but sinec then we have not put too much effort in tuning those inspect payloads. 

In our inspect tool, we want to support all types of mcpscope object and for each type of object we have the option of defining 2 granularity the summary and full.

I would like us to systematically capture inspect payload (in text, not JSON to help readability) which we can review. For each different type of type of object we inspect we are going to review the exact information provided in each of the 2 modes and we are going to define the use-cases for those payloads. ie. when reviwing a benchmark run in sumarey we might be comparing runs and making a report that compares run to run. If we inspect a run in full, we are probably making a report for that specific run and need to have more details. Etc.

The fist step of this task is to make a documentation structure which we are going to use to decide on any changes or act leasty evaluate what we have today. We need to make a folder for each type of object we can inspect and in this folder put a few md files with the output of inspect payloads for a few example and then a README file in which we define the usecases we see for inspecting this type of object.

To figure out the usecases we will need to review our documentation broadly, including our research folder, user documentation and potentially completed tasks which probably include a lot of thinking and discussion on the different scenario for inspection.

An important aspect is the bootstraped / eating our own dogfood where we are heavily using the mcp tools ourselves for llm evaluation, analysis sessions, etc. These are important use-cases.

This is a tasks taht reaquires a lot of exploration and heavy systematic work before we start actually looking at what changes we want to make.

---

## Progress so far (2026-06-28) — committed, not finished

### Research & specification — `backlog/research/inspect-payloads/`
- Captured the real `summary` and `full` inspect payloads for **every object type** (session, setup, turn, round, part subtypes, deterministic/compaction step, benchmark, case, run, evaluation), plus **error/non-success** scenarios (failed sessions, judge `json_parse_error`, incomplete evaluation, the `diagnostic` part).
- Per-type READMEs of use-cases; a workflow-level `use-cases.md`; a micro `use-cases-by-type.md`; `formats.md` with **measured token efficiency** (JSON costs ~2.8–3.1× text on tree/overview payloads); a consolidated findings register **`FINDINGS.md` (F1–F16)**; and `serialization-architecture.md` (the agreed implementation pattern).

### Implementation — Phase 1 refactor (structure + benchmark redesign)
- **Backend render module** (`backend/src/inspect/renderInspect.ts`): one source-of-truth renderer; `format: text | json`; text is derived **only** from the JSON payload (text ⊆ json by construction); the step `latest_error` is now shown (F8).
- **`format` param** plumbed through the inspect operation, `/api/lookup`, and MCP — **text by default**, no `structuredContent` double-encode (F15). Rendering is now a backend domain feature; the **CLI is a thin printer** (its local renderers deleted). Fixes F1/F2/F4(safe direction)/F8/F16.
- **Benchmark `B-`/`R-`/`E-` payloads redesigned** to be drill-oriented (status + drillable session lists with metrics; `B-` carries no results; `E-` has a lean summary + incomplete flag). Sessions/parts and `B-.N` kept as reference.
- **Coverage test + omission allow-list** enforce json ⊆ text minus a reviewed allow-list (F4 seed). All backend tests green.

### GUI
- The ID-pill menu (Copy ID / Summary / Full) now opens a **consolidated Inspect dialog** (the GUI equivalent of the inspect tool) with **detail (summary/full)** and **format (text/json)** toggles, a fixed size that doesn't resize on change, and a single scrolling content region.
- New reusable **`SegmentedControl.svelte`** (amber active-state) added to the **design system** (DesignReference + DESIGN-SYSTEM.md); `DialogShell` gained `fixedHeight` / `flush` props.

### Still to do (next)
- **Phase 2 content critique** of the remaining payloads against the use-cases: runtime findings **F6, F7, F9, F10, F13**, per-type allow-list contents, and whether the F4 plumbing fields belong in the JSON at all.
- GUI JSON **syntax highlighting** (deferred), and an optional pill action to **navigate to the GUI view** for an element.
- Live end-to-end verification once the backend is rebuilt/restarted.
