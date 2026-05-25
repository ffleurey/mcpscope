import { listOperation } from './list.js'
import { createOperation } from './create.js'
import { sendOperation } from './send.js'
import { statusOperation } from './status.js'
import { inspectOperation } from './inspect.js'

export const operationCatalog = {
  list: listOperation,
  create: createOperation,
  send: sendOperation,
  status: statusOperation,
  inspect: inspectOperation,
} as const

export type OperationId = keyof typeof operationCatalog

export const operationList = [
  listOperation,
  createOperation,
  sendOperation,
  statusOperation,
  inspectOperation,
] as const
