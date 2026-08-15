import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { DASHBOARD_ROLE_DOMAINS } from "../app/lib/dashboard-selfhost/permissions.ts";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { IDENTITY_ROLES, type IdentityRole } from "../app/lib/identity-selfhost/types.ts";
import {
  APPLICATION_AUTHORIZATION_ALL_EMPLOYEE_READ_PENDING,
  APPLICATION_AUTHORIZATION_OPERATIONS_V1,
} from "../operations/application-authorization-route-contract-v1.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = resolve(ROOT, "operations/application-authorization-policy-v1.json");
const ARTIFACT_PATH = resolve(ROOT, "operations/application-authorization-matrix-v1.json");
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PERMISSION_PATTERN = /^(?:[a-z][a-z0-9_]*)(?:\.[a-z][a-z0-9_]*)+$/;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type PolicyOperation = {
  id: string;
  source: string;
  evidence: string;
  route_pattern: string;
  methods: string[];
  access: "PROTECTED" | "SELF_SERVICE" | "PUBLIC" | "RETIRED" | "OFFLINE_FORBIDDEN";
  permissions_all?: string[];
  permissions_any?: string[];
  data_domain: string;
  csrf: string;
  idempotency: string;
  audit: string;
  universal_role_access_reason?: string;
  note?: string;
};
type Policy = {
  schema_version: number;
  approval: { status: string; owner: string; scope: string };
  expected_roles: string[];
  wildcard_roles: string[];
  domain_by_permission_prefix: Record<string, string>;
  dashboard_domain_permissions: Record<string, string[]>;
  reviewed_handler_sources: string[];
  supplemental_authorization_roots: string[];
  reviewed_authorization_source_manifest_sha256: string;
  route_prefix_literals: Array<{ source: string; literal: string; reason: string }>;
  permission_usage_exceptions: Array<{ permission: string; reason: string; classification: "DYNAMIC_SOURCE_CONSTRUCTION" | "LEGACY_GRANTED_NOT_REACHABLE" }>;
  operations: PolicyOperation[];
};

