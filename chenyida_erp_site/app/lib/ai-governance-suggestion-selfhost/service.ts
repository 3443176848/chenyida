import { AI_GOVERNANCE_CAPABILITIES } from "./types.ts";
import { aiSuggestionFailure } from "./errors.ts";
import type {
  AiGovernanceCapability,
  AiSuggestionActor,
  AiSuggestionMutationContext,
  AiSuggestionRepositoryPort,
} from "./types.ts";

function hasPermission(actor: AiSuggestionActor, permission: string): boolean {
  return actor.permissions.includes("*") || actor.permissions.includes(permission);
}

function requirePermission(actor: AiSuggestionActor, permission: string): void {
  if (!hasPermission(actor, permission)) aiSuggestionFailure("PERMISSION_DENIED", "没有权限执行此操作", 403);
}

function exactCreateBody(body: Record<string, unknown>): Readonly<{
  capability: AiGovernanceCapability;
  expectedGroupVersion: number;
}> {
  const allowed = new Set(["capability", "expected_group_version"]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) aiSuggestionFailure("REQUEST_FIELD_UNKNOWN", `请求包含未知字段：${unknown}`, 400);
  if (Object.keys(body).length !== 2 || !("capability" in body) || !("expected_group_version" in body)) {
    aiSuggestionFailure("REQUEST_VALIDATION_FAILED", "请求必须且只能包含 capability 与 expected_group_version", 400);
  }
  const capability = body.capability;
  if (typeof capability !== "string" || !AI_GOVERNANCE_CAPABILITIES.includes(capability as AiGovernanceCapability)) {
    aiSuggestionFailure("AI_SUGGESTION_CAPABILITY_INVALID", "AI 建议能力无效", 400);
  }
  const expectedGroupVersion = body.expected_group_version;
  if (!Number.isSafeInteger(expectedGroupVersion) || Number(expectedGroupVersion) <= 0) {
    aiSuggestionFailure("REQUEST_VALIDATION_FAILED", "expected_group_version 无效", 400);
  }
  return { capability: capability as AiGovernanceCapability, expectedGroupVersion: Number(expectedGroupVersion) };
}

export class AiGovernanceSuggestionService {
  readonly repository: AiSuggestionRepositoryPort;

  constructor(repository: AiSuggestionRepositoryPort) {
    this.repository = repository;
  }

  async create(
    batchId: number,
    governanceRunId: number,
    governanceGroupId: number,
    context: AiSuggestionMutationContext,
    body: Record<string, unknown>,
  ) {
    requirePermission(context.actor, "material.import.governance.run");
    if (context.actor.must_change_password) aiSuggestionFailure("PASSWORD_CHANGE_REQUIRED", "请先修改临时密码", 403);
    const input = exactCreateBody(body);
    return this.repository.create(
      batchId,
      governanceRunId,
      governanceGroupId,
      input.capability,
      input.expectedGroupVersion,
      context,
    );
  }

  async list(
    batchId: number,
    governanceRunId: number,
    governanceGroupId: number,
    actor: AiSuggestionActor,
    page: Readonly<{ afterUid: string | null; limit: number }>,
  ) {
    requirePermission(actor, "material.import.governance.read");
    return this.repository.list(batchId, governanceRunId, governanceGroupId, actor, page.afterUid, page.limit);
  }

  async one(
    batchId: number,
    governanceRunId: number,
    governanceGroupId: number,
    suggestionUid: string,
    actor: AiSuggestionActor,
  ) {
    requirePermission(actor, "material.import.governance.read");
    return this.repository.one(batchId, governanceRunId, governanceGroupId, suggestionUid, actor);
  }
}
