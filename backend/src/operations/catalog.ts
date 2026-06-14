import { listOperation } from "./list.js";
import { createOperation } from "./create.js";
import { sendOperation } from "./send.js";
import { statusOperation } from "./status.js";
import { inspectOperation } from "./inspect.js";
import { listModelConfigsOperation } from "./listConfigs.js";
import { listMcpProfilesOperation } from "./listConfigs.js";

export const operationCatalog = {
  list: listOperation,
  create: createOperation,
  send: sendOperation,
  status: statusOperation,
  inspect: inspectOperation,
  list_model_configs: listModelConfigsOperation,
  list_mcp_profiles: listMcpProfilesOperation,
} as const;

export type BackendOperationId = keyof typeof operationCatalog;

export const operationList = [
  listOperation,
  createOperation,
  sendOperation,
  statusOperation,
  inspectOperation,
  listModelConfigsOperation,
  listMcpProfilesOperation,
] as const;
