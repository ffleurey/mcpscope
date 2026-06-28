import type { InspectResult } from "../operations/inspect.js";

// ─────────────────────────────────────────────────────────────────────────────
// Backend-owned rendering of inspect payloads. This is a core domain feature:
// the same payload renders to `json` (structural) or `text` (human/LLM friendly),
// and every surface (CLI, MCP, API) consumes it from here — no surface renders
// locally. The text renderer takes ONLY the inspect payload (the JSON `data`) as
// input, never a domain record, so text can never assert more than the JSON
// (text ⊆ json by construction). See backlog/research/inspect-payloads/.
// ─────────────────────────────────────────────────────────────────────────────

export type InspectFormat = "text" | "json";

type AnyRecord = Record<string, unknown>;
type Emit = (line: string) => void;

export function renderInspect(
  result: InspectResult,
  format: InspectFormat,
): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  return renderText(result);
}

function renderText(result: InspectResult): string {
  const lines: string[] = [];
  const out: Emit = (line) => lines.push(line);
  const d = result.data as AnyRecord;

  switch (result.type) {
    case "session":
      renderSessionText(d, out);
      break;
    case "turn":
      renderTurnParts(d, out);
      break;
    case "step":
      renderGenericStep(d, out);
      break;
    case "round":
      renderRoundText(d, out);
      break;
    case "setup":
      renderSetupText(d, out);
      break;
    case "part":
      renderPart(d, "", out);
      break;
    case "benchmark":
      renderBenchmarkText(d, out);
      break;
    case "benchmark_case":
      renderBenchmarkCaseText(d, out);
      break;
    case "benchmark_run":
      renderBenchmarkRunText(d, out);
      break;
    case "benchmark_evaluation":
      renderBenchmarkEvaluationText(d, out);
      break;
    default:
      // Unknown type: fall back to structural JSON so callers still get a
      // complete, lossless payload rather than nothing.
      return JSON.stringify(result, null, 2);
  }
  return lines.join("\n");
}

// ─── Benchmark family ─────────────────────────────────────────────────────────

function arr(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? (value as AnyRecord[]) : [];
}

function renderBenchmarkText(data: AnyRecord, out: Emit): void {
  const b = (data["benchmark"] as AnyRecord) ?? {};
  out(`${String(b["id"] ?? "")}  ${b["name"] ?? ""}`);
  if (b["description"]) out(`  ${b["description"]}`);

  const cases = arr(data["cases"]);
  if (cases.length > 0) {
    out("");
    out(`cases (${cases.length})`);
    for (const c of cases) {
      const crit = c["rubric_criteria_count"];
      const critStr = crit != null ? `  [${crit} criteria]` : "";
      out(`  ${c["id"]}  ${c["name"] ?? ""}${critStr}`);
      if (c["prompt"]) out(`    ${truncate(String(c["prompt"]), 100)}`);
    }
  }

  const runs = arr(data["runs"]);
  if (runs.length > 0) {
    out("");
    out(`runs (${runs.length})`);
    for (const r of runs) {
      const total = r["total_sessions"];
      const completed = r["completed_sessions"];
      const failed = Number(r["failed_sessions"] ?? 0);
      const sessionStr =
        total != null ? `  ${completed}/${total} sessions` : "";
      const failStr = failed > 0 ? ` (${failed} failed)` : "";
      const evalIds = (r["evaluation_ids"] as string[] | undefined) ?? [];
      const evalStr = evalIds.length > 0 ? `  evals: ${evalIds.join(", ")}` : "";
      out(`  ${r["id"]}  ${r["status"]}${sessionStr}${failStr}${evalStr}`);
    }
  }
}

