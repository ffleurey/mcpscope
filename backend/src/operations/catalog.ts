import { listOperation } from "./list.js";
import { createOperation } from "./create.js";
import { sendOperation } from "./send.js";
import { statusOperation } from "./status.js";
import { inspectOperation } from "./inspect.js";
import { listModelConfigsOperation } from "./listConfigs.js";
import { listMcpProfilesOperation } from "./listConfigs.js";
import {
  benchmarkCreateOperation,
  benchmarkListOperation,
  benchmarkInspectOperation,
  benchmarkAddCaseOperation,
  benchmarkAddCaseFromSessionOperation,
  benchmarkUpdateCaseOperation,
  benchmarkDeleteCaseOperation,
  benchmarkDeleteOperation,
  benchmarkRunOperation,
  benchmarkRunStatusOperation,
  benchmarkRunReportOperation,
  benchmarkRunControlOperation,
  benchmarkDeleteRunOperation,
  benchmarkEvaluateOperation,
  benchmarkRunEvaluationsOperation,
  benchmarkEvaluationControlOperation,
  benchmarkDeleteEvaluationOperation,
} from "./benchmarkOperations.js";

export const operationCatalog = {
  list: listOperation,
  create: createOperation,
  send: sendOperation,
  status: statusOperation,
  inspect: inspectOperation,
  list_model_configs: listModelConfigsOperation,
  list_mcp_profiles: listMcpProfilesOperation,
  benchmark_create: benchmarkCreateOperation,
  benchmark_list: benchmarkListOperation,
  benchmark_inspect: benchmarkInspectOperation,
  benchmark_add_case: benchmarkAddCaseOperation,
  benchmark_add_case_from_session: benchmarkAddCaseFromSessionOperation,
  benchmark_update_case: benchmarkUpdateCaseOperation,
  benchmark_delete_case: benchmarkDeleteCaseOperation,
  benchmark_delete: benchmarkDeleteOperation,
  benchmark_run: benchmarkRunOperation,
  benchmark_run_status: benchmarkRunStatusOperation,
  benchmark_run_report: benchmarkRunReportOperation,
  benchmark_run_control: benchmarkRunControlOperation,
  benchmark_delete_run: benchmarkDeleteRunOperation,
  benchmark_evaluate: benchmarkEvaluateOperation,
  benchmark_run_evaluations: benchmarkRunEvaluationsOperation,
  benchmark_evaluation_control: benchmarkEvaluationControlOperation,
  benchmark_delete_evaluation: benchmarkDeleteEvaluationOperation,
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
  benchmarkCreateOperation,
  benchmarkListOperation,
  benchmarkInspectOperation,
  benchmarkAddCaseOperation,
  benchmarkAddCaseFromSessionOperation,
  benchmarkUpdateCaseOperation,
  benchmarkDeleteCaseOperation,
  benchmarkDeleteOperation,
  benchmarkRunOperation,
  benchmarkRunStatusOperation,
  benchmarkRunReportOperation,
  benchmarkRunControlOperation,
  benchmarkDeleteRunOperation,
  benchmarkEvaluateOperation,
  benchmarkRunEvaluationsOperation,
  benchmarkEvaluationControlOperation,
  benchmarkDeleteEvaluationOperation,
] as const;
