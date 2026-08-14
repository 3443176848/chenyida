const RESOURCE_FIELDS = Object.freeze([
  "compose_parallel_limit",
  "node_max_old_space_size_mib",
  "min_available_memory_mib",
  "max_swap_used_percent",
  "max_swap_growth_mib_60s",
  "min_root_free_gib",
  "max_load_1m",
  "max_temporary_containers",
]);

export class MonitoringResourcePolicyError extends Error {
  constructor(code) {
    super(code);
    this.name = "MonitoringResourcePolicyError";
    this.code = code;
  }
}

function reject(code) {
  throw new MonitoringResourcePolicyError(code);
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
}

export function validateMonitoringResourcePlan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject("MONITOR_RESOURCE_PLAN_INVALID");
  if (value.schema_version !== 2 || value.contract !== "chenyida-erp-release-gate-plan/v2" || value.plan_id !== "selfhost-release-gate-v2" || value.plan_version !== 2 || value.working_directory !== "chenyida_erp_site") reject("MONITOR_RESOURCE_PLAN_INVALID");
  exactKeys(value.resource_policy, RESOURCE_FIELDS, "MONITOR_RESOURCE_POLICY_FIELDS_INVALID");
  const policy = value.resource_policy;
  if (policy.compose_parallel_limit !== 1 || policy.max_temporary_containers !== 1) reject("MONITOR_RESOURCE_SERIAL_POLICY_INVALID");
  integer(policy.node_max_old_space_size_mib, 128, 1024, "MONITOR_RESOURCE_NODE_HEAP_INVALID");
  integer(policy.min_available_memory_mib, 768, 65_536, "MONITOR_RESOURCE_MEMORY_INVALID");
  integer(policy.max_swap_used_percent, 1, 80, "MONITOR_RESOURCE_SWAP_INVALID");
  integer(policy.max_swap_growth_mib_60s, 1, 256, "MONITOR_RESOURCE_SWAP_GROWTH_INVALID");
  integer(policy.min_root_free_gib, 10, 1024, "MONITOR_RESOURCE_DISK_INVALID");
  if (typeof policy.max_load_1m !== "number" || !Number.isFinite(policy.max_load_1m) || policy.max_load_1m <= 0 || policy.max_load_1m > 4) reject("MONITOR_RESOURCE_LOAD_INVALID");
  return value;
}