function renderBenchmarkCaseText(data: AnyRecord, out: Emit): void {
  out(`${String(data["id"] ?? "")}  ${data["name"] ?? ""}`);
  const calls = (data["expected_tools_called"] as string[] | undefined) ?? [];
  const notCalls =
    (data["expected_tools_not_called"] as string[] | undefined) ?? [];
  if (calls.length > 0) out(`  expects called      ${calls.join(", ")}`);
  if (notCalls.length > 0) out(`  expects not called  ${notCalls.join(", ")}`);
  if (data["source_session_id"])
    out(`  from session        ${data["source_session_id"]}`);
  out("");
  out("prompt");
  renderTextBlock(String(data["prompt"] ?? ""), "  ", out);

  const rubric = arr(data["rubric"]);
  if (rubric.length > 0) {
    out("");
    out("rubric");
    for (const cr of rubric) {
      out(`  [${cr["points"]} pts] (#${cr["id"]}) ${cr["description"] ?? ""}`);
    }
  }
}

function renderRunHeader(run: AnyRecord, out: Emit): void {
  out(`${String(run["id"] ?? "")}  ${run["benchmark_name"] ?? ""}  ${run["status"] ?? ""}`);
  if (run["model_config_id"]) out(`  model       ${run["model_config_id"]}`);
  const profiles = (run["mcp_profile_ids"] as string[] | undefined) ?? [];
  if (profiles.length > 0) out(`  mcp         ${profiles.join(", ")}`);
  if (run["repetitions"] != null)
    out(`  reps        ${run["repetitions"]}  max tool rounds ${run["max_tool_rounds"] ?? "?"}`);
  if (run["error"]) out(`  error       ${run["error"]}`);
}

function renderBenchmarkRunText(data: AnyRecord, out: Emit): void {
  const run = (data["run"] as AnyRecord) ?? {};
  renderRunHeader(run, out);

  const progress = (data["progress"] as AnyRecord) ?? {};
  if (progress["total_sessions"] != null) {
    const failed = Number(progress["failed_sessions"] ?? 0);
    out(
      `  progress    ${progress["completed_sessions"]}/${progress["total_sessions"]} sessions` +
        (failed > 0 ? `, ${failed} failed` : ""),
    );
    for (const pc of arr(progress["per_case"])) {
      out(`    ${pc["source_case_id"]} ${pc["name"] ?? ""}: ${pc["completed"]}/${pc["total"]}`);
    }
  }

  const evals = arr(data["evaluations"]);
  if (evals.length > 0) {
    out("");
    out("evaluations");
    for (const e of evals) {
      out(
        `  ${e["id"]}  ${e["status"]}  judged ${e["judged_sessions"]}/${e["expected_sessions"]}  judge ${e["judge_model_config_id"]}`,
      );
    }
  }

  const perCase = arr(data["per_case"]);
  if (perCase.length > 0) {
    out("");
    out("per case");
    for (const c of perCase) {
      const sr =
        c["success_rate"] != null
          ? `${Math.round(Number(c["success_rate"]) * 100)}%`
          : "—";
      out(
        `  ${c["case_id"]}  pass ${fmtNum(c["pass_count"])}/${c["session_count"]} (${sr})  pass@k ${fmtNum(c["pass_at_k"])}  pass^k ${fmtNum(c["pass_hat_k"])}`,
      );
    }
  }

  const perTool = (data["per_tool"] as AnyRecord) ?? {};
  const toolNames = Object.keys(perTool);
  if (toolNames.length > 0) {
    out("");
    out("per tool");
    for (const name of toolNames) {
      const t = perTool[name] as AnyRecord;
      out(
        `  ${name}  ${t["calls"]} calls, ${t["errors"]} errors (${Math.round(Number(t["error_rate"] ?? 0) * 100)}%), ${t["result_payload_chars"]} chars`,
      );
    }
  }

  const sessions = arr(data["sessions"]);
  if (sessions.length > 0) {
    out("");
    out(`sessions (${sessions.length})`);
    for (const s of sessions) {
      const where = `${s["source_case_id"]} rep ${s["repetition"]}`;
      let metrics = "";
      if (s["tool_call_count"] != null) {
        const err = Number(s["tool_error_count"] ?? 0);
        metrics =
          `  ${s["tool_call_count"]} calls` +
          (err > 0 ? `, ${err} err` : "") +
          (s["total_tokens"] != null ? `, ${s["total_tokens"]} tok` : "");
      }
      out(`  ${s["session_id"]}  ${where}  ${s["status"]}${metrics}`);
    }
  }
}

