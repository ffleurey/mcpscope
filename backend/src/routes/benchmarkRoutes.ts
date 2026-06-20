import { z } from "zod";
import type { RouteDeps } from "./types.js";
import { rubricCriterionSchema } from "../domain/model.js";
import {
  createBenchmarkEntry,
  listBenchmarkEntries,
  getBenchmarkDetail,
  updateBenchmarkEntry,
  deleteBenchmarkEntry,
  addBenchmarkCase,
  addBenchmarkCaseFromSession,
  updateBenchmarkCaseEntry,
  deleteBenchmarkCaseEntry,
  launchBenchmarkRun,
  getBenchmarkRunReport,
  deleteBenchmarkRunEntry,
  evaluateBenchmarkRun,
  listBenchmarkRunEvaluations,
} from "../operations/benchmark.js";
import {
  benchmarkCreateOperation,
  benchmarkListOperation,
  benchmarkInspectOperation,
  benchmarkAddCaseOperation,
  benchmarkAddCaseFromSessionOperation,
  benchmarkRunOperation,
  benchmarkRunStatusOperation,
  benchmarkRunReportOperation,
} from "../operations/index.js";

/**
 * Benchmark HTTP routes. The camelCase record routes are the frontend surface
 * (consistent with the session/trace HTTP API). The canonical snake_case catalog
 * operations — the CLI/MCP surface — are mounted separately below under
 * /api/operations/*. See BENCHMARK.md and backlog/completed/benchmark-v1.md.
 */