function stable(value: Json): Json {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

function canonical(value: Json): string {
  return JSON.stringify(stable(value));
}

function pretty(value: Json): string {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function repositoryPath(path: string): string {
  return relative(ROOT, path).replaceAll("\\", "/");
}

function resolveImport(sourcePath: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const candidate = resolve(dirname(sourcePath), specifier);
  const options = extname(candidate) ? [candidate] : [`${candidate}.ts`, resolve(candidate, "index.ts")];
  return options.find((path) => path.startsWith(resolve(ROOT, "app/lib")) && (() => { try { readFileSync(path); return true; } catch { return false; } })()) ?? null;
}

function dependencyClosure(roots: readonly string[]): string[] {
  const pending = roots.map((path) => resolve(ROOT, path));
  const visited = new Set<string>();
  while (pending.length) {
    const sourcePath = pending.pop()!;
    if (visited.has(sourcePath)) continue;
    visited.add(sourcePath);
    const source = readFileSync(sourcePath, "utf8");
    for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      const imported = resolveImport(sourcePath, match[1]);
      if (imported && !visited.has(imported)) pending.push(imported);
    }
  }
  return [...visited].map(repositoryPath).sort();
}

function dispatcherHandlerSources(): string[] {
  const dispatcher = readFileSync(resolve(ROOT, "app/lib/selfhost-api.ts"), "utf8");
  return [...dispatcher.matchAll(/\bfrom\s+["']\.\/([^"']+\/handler\.ts)["']/g)]
    .map((match) => `app/lib/${match[1]}`)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
}

function isAuthorizationSource(source: string): boolean {
  return /(?:permissions\.includes\s*\(|\brequirePermission\s*\(|\bhasPermission\s*\(|\brequireDashboard\s*\(|\brequireManagement\s*\(|\bcanReadDomain\s*\(|\bpermission\s*:|\broute\.permission\b)/.test(source);
}

function authorizationSources(policy: Policy): string[] {
  const roots = ["app/lib/selfhost-api.ts", ...policy.reviewed_handler_sources, ...policy.supplemental_authorization_roots];
  const closure = dependencyClosure(roots);
  const selected = closure.filter((path) => isAuthorizationSource(readFileSync(resolve(ROOT, path), "utf8")));
  return [...new Set(["app/lib/selfhost-api.ts", "app/lib/identity-selfhost/types.ts", "operations/application-authorization-route-contract-v1.ts", ...policy.reviewed_handler_sources, ...selected])].sort();
}

function sourceManifest(paths: readonly string[]): { files: Array<{ path: string; sha256: string }>; sha256: string } {
  const files = paths.map((path) => ({ path, sha256: sha256(readFileSync(resolve(ROOT, path))) }));
  return { files, sha256: sha256(canonical(files as unknown as Json)) };
}

function sourceFile(path: string): ts.SourceFile {
  const absolute = resolve(ROOT, path);
  return ts.createSourceFile(path, readFileSync(absolute, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function routeLiterals(path: string): string[] {
  const found = new Set<string>();
  function visit(node: ts.Node): void {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text.startsWith("/api/")) found.add(node.text);
    if (ts.isRegularExpressionLiteral(node) && node.text.includes("\\/api\\/")) found.add(node.text);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile(path));
  return [...found].sort();
}

function permissionLiterals(paths: readonly string[], policy: Policy): string[] {
  const found = new Set<string>();
  const prefixes = Object.keys(policy.domain_by_permission_prefix);
  for (const path of paths) {
    if (path === "app/lib/identity-selfhost/permissions.ts" || path === "operations/application-authorization-route-contract-v1.ts") continue;
    function visit(node: ts.Node): void {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        && PERMISSION_PATTERN.test(node.text)
        && prefixes.some((prefix) => node.text === prefix || node.text.startsWith(`${prefix}.`))) found.add(node.text);
      ts.forEachChild(node, visit);
    }
    visit(sourceFile(path));
  }
  return [...found].sort();
}

function lineForEvidence(path: string, evidence: string): number {
  const source = readFileSync(resolve(ROOT, path), "utf8");
  const index = source.indexOf(evidence);
  if (index < 0) return 0;
  return source.slice(0, index).split("\n").length;
}

function domainForPermission(permission: string, policy: Policy): string | null {
  const matches = Object.entries(policy.domain_by_permission_prefix)
    .filter(([prefix]) => permission === prefix || permission.startsWith(`${prefix}.`))
    .sort(([left], [right]) => right.length - left.length);
  return matches[0]?.[1] ?? null;
}

function validatePolicyShape(policy: Policy, errors: string[]): void {
  if (policy.schema_version !== 1) errors.push("POLICY_SCHEMA_VERSION_INVALID");
  if (policy.approval.status !== "BUSINESS_APPROVAL_PENDING") errors.push("BUSINESS_APPROVAL_MUST_REMAIN_PENDING");
  if (canonical(policy.expected_roles as unknown as Json) !== canonical([...IDENTITY_ROLES] as unknown as Json)) errors.push("ROLE_SET_OR_ORDER_DRIFT");
  if (canonical([...policy.wildcard_roles].sort() as unknown as Json) !== canonical(["admin"] as unknown as Json)) errors.push("WILDCARD_ROLE_POLICY_INVALID");
  const ids = policy.operations.map((operation) => operation.id);
  if (new Set(ids).size !== ids.length) errors.push("DUPLICATE_OPERATION_ID");
  for (const operation of policy.operations) {
    if (!operation.id || !operation.source || !operation.evidence || !operation.route_pattern || !operation.methods.length) errors.push(`OPERATION_REQUIRED_FIELD_MISSING:${operation.id || "UNKNOWN"}`);
    try { new RegExp(operation.route_pattern); } catch { errors.push(`OPERATION_ROUTE_PATTERN_INVALID:${operation.id}`); }
    if (!policy.reviewed_handler_sources.includes(operation.source) && operation.source !== "app/lib/selfhost-api.ts") errors.push(`OPERATION_SOURCE_NOT_REVIEWED_HANDLER:${operation.id}`);
    if (!lineForEvidence(operation.source, operation.evidence)) errors.push(`OPERATION_EVIDENCE_NOT_FOUND:${operation.id}`);
    for (const method of operation.methods) if (method !== method.toUpperCase()) errors.push(`OPERATION_METHOD_NOT_UPPERCASE:${operation.id}:${method}`);
    const permissions = [...(operation.permissions_all ?? []), ...(operation.permissions_any ?? [])];
    if (operation.universal_role_access_reason && operation.universal_role_access_reason !== APPLICATION_AUTHORIZATION_ALL_EMPLOYEE_READ_PENDING) errors.push(`OPERATION_UNIVERSAL_ROLE_REASON_INVALID:${operation.id}`);
    if (operation.access === "PROTECTED" && permissions.length === 0) errors.push(`PROTECTED_OPERATION_WITHOUT_PERMISSION:${operation.id}`);
    if (operation.access !== "PROTECTED" && permissions.length) errors.push(`NON_PROTECTED_OPERATION_HAS_ROLE_PERMISSION:${operation.id}`);
    for (const permission of permissions) {
      if (!PERMISSION_PATTERN.test(permission)) errors.push(`OPERATION_PERMISSION_INVALID:${operation.id}:${permission}`);
      const domain = domainForPermission(permission, policy);
      if (!domain) errors.push(`OPERATION_PERMISSION_DOMAIN_UNKNOWN:${operation.id}:${permission}`);
      else if (domain !== operation.data_domain && operation.data_domain !== "CROSS_DOMAIN") errors.push(`OPERATION_DOMAIN_MISMATCH:${operation.id}:${permission}:${domain}:${operation.data_domain}`);
    }
    const writes = operation.methods.some((method) => !SAFE_METHODS.has(method));
    if (writes && operation.csrf === "NOT_APPLICABLE") errors.push(`WRITE_CSRF_CONTRACT_MISSING:${operation.id}`);
    if (writes && operation.idempotency === "NOT_APPLICABLE") errors.push(`WRITE_IDEMPOTENCY_CONTRACT_MISSING:${operation.id}`);
    if (writes && operation.audit === "NOT_APPLICABLE") errors.push(`WRITE_AUDIT_CONTRACT_MISSING:${operation.id}`);
  }
}

function dispatcherBaseline(operation: PolicyOperation): string[] {
  return operation.source === "app/lib/selfhost-api.ts"
    || operation.source === "app/lib/identity-selfhost/handler.ts"
    || operation.source === "app/lib/dashboard-selfhost/handler.ts"
    || operation.source === "app/lib/material-import-fallback/handler.ts"
    ? [] : ["material.read"];
}

function roleDecision(role: IdentityRole, operation: PolicyOperation, rolePermissions: Record<string, string[]>): { decision: "ALLOW" | "DENY"; reason: string; wildcard: boolean } {
  if (operation.access === "PUBLIC") return { decision: "ALLOW", reason: "PUBLIC_ROUTE", wildcard: false };
  if (operation.access === "SELF_SERVICE") return { decision: "ALLOW", reason: "AUTHENTICATED_SELF_SERVICE", wildcard: false };
  if (operation.access === "RETIRED" || operation.access === "OFFLINE_FORBIDDEN") return { decision: "DENY", reason: operation.access, wildcard: false };
  const granted = new Set(rolePermissions[role]);
  const wildcard = granted.has("*");
  const all = [...dispatcherBaseline(operation), ...(operation.permissions_all ?? [])];
  const any = operation.permissions_any ?? [];
  const explicitAll = all.every((permission) => granted.has(permission));
  const explicitAny = any.length === 0 || any.some((permission) => granted.has(permission));
  if (explicitAll && explicitAny) return { decision: "ALLOW", reason: "EXPLICIT_PERMISSION", wildcard: false };
  if (wildcard) return { decision: "ALLOW", reason: "ADMIN_WILDCARD", wildcard: true };
  return { decision: "DENY", reason: "PERMISSION_MISSING", wildcard: false };
}

export function buildAuthorizationMatrix(policy: Policy = readJson<Policy>(POLICY_PATH)): { artifact: Record<string, Json>; errors: string[] } {
  policy = { ...policy, operations: APPLICATION_AUTHORIZATION_OPERATIONS_V1.map((operation) => ({ ...operation })) as PolicyOperation[] };
  const errors: string[] = [];
  validatePolicyShape(policy, errors);

  const actualHandlers = dispatcherHandlerSources();
  const expectedHandlers = [...policy.reviewed_handler_sources].sort();
  if (canonical(actualHandlers as unknown as Json) !== canonical(expectedHandlers as unknown as Json)) errors.push("DISPATCHER_HANDLER_SET_DRIFT");

  const authSources = authorizationSources(policy);
  const manifest = sourceManifest(authSources);
  if (manifest.sha256 !== policy.reviewed_authorization_source_manifest_sha256) errors.push(`AUTHORIZATION_SOURCE_MANIFEST_DRIFT:${manifest.sha256}`);

  const rolePermissions = Object.fromEntries(IDENTITY_ROLES.map((role) => [role, permissionsForRole(role)])) as Record<IdentityRole, string[]>;
  const wildcardRoles = IDENTITY_ROLES.filter((role) => rolePermissions[role].includes("*"));
  if (canonical(wildcardRoles as unknown as Json) !== canonical([...policy.wildcard_roles] as unknown as Json)) errors.push("RUNTIME_WILDCARD_ROLE_DRIFT");
  const permissionCatalog = [...new Set(IDENTITY_ROLES.flatMap((role) => rolePermissions[role]).filter((permission) => permission !== "*"))].sort();
  const catalogSet = new Set(permissionCatalog);
  const usedPermissions = permissionLiterals(authSources, policy);
  for (const permission of usedPermissions) if (!catalogSet.has(permission)) errors.push(`USED_PERMISSION_NOT_GRANTED:${permission}`);
  const exceptionMap = new Map(policy.permission_usage_exceptions.map((item) => [item.permission, item.reason]));
  for (const permission of permissionCatalog) if (!usedPermissions.includes(permission) && !exceptionMap.has(permission)) errors.push(`GRANTED_PERMISSION_NOT_USED:${permission}`);
  for (const permission of exceptionMap.keys()) if (!catalogSet.has(permission)) errors.push(`PERMISSION_USAGE_EXCEPTION_UNKNOWN:${permission}`);

  const dashboardDomainNames = [...new Set(Object.values(DASHBOARD_ROLE_DOMAINS).flat())].sort();
  if (canonical(Object.keys(policy.dashboard_domain_permissions).sort() as unknown as Json) !== canonical(dashboardDomainNames as unknown as Json)) errors.push("DASHBOARD_DOMAIN_POLICY_DRIFT");
  for (const role of IDENTITY_ROLES) {
    const granted = new Set(rolePermissions[role]);
    for (const domain of DASHBOARD_ROLE_DOMAINS[role] ?? []) {
      const required = policy.dashboard_domain_permissions[domain] ?? [];
      if (!required.length || !required.every((permission) => granted.has(permission) || granted.has("*"))) errors.push(`DASHBOARD_DOMAIN_PERMISSION_MISSING:${role}:${domain}`);
    }
  }

  const prefixExceptions = new Map(policy.route_prefix_literals.map((item) => [`${item.source}\u0000${item.literal}`, item.reason]));
  const routeSurfaces = expectedHandlers.map((source) => ({ source, literals: routeLiterals(source) }));
  for (const surface of routeSurfaces) {
    const operations = policy.operations.filter((operation) => operation.source === surface.source);
    for (const literal of surface.literals) {
      if (literal.startsWith("/api/") && !literal.endsWith("/") && !literal.endsWith("-") && !operations.some((operation) => new RegExp(operation.route_pattern).test(literal))) {
        errors.push(`ROUTE_LITERAL_NOT_COVERED:${surface.source}:${literal}`);
      }
      if (literal.startsWith("/api/") && (literal.endsWith("/") || literal.endsWith("-")) && !prefixExceptions.has(`${surface.source}\u0000${literal}`)) errors.push(`ROUTE_PREFIX_NOT_REVIEWED:${surface.source}:${literal}`);
    }
  }
  for (const key of prefixExceptions.keys()) {
    const [source, literal] = key.split("\u0000");
    if (!routeSurfaces.find((item) => item.source === source)?.literals.includes(literal)) errors.push(`ROUTE_PREFIX_EXCEPTION_STALE:${source}:${literal}`);
  }

  const operations = policy.operations.map((operation) => {
    const decisions = Object.fromEntries(IDENTITY_ROLES.map((role) => [role, roleDecision(role, operation, rolePermissions)]));
    const allowedRoles = IDENTITY_ROLES.filter((role) => decisions[role].decision === "ALLOW");
    const deniedRoles = IDENTITY_ROLES.filter((role) => decisions[role].decision === "DENY");
    const universalRoleAccess = operation.access === "PROTECTED" && deniedRoles.length === 0;
    if (operation.access === "PROTECTED" && !allowedRoles.length) errors.push(`PROTECTED_OPERATION_WITHOUT_ALLOW_ROLE:${operation.id}`);
    if (universalRoleAccess && operation.methods.some((method) => !SAFE_METHODS.has(method))) errors.push(`PROTECTED_WRITE_WITHOUT_DENY_ROLE:${operation.id}`);
    if (operation.access === "PROTECTED" && allowedRoles.length === 1 && allowedRoles[0] === "admin" && decisions.admin.wildcard) errors.push(`ADMIN_WILDCARD_IS_SOLE_ALLOW:${operation.id}`);
    return {
      ...operation,
      ...(universalRoleAccess ? { universal_role_access_reason: APPLICATION_AUTHORIZATION_ALL_EMPLOYEE_READ_PENDING } : {}),
      dispatcher_permissions_all: dispatcherBaseline(operation),
      source_line: lineForEvidence(operation.source, operation.evidence),
      allowed_roles: allowedRoles,
      denied_roles: deniedRoles,
      decisions,
    };
  });

  const dashboardDomains = Object.fromEntries(IDENTITY_ROLES.map((role) => [role, [...(DASHBOARD_ROLE_DOMAINS[role] ?? [])].sort()]));
  const body: Record<string, Json> = {
    schema_version: 1,
    authority: "SELFHOSTED_NODE_POSTGRESQL_SOURCE",
    approval: policy.approval as unknown as Json,
    source_manifest: manifest as unknown as Json,
    roles: [...IDENTITY_ROLES],
    wildcard_roles: wildcardRoles,
    permission_catalog: permissionCatalog,
    used_permissions: usedPermissions,
    permission_usage_exceptions: policy.permission_usage_exceptions as unknown as Json,
    role_permissions: rolePermissions as unknown as Json,
    dashboard_role_domains: dashboardDomains as unknown as Json,
    dashboard_domain_permissions: policy.dashboard_domain_permissions as unknown as Json,
    route_surfaces: routeSurfaces as unknown as Json,
    route_prefix_exceptions: policy.route_prefix_literals as unknown as Json,
    operations: operations as unknown as Json,
    readiness: {
      status: "BLOCKED",
      blockers: [
        "BUSINESS_APPROVAL_PENDING",
        ...(operations.some((operation) => operation.access === "PROTECTED" && operation.denied_roles.length === 0) ? ["ALL_EMPLOYEE_READ_SCOPE_REQUIRES_APPROVAL"] : []),
        ...(policy.permission_usage_exceptions.some((item) => item.classification === "LEGACY_GRANTED_NOT_REACHABLE") ? ["LEGACY_GRANTED_PERMISSIONS_REQUIRE_DISPOSITION"] : []),
      ],
    },
    validation: {
      result: errors.length ? "FAIL" : "PASS",
      error_count: errors.length,
      errors: [...errors].sort(),
    },
  };
  const artifactSha256 = sha256(canonical(body as Json));
  return { artifact: { ...body, artifact_sha256: artifactSha256 }, errors: [...errors].sort() };
}

function writeArtifact(artifact: Record<string, Json>): void {
  const temporary = `${ARTIFACT_PATH}.tmp`;
  writeFileSync(temporary, pretty(artifact), { mode: 0o644 });
  renameSync(temporary, ARTIFACT_PATH);
}

function audit(policy: Policy): void {
  const handlers = dispatcherHandlerSources();
  const sources = authorizationSources({ ...policy, reviewed_handler_sources: handlers });
  const manifest = sourceManifest(sources);
  const output = {
    handler_sources: handlers,
    authorization_sources: sources,
    authorization_source_manifest_sha256: manifest.sha256,
    route_surfaces: handlers.map((source) => ({ source, literals: routeLiterals(source) })),
    used_permissions: permissionLiterals(sources, policy),
  };
  process.stdout.write(pretty(output as unknown as Json));
}

function main(): void {
  const command = process.argv[2] ?? "verify";
  const policy = readJson<Policy>(POLICY_PATH);
  if (command === "audit") {
    audit(policy);
    return;
  }
  const result = buildAuthorizationMatrix(policy);
  if (result.errors.length) {
    for (const error of result.errors) process.stderr.write(`${error}\n`);
    process.exitCode = 1;
    return;
  }
  if (command === "write") {
    writeArtifact(result.artifact);
    process.stdout.write(`authorization matrix written: ${result.artifact.artifact_sha256}\n`);
    return;
  }
  if (command === "print") {
    process.stdout.write(pretty(result.artifact));
    return;
  }
  if (command !== "verify") throw new Error(`unknown command: ${command}`);
  const expected = pretty(result.artifact);
  const actual = readFileSync(ARTIFACT_PATH, "utf8");
  if (actual !== expected) throw new Error("AUTHORIZATION_MATRIX_ARTIFACT_DRIFT");
  process.stdout.write(`authorization matrix verified: ${result.artifact.artifact_sha256}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