function renderBenchmarkEvaluationText(data: AnyRecord, out: Emit): void {
  const ev = (data["evaluation"] as AnyRecord) ?? {};
  const overall =
    ev["overall_pct"] != null
      ? `  overall ${Math.round(Number(ev["overall_pct"]) * 100)}%`
      : "";
  out(`${String(ev["id"] ?? "")}  evaluation of ${ev["run_id"] ?? ""}  ${ev["status"] ?? ""}${overall}`);
  out(`  judge       ${ev["judge_model_config_id"] ?? ""}`);
  const incomplete = ev["incomplete"] ? "  ⚠ incomplete" : "";
  out(`  judged      ${ev["judged_sessions"]}/${ev["expected_sessions"]}${incomplete}`);
  if (ev["error"]) out(`  error       ${ev["error"]}`);

  const perCase = arr(data["per_case"]);
  if (perCase.length > 0) {
    out("");
    out("per case");
    for (const c of perCase) {
      const stats = (c["pct_stats"] as AnyRecord) ?? {};
      const mean = stats["mean"] != null ? `mean ${Math.round(Number(stats["mean"]) * 100)}%` : "—";
      out(`  ${c["source_case_id"]}  ${c["name"] ?? ""}  ${mean}`);
    }
  }

  const sessions = arr(data["sessions"]);
  if (sessions.length > 0) {
    out("");
    out(`sessions (${sessions.length})`);
    for (const s of sessions) {
      const pct =
        s["pct"] != null ? `  ${Math.round(Number(s["pct"]) * 100)}%` : "";
      out(
        `  ${s["analysis_session_id"]}  judges ${s["run_session_id"]}  ${s["source_case_id"]}  ${s["status"]}${pct}`,
      );
      const criteria = arr(s["criteria"]);
      for (const cr of criteria) {
        const note = cr["note"] ? `  — ${truncate(String(cr["note"]), 80)}` : "";
        out(`    [${cr["points"]}/${cr["max"]}] (#${cr["id"]}) ${cr["description"] ?? ""}${note}`);
      }
    }
  }
}

