import type { FastifyInstance, FastifyReply } from 'fastify'
import type { BackendConfig } from '../config.js'
import type { OperationContext } from '../operations/index.js'
import type { ExecutionScheduler } from '../runtime/scheduler.js'
import type { SchedulerEvent } from '../runtime/schedulerTypes.js'
import type { openBackendDatabase } from '../persistence/db.js'
import type { ActiveSessionInfo } from '../persistence/repository.js'

export type BackendDatabaseHandle = ReturnType<typeof openBackendDatabase>

export interface RouteDeps {
  app: FastifyInstance
  config: BackendConfig
  database: BackendDatabaseHandle
  scheduler: ExecutionScheduler
  opCtx: OperationContext
  handleOperationError: (err: unknown, reply: { code(n: number): void }) => { error: Record<string, unknown> }
  anotherSessionActiveError: (active: ActiveSessionInfo) => { error: Record<string, unknown> }
  toLifecycleState: (summary: { id: string; status: string; initStatus: string }) => 'initializing' | 'ready' | 'running' | 'error'
  relaySchedulerJobStream: (
    reply: FastifyReply,
    jobId: string,
    options: {
      shouldCloseOnExecutionEvent: (event: Extract<SchedulerEvent, { type: 'scheduler-execution-event' }>['event']) => boolean
      failureEvent: (message: string) => { type: string; [key: string]: unknown }
    },
  ) => Promise<void>
}