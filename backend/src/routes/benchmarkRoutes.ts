import { z } from "zod";
import type { RouteDeps } from "./types.js";
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
} from "../operations/benchmark.js";

/**
 * Benchmark HTTP surface (frontend + CLI). camelCase record shapes, consistent
 * with the rest of the session/trace HTTP API. Not part of the MCP operation
 * catalog (Phase A is HTTP/CLI-only). See backlog/specification/benchmark-v1.md.
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
}
