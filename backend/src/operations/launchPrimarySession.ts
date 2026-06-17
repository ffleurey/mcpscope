import { z } from "zod";
import type { OperationError } from "./errors.js";
import { createSession } from "../runtime/modelTurns.js";
import { sessionRecordSchema, type SessionRecord } from "../domain/model.js";
import type { OperationContext } from "./context.js";
import {
  mapSessionIdError,
  resolvePrimarySessionInputs,
} from "./sessionCreationShared.js";

export const launchPrimarySessionInputSchema = z.object({
  session_id: z.string().optional(),
  title: z.string().optional(),
  model_config_id: z.string().optional(),
  mcp_profile_ids: z.array(z.string()).optional(),
  compaction_strategy: z.enum(["none", "strip-reasoning"]).optional(),
});

export type LaunchPrimarySessionInput = z.infer<
  typeof launchPrimarySessionInputSchema
>;

export interface LaunchPrimarySessionResult {
  session: SessionRecord;
  /** Job ID of the auto-enqueued init job, if one was created. Frontend can pass
   *  this to awaitJob for precise completion tracking without session-ID ambiguity. */
  initJobId?: string;
}

export const launchPrimarySessionOutputSchema = {
  session: sessionRecordSchema,
  initJobId: z.string().optional(),
};

export const launchPrimarySessionOperation = {
  schema: launchPrimarySessionInputSchema,
  outputSchema: launchPrimarySessionOutputSchema,
  async execute(
    ctx: OperationContext,
    rawInput: unknown,
  ): Promise<LaunchPrimarySessionResult> {
    return executePrimarySessionLaunch(ctx, rawInput);
  },
};

export async function executePrimarySessionLaunch(
  ctx: OperationContext,
  rawInput: unknown,
): Promise<LaunchPrimarySessionResult> {
  const { db } = ctx;
  const input = launchPrimarySessionInputSchema.parse(rawInput);

  type TxResult =
    | { kind: "error"; error: OperationError }
    | { kind: "created"; session: SessionRecord };

  const result: TxResult = db.connection.transaction((): TxResult => {
    const resolved = resolvePrimarySessionInputs({
      modelConfigId: input.model_config_id,
      mcpProfileIds: input.mcp_profile_ids,
    });
    if (!resolved.ok) return { kind: "error", error: resolved.error };

    try {
      const session = createSession(db, {
        sessionId: input.session_id,
        title: input.title,
        modelProfileSnapshot: resolved.modelProfileSnapshot,
        mcpProfileSnapshots: resolved.mcpProfileSnapshots,
        compactionStrategy: input.compaction_strategy ?? "strip-reasoning",
        sessionType: "primary",
      });
      return { kind: "created", session };
    } catch (error) {
      const mapped = mapSessionIdError(error);
      if (mapped) return { kind: "error", error: mapped };
      throw error;
    }
  })();

  if (result.kind === "error") {
    throw result.error;
  }

  let initJobId: string | undefined;
  if (ctx.scheduler) {
    try {
      const initJob = ctx.scheduler.enqueueInit(ctx, result.session.id);
      initJobId = initJob.jobId;
    } catch {
      // Admission failure (e.g. another session active) is non-fatal here;
      // the frontend can fall back to calling /initialize explicitly.
    }
  }
  return { session: result.session, ...(initJobId ? { initJobId } : {}) };
}
