# Unify `inspect` to resolve benchmark/run IDs

Follow-up from the benchmark-v1 work (branch `benchmark-v1`). Small, deferred deliberately.

## Context

Benchmark objects now have type-tagged hierarchical IDs (`B-7K3M` benchmark, `B-7K3M.3` case,
`R-9QX4` run) — see `BENCHMARK.md` / `backend/src/domain/hierarchicalIds.ts`. A run is meant
to be "inspectable like a session." Today a run is inspected via the dedicated
`GET /api/benchmark-runs/:runId` endpoint and the CLI `benchmark report <runId>`, and (after
the UI work) via the run report view reached from the tree.

## Gap

The generic `inspect` operation (CLI `mcpscope inspect <id>` / the MCP `mcpscope_inspect` tool)
and `runtime/hierarchicalLookup.ts` resolve **session** hierarchical IDs only. They do not
recognise `B-…` / `R-…` ids, so `mcpscope inspect R-9QX4` does not work.

## Task

Teach `parseHierarchicalId` / `hierarchicalLookup` / the `inspect` operation to recognise the
benchmark namespace and route `B-…` → benchmark detail, `B-…\.<n>` → case, `R-…` → run report.
This gives one uniform inspect surface across CLI + MCP and removes the special-case endpoints
as the only way to inspect a run. Low priority; the dedicated endpoints + UI already cover the
practical need.
