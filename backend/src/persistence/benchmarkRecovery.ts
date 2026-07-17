import { registerRecoveryStep } from "mcpscope-engine/persistence/repository.js";

/**
 * Register recovery of orphaned benchmark runs/evaluations in the engine's
 * startup recovery. Benchmark runs and evaluations are driven by in-process
 * coordinators that do not survive a restart. Any left non-terminal is orphaned
 * → mark it 'stopped' (the resumable rest state) so the user can resume/retry
 * the remaining work, rather than spinning forever as 'running'. Stale per-task
 * sessions left 'running' inside the record are reconciled to 'cancelled' when
 * the coordinator resumes. 'paused' runs are equally orphaned (the in-memory
 * gate is gone). No completed_at stamp: 'stopped' is a resumable rest state,
 * not a completion — the coordinator stamps completed_at only on complete/error.
 *
 * Called from `buildBackendApp` before `recoverInterruptedState`, and after the
 * benchmark schema extension is registered so the tables exist.
 */
export function registerBenchmarkRecovery(): void {
  registerRecoveryStep("benchmark", (connection, now) => {
    connection
      .prepare(
        `
      UPDATE benchmark_runs
      SET status = 'stopped',
          error = COALESCE(error, 'Interrupted by a server restart; resume to recover.'),
          updated_at = ?
      WHERE status IN ('pending', 'running', 'paused')
    `,
      )
      .run(now);

    connection
      .prepare(
        `
      UPDATE benchmark_evaluations
      SET status = 'stopped',
          error = COALESCE(error, 'Interrupted by a server restart; resume to recover.'),
          updated_at = ?
      WHERE status IN ('pending', 'running', 'paused')
    `,
      )
      .run(now);
  });
}