function fmtNum(value: unknown): string {
  if (value == null) return "—";
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ─── Token annotation ─────────────────────────────────────────────────────────

function tokens(
  count: number | null | undefined,
  state: string | undefined,
): string {
  if (count == null) return "";
  const suffix = state && state !== "included" ? ` - ${state}` : "";
  return `  (${count} tokens${suffix})`;
}

// ─── Part ─────────────────────────────────────────────────────────────────────

function renderPartLine(part: AnyRecord, indent: string, out: Emit): void {
  const id = String(part["id"] ?? "");
  const type = String(part["type"] ?? "");
  const toolName = part["tool_name"] ? `  ${part["tool_name"]}` : "";
  // tool_definitions in a container view list names only; show the count so the
  // tool surface is legible and the part is visibly drillable for full schemas (F6).
  const toolsList = part["tools"] as string[] | undefined;
  const toolCount = Array.isArray(toolsList) ? `  ${toolsList.length} tools` : "";
  const state = String(part["context_state"] ?? "");
  const count = part["token_count"] != null ? Number(part["token_count"]) : null;
  out(`${indent}${id}  ${type}${toolName}${toolCount}${tokens(count, state)}`);
}

function renderTextBlock(text: string, indent: string, out: Emit): void {
  for (const line of text.split("\n")) out(`${indent}${line}`);
}

function renderPartContent(part: AnyRecord, indent: string, out: Emit): void {
  const content = part["content"] as AnyRecord | undefined;
  if (content) {
    if (typeof content["text"] === "string") {
      renderTextBlock(content["text"], indent, out);
    } else if (Array.isArray(content["json"])) {
      renderTextBlock(JSON.stringify(content["json"], null, 2), indent, out);
    }
  }

  // tool_definitions: render tool names as comma-separated list
  const toolsList = part["tools"] as string[] | undefined;
  if (toolsList && toolsList.length > 0) {
    out(`${indent}${toolsList.join(", ")}`);
  }

  // tool_call parameters in nested (session/turn) views — compact one-liner
  const toolArguments = part["tool_arguments"];
  if (toolArguments !== undefined && part["tool_payload"] === undefined) {
    out(`${indent}${JSON.stringify(toolArguments)}`);
  }

  const toolPayload = part["tool_payload"] as AnyRecord | undefined;
  if (toolPayload) {
    const call = toolPayload["call"];
    const result = toolPayload["result"] as AnyRecord | undefined;
    out(`${indent}call  ${JSON.stringify(call)}`);
    if (result) {
      out(`${indent}result`);
      if (typeof result["text"] === "string") {
        renderTextBlock(result["text"], indent + "  ", out);
      } else {
        renderTextBlock(JSON.stringify(result, null, 2), indent + "  ", out);
      }
    }
  }
}

function renderPart(part: AnyRecord, indent: string, out: Emit): void {
  renderPartLine(part, indent, out);
  renderPartContent(part, indent + "  ", out);
}

// ─── Flatten helpers ──────────────────────────────────────────────────────────

function renderTurnParts(turn: AnyRecord, out: Emit): void {
  const rounds = turn["rounds"] as AnyRecord[] | undefined;
  if (!rounds) return;
  for (const round of rounds) {
    const parts = round["parts"] as AnyRecord[] | undefined;
    if (parts) {
      for (const part of parts) renderPart(part, "", out);
    }
  }
}

function renderLatestError(step: AnyRecord, indent: string, out: Emit): void {
  // F8: the step's failure reason. Today's CLI dropped it entirely; render it.
  const latestError = step["latest_error"] as AnyRecord | undefined;
  if (!latestError) return;
  const kind = latestError["error_kind"] ? `${latestError["error_kind"]}: ` : "";
  const message = String(latestError["message"] ?? "");
  out(`${indent}error  ${kind}${message}`);
}

function renderGenericStep(step: AnyRecord, out: Emit): void {
  const id = String(step["id"] ?? "");
  const type = String(step["type"] ?? "step");
  const status = step["status"] ? `  ${String(step["status"])}` : "";
  const strategy = step["strategy"] ? `  ${String(step["strategy"])}` : "";
  const sourceTurn =
    step["source_turn_number"] != null
      ? `  after turn ${String(step["source_turn_number"])}`
      : "";
  out(`${id}  ${type}${status}${strategy}${sourceTurn}`);

  renderLatestError(step, "  ", out);

  // Compaction: prefer the richer `stripped_parts` (full mode) over the bare
  // `stripped_part_ids`. Render one line per part and the (usually shared) reason
  // just once instead of repeating the boilerplate per part.
  const strippedParts = Array.isArray(step["stripped_parts"])
    ? (step["stripped_parts"] as AnyRecord[])
    : [];
  const strippedPartIds = Array.isArray(step["stripped_part_ids"])
    ? (step["stripped_part_ids"] as unknown[])
    : [];
  if (strippedParts.length > 0) {
    const total = strippedParts.reduce(
      (sum, p) => sum + (p["token_count"] != null ? Number(p["token_count"]) : 0),
      0,
    );
    out(`  stripped ${strippedParts.length} parts (${total} tokens)`);
    for (const strippedPart of strippedParts) {
      const strippedId = String(strippedPart["id"] ?? "");
      const strippedType = strippedPart["type"]
        ? `  ${String(strippedPart["type"])}`
        : "";
      const strippedTokens =
        strippedPart["token_count"] != null
          ? `  (${Number(strippedPart["token_count"])} tokens)`
          : "";
      out(`    ${strippedId}${strippedType}${strippedTokens}`);
    }
    const reasons = new Set(
      strippedParts
        .map((p) => (typeof p["reason"] === "string" ? p["reason"] : ""))
        .filter(Boolean),
    );
    if (reasons.size === 1) {
      out(`  reason  ${[...reasons][0]}`);
    } else {
      for (const strippedPart of strippedParts) {
        if (typeof strippedPart["reason"] === "string") {
          out(`    ${String(strippedPart["id"] ?? "")}  ${strippedPart["reason"]}`);
        }
      }
    }
  } else if (strippedPartIds.length > 0) {
    out(`  stripped ${strippedPartIds.length} parts`);
    for (const partId of strippedPartIds) {
      out(`    ${String(partId)}`);
    }
  }

  const parts = step["parts"] as AnyRecord[] | undefined;
  if (parts) {
    for (const part of parts) renderPart(part, "  ", out);
  }
}

// ─── Type-specific text renderers ─────────────────────────────────────────────

function renderSessionText(data: AnyRecord, out: Emit): void {
  const model = data["model"] as AnyRecord | undefined;
  const mcp = data["mcp"] as Array<{ name: string }> | undefined;
  const ctxWindow = data["context_window"] as AnyRecord | undefined;

  out(`${String(data["id"] ?? "")}  ${data["title"] ?? ""}`);
  if (model) {
    const key = model["key"] ? `  ${String(model["key"])}` : "";
    out(`  model       ${model["name"] ?? ""}${key}`);
  }
  if (mcp && mcp.length > 0) {
    out(`  mcp         ${mcp.map((m) => m.name).join(", ")}`);
  }
  if (ctxWindow)
    out(
      `  context     ${ctxWindow["used"] ?? "?"} / ${ctxWindow["available"] ?? "?"} tokens`,
    );
  if (data["compaction_strategy"])
    out(`  compaction  ${data["compaction_strategy"]}`);
  if (data["max_tool_rounds"] != null)
    out(`  tool rounds ${String(data["max_tool_rounds"])}`);
  const parentRef = data["parent_ref"] as AnyRecord | undefined;
  if (parentRef && parentRef["id"])
    out(`  parent      ${parentRef["kind"] ?? ""} ${parentRef["id"]}`);

  // F9/F10: a uniform terminal status + (when failed) the failure reason, so a
  // session's outcome is visible from the header without reading the whole trace.
  if (data["terminal_status"])
    out(`  status      ${String(data["terminal_status"])}`);
  renderLatestError(data, "  ", out);

  const setup = data["setup"] as AnyRecord | undefined;
  if (setup) {
    out("");
    const parts = setup["parts"] as AnyRecord[] | undefined;
    if (parts) {
      for (const part of parts) renderPart(part, "", out);
    }
  }

  const steps = data["steps"] as AnyRecord[] | undefined;
  if (steps && steps.length > 0) {
    for (const step of steps) {
      out("");
      if (String(step["type"] ?? "") === "turn") {
        renderTurnParts(step, out);
      } else {
        renderGenericStep(step, out);
      }
    }
    return;
  }

  const turns = data["turns"] as AnyRecord[] | undefined;
  if (turns && turns.length > 0) {
    for (const turn of turns) {
      out("");
      renderTurnParts(turn, out);
    }
  }
}

function renderRoundText(data: AnyRecord, out: Emit): void {
  const parts = data["parts"] as AnyRecord[] | undefined;
  if (parts) {
    for (const part of parts) renderPart(part, "", out);
  }
}

function renderSetupText(data: AnyRecord, out: Emit): void {
  const parts = data["parts"] as AnyRecord[] | undefined;
  if (parts) {
    for (const part of parts) renderPart(part, "", out);
  }
}
