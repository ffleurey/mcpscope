/**
 * Tests for analysis plan construction and derived-position execution.
 *
 * The plan is built from artifacts (evidence packet index) not from tree
 * traversal.  findFirstIncomplete() derives the current position by
 * comparing the plan against artifact existence.
 */

import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { openBackendDatabase } from "../persistence/db.js";
import {
  createSessionRecord,
  insertStepRecord,
} from "../persistence/repository.js";
import { insertJsonArtifact } from "./artifactRepository.js";
import { SCHEMA_KEY } from "./schemas.js";
import type { BackendDatabase } from "../persistence/db.js";
import type { StepTypeKey } from "../domain/executionModel.js";
import type { StepResult } from "../domain/executionModel.js";

function makeDb(): BackendDatabase {
  return openBackendDatabase(`/tmp/test-tree-${crypto.randomUUID()}.db`);
}

describe("analysis plan derivation from artifacts", () => {
  it("isComplete distinguishes completed vs pending commands via artifact existence", () => {
    const db = makeDb();
    createSessionRecord(db.connection, {
      id: "ANLY",
      title: "ANLY",
      status: "ready",
      initStatus: "ready",
      sessionType: "session_analysis",
      parentKind: "session",
      parentId: "TARG",
      createdAt: 1,
      updatedAt: 1,
      modelProfileSnapshot: {
        id: "m",
        name: "m",
        modelKey: "m",
        modelDisplayName: "m",
        connectionBaseUrl: "https://x.com/v1",
        apiKey: null,
        systemPrompt: "Reply.",
        temperature: 0,
        reasoning: null,
        createdAt: 1,
        updatedAt: 1,
      },
      mcpProfileSnapshots: [],
      loadedContextLength: null,
      systemPromptTokens: null,
      toolDefinitionsTokens: null,
      isContextExhausted: false,
      compactionStrategy: "strip-reasoning",
    });
    // Step record needed for artifact FK constraint
    insertStepRecord(db.connection, {
      id: "step-1",
      sessionId: "ANLY",
      stepTypeKey: "analysis_bootstrap" as unknown as StepTypeKey,
      parentStepId: null,
      childIndex: 0,
      status: "complete",
      params: {},
      state: {},
      createdAt: 1,
      completedAt: 1,
    });

    // Bootstrap artifact exists → bootstrap is complete
    insertJsonArtifact(db.connection, {
      id: "idx-1",
      sessionId: "ANLY",
      stepId: "step-1",
      content: {
        packets: [
          {
            turn_id: "TARG.1T",
            round_id: "TARG.1.1",
            tool_call_part_id: "TC-1",
            tool_name: "test",
            tool_call_parameters: "{}",
            reasoning_before_part_id: null,
            tool_result_part_id: null,
            reasoning_after_part_id: null,
          },
        ],
      },
      metadata: { schema_key: SCHEMA_KEY.EVIDENCE_PACKET_INDEX },
      createdAt: 1,
    });

    // A mock plan with two commands.  Bootstrap (complete) followed by
    // assess (incomplete — no assessment artifact exists for TC-1).
    const assessChecked = { called: false };
    const plan = [
      {
        kind: "bootstrap",
        semanticId: "",
        stepTypeKey: "" as unknown as StepTypeKey,
        isComplete: (_db: unknown, _sid: string) => {
          const exists = !!db.connection
            .prepare(
              "SELECT 1 FROM artifacts WHERE session_id = 'ANLY' AND metadata_json LIKE '%evidence_packet_index%'",
            )
            .get();
          return exists;
        },
        buildStep: null as unknown as (ctx: unknown) => Promise<StepResult>,
      },
      {
        kind: "assess",
        semanticId: "TC-1",
        stepTypeKey: "" as unknown as StepTypeKey,
        isComplete: (_db: unknown, _sid: string) => {
          assessChecked.called = true;
          return false; // no assessment artifact
        },
        buildStep: null as unknown as (ctx: unknown) => Promise<StepResult>,
      },
    ];

    // Simulate findFirstIncomplete: skip completed commands, return first incomplete
    const firstIncomplete = plan.find(
      (cmd) => !cmd.isComplete(db as unknown as BackendDatabase, "ANLY"),
    );
    expect(firstIncomplete?.semanticId).toBe("TC-1");
    expect(assessChecked.called).toBe(true);
  });
});
