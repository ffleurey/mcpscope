// ─────────────────────────────────────────────────────────────────────────────
// Text rendering takes ONLY the JSON payload as input, so text can never contain
// MORE than the JSON (text ⊆ json by construction). It does NOT guarantee text
// shows everything in the JSON — a formatter may omit fields for readability.
//
// This is the "specify and review" side of that contract (see
// backlog/research/inspect-payloads/serialization-architecture.md, Rule 2c):
// the keys below are the fields we DELIBERATELY omit from the text rendering.
// The coverage test asserts every other JSON string leaf appears in the text, so
// any *accidental* omission fails CI until it's rendered or consciously added here.
//
// Entries are matched by the leaf's key name OR a `parent.key` path suffix.
// ─────────────────────────────────────────────────────────────────────────────

export const TEXT_OMISSION_ALLOWLIST: ReadonlySet<string> = new Set([
  // ── F4 graph-plumbing: structural/navigation metadata, not analysis content.
  // Useful to programmatic JSON consumers; noise in human/LLM text. Decision
  // 2026-06-27: JSON-only for now (whether they belong in JSON at all is a
  // separate, deferred question).
  "token_source",
  "token_confidence",
  "owner_step_id",
  "source_turn_id",
  "model.id", // the model's internal config id; text shows name + key instead
  "parent_ref.kind",
  "parent_ref.id",
  "session_type",
  "workflow_kind", // text shows workflow_label instead

  // ── Enum partially surfaced by design: `context_state` is rendered only when
  // not "included" (e.g. " - stripped"); the "included" value is intentionally
  // not printed, so the literal string may be absent from text.
  "context_state",

  // ── Short structural/lifecycle enums. Some views surface them (a step shows
  // its type+status; a part shows its type), others collapse them (a turn/round
  // overview shows its parts, not per-round status). They are verified directly
  // by the targeted unit tests (e.g. inspectBenchmark.test.ts asserts run/eval
  // statuses), not by this content-coverage check, which targets dropped *content*
  // (ids, names, prompts, error messages, body text, tool names).
  "type",
  "status",

  // ── Echoed request metadata, not payload content.
  "mode",
]);

/** True when a JSON string leaf at `path` is allowed to be absent from the text. */
export function isOmittable(path: string[]): boolean {
  const key = path[path.length - 1] ?? "";
  if (TEXT_OMISSION_ALLOWLIST.has(key)) return true;
  const suffix = path.slice(-2).join(".");
  return TEXT_OMISSION_ALLOWLIST.has(suffix);
}