export function registerBenchmarkRoutes({
  app,
  database,
  opCtx,
  handleOperationError,
}: RouteDeps): void {
  app.get("/api/benchmarks", async () => ({
    benchmarks: listBenchmarkEntries(database),
  }));

  app.post("/api/benchmarks", async (request, reply) => {
    const body = z
      .object({
        name: z.string().min(1),
        description: z.string().nullable().optional(),
      })
      .parse(request.body);
    try {
      return { benchmark: createBenchmarkEntry(database, body) };
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.get("/api/benchmarks/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    try {
      return getBenchmarkDetail(database, id);
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.patch("/api/benchmarks/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
      })
      .parse(request.body);
    try {
      return { benchmark: updateBenchmarkEntry(database, id, body) };
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.delete("/api/benchmarks/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    try {
      deleteBenchmarkEntry(database, id);
      reply.code(204);
      return null;
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.post("/api/benchmarks/:id/cases", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        prompt: z.string().min(1),
        name: z.string().nullable().optional(),
        expectedToolsCalled: z.array(z.string()).optional(),
        expectedToolsNotCalled: z.array(z.string()).optional(),
        rubric: z.array(rubricCriterionSchema).optional(),
      })
      .parse(request.body);
    try {
      reply.code(201);
      return { case: addBenchmarkCase(database, id, body) };
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.post("/api/benchmarks/:id/cases/from-session", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({ sessionId: z.string(), name: z.string().nullable().optional() })
      .parse(request.body);
    try {
      reply.code(201);
      return {
        case: addBenchmarkCaseFromSession(database, id, body.sessionId, {
          name: body.name,
        }),
      };
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.patch("/api/benchmark-cases/:caseId", async (request, reply) => {
    const { caseId } = z.object({ caseId: z.string() }).parse(request.params);
    const body = z
      .object({
        name: z.string().nullable().optional(),
        prompt: z.string().min(1).optional(),
        orderIndex: z.number().int().nonnegative().optional(),
        expectedToolsCalled: z.array(z.string()).optional(),
        expectedToolsNotCalled: z.array(z.string()).optional(),
        rubric: z.array(rubricCriterionSchema).optional(),
      })
      .parse(request.body);
    try {
      return { case: updateBenchmarkCaseEntry(database, caseId, body) };
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.delete("/api/benchmark-cases/:caseId", async (request, reply) => {
    const { caseId } = z.object({ caseId: z.string() }).parse(request.params);
    try {
      deleteBenchmarkCaseEntry(database, caseId);
      reply.code(204);
      return null;
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.post("/api/benchmarks/:id/runs", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        caseIds: z.array(z.string()).optional(),
        repetitions: z.number().int().positive().optional(),
        modelConfigId: z.string().optional(),
        mcpProfileIds: z.array(z.string()).optional(),
      })
      .parse(request.body ?? {});
    try {
      const run = launchBenchmarkRun(opCtx, { benchmarkId: id, ...body });
      reply.code(202);
      return { run };
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.get("/api/benchmark-runs/:runId", async (request, reply) => {
    const { runId } = z.object({ runId: z.string() }).parse(request.params);
    try {
      return getBenchmarkRunReport(database, runId);
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.delete("/api/benchmark-runs/:runId", async (request, reply) => {
    const { runId } = z.object({ runId: z.string() }).parse(request.params);
    try {
      deleteBenchmarkRunEntry(database, runId);
      reply.code(204);
      return null;
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  // Launch a new evaluation pass over a completed run (repeatable; one per judge model).
  app.post("/api/benchmark-runs/:runId/evaluations", async (request, reply) => {
    const { runId } = z.object({ runId: z.string() }).parse(request.params);
    const body = z
      .object({ judgeModelConfigId: z.string().min(1) })
      .parse(request.body);
    try {
      const evaluation = evaluateBenchmarkRun(opCtx, {
        runId,
        judgeModelConfigId: body.judgeModelConfigId,
      });
      reply.code(202);
      return { evaluation };
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.get("/api/benchmark-runs/:runId/evaluations", async (request, reply) => {
    const { runId } = z.object({ runId: z.string() }).parse(request.params);
    try {
      return { evaluations: listBenchmarkRunEvaluations(database, runId) };
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  // ── Operation-backed surface (canonical snake_case, consumed by CLI + MCP) ──
  // These mirror the catalog benchmark operations and return their result
  // verbatim. Distinct from the camelCase frontend routes above. The MCP server
  // exposes the same ops as mcpscope_<id> tools (CLI/MCP parity).

  app.post("/api/operations/benchmark-create", async (request, reply) => {
    try {
      return await benchmarkCreateOperation.execute(opCtx, request.body as never);
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.get("/api/operations/benchmarks", async (_request, reply) => {
    try {
      return await benchmarkListOperation.execute(opCtx, {});
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.get("/api/operations/benchmarks/:benchmarkId", async (request, reply) => {
    const { benchmarkId } = z
      .object({ benchmarkId: z.string() })
      .parse(request.params);
    try {
      return await benchmarkInspectOperation.execute(opCtx, {
        benchmark_id: benchmarkId,
      });
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.post("/api/operations/benchmark-add-case", async (request, reply) => {
    try {
      return await benchmarkAddCaseOperation.execute(
        opCtx,
        request.body as never,
      );
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.post(
    "/api/operations/benchmark-add-case-from-session",
    async (request, reply) => {
      try {
        return await benchmarkAddCaseFromSessionOperation.execute(
          opCtx,
          request.body as never,
        );
      } catch (err) {
        return handleOperationError(err, reply);
      }
    },
  );

  app.post("/api/operations/benchmark-run", async (request, reply) => {
    try {
      return await benchmarkRunOperation.execute(opCtx, request.body as never);
    } catch (err) {
      return handleOperationError(err, reply);
    }
  });

  app.get(
    "/api/operations/benchmark-runs/:runId/status",
    async (request, reply) => {
      const { runId } = z.object({ runId: z.string() }).parse(request.params);
      try {
        return await benchmarkRunStatusOperation.execute(opCtx, {
          run_id: runId,
        });
      } catch (err) {
        return handleOperationError(err, reply);
      }
    },
  );

  app.get(
    "/api/operations/benchmark-runs/:runId/report",
    async (request, reply) => {
      const { runId } = z.object({ runId: z.string() }).parse(request.params);
      try {
        return await benchmarkRunReportOperation.execute(opCtx, {
          run_id: runId,
        });
      } catch (err) {
        return handleOperationError(err, reply);
      }
    },
  );
}
