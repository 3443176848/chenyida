import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildAuthorizationMatrix } from "../scripts/application-authorization-matrix.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const POLICY_PATH = new URL("../operations/application-authorization-policy-v1.json", import.meta.url);
const MATRIX_PATH = new URL("../operations/application-authorization-matrix-v1.json", import.meta.url);
const ROLES = ["admin", "manager", "purchase", "engineering", "planning", "production", "warehouse", "quality", "sales", "finance", "operations"];

const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]))
    : value;
const digest = (value) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const clone = (value) => structuredClone(value);

const policy = JSON.parse(await readFile(POLICY_PATH, "utf8"));
const matrix = JSON.parse(await readFile(MATRIX_PATH, "utf8"));
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const byId = new Map(matrix.operations.map((operation) => [operation.id, operation]));

test("01 canonical artifact replays from source and has a valid self digest", () => {
  const replay = buildAuthorizationMatrix(policy);
  assert.deepEqual(replay.errors, []);
  assert.deepEqual(replay.artifact, matrix);
  const { artifact_sha256: actual, ...body } = matrix;
  assert.equal(actual, digest(body));
  assert.equal(matrix.validation.result, "PASS");
});

test("02 exact eleven-role catalog and only admin wildcard are locked", () => {
  assert.deepEqual(matrix.roles, ROLES);
  assert.deepEqual(matrix.wildcard_roles, ["admin"]);
  assert.equal(Object.keys(matrix.role_permissions).length, 11);
  assert.equal(matrix.permission_catalog.length, 158);
  for (const role of ROLES) assert.deepEqual(matrix.role_permissions[role], [...matrix.role_permissions[role]].sort());
  assert.ok(matrix.role_permissions.admin.includes("*"));
  for (const role of ROLES.slice(1)) assert.ok(!matrix.role_permissions[role].includes("*"));
});

test("03 all dispatcher handlers and authorization sources are digest-bound", () => {
  assert.equal(matrix.route_surfaces.length, 30);
  assert.ok(matrix.source_manifest.files.length >= 51);
  assert.equal(matrix.source_manifest.sha256, policy.reviewed_authorization_source_manifest_sha256);
  assert.equal(new Set(matrix.source_manifest.files.map((item) => item.path)).size, matrix.source_manifest.files.length);
  assert.ok(matrix.source_manifest.files.some((item) => item.path === "operations/application-authorization-route-contract-v1.ts"));
  for (const operation of matrix.operations) {
    assert.ok(operation.source_line > 0, operation.id);
    assert.ok(matrix.source_manifest.files.some((item) => item.path === operation.source), operation.id);
  }
});

test("04 every protected operation has allow evidence and a deny or an explicit pending universal-read finding", () => {
  assert.equal(matrix.operations.length, 186);
  assert.equal(matrix.operations.filter((operation) => operation.access === "PROTECTED").length, 175);
  for (const operation of matrix.operations.filter((item) => item.access === "PROTECTED")) {
    assert.ok(operation.allowed_roles.length > 0, operation.id);
    assert.ok(operation.denied_roles.length > 0 || operation.universal_role_access_reason === "CURRENT_ALL_EMPLOYEE_READ_SCOPE_REQUIRES_BUSINESS_APPROVAL", operation.id);
    if (operation.denied_roles.length > 0) assert.equal(operation.universal_role_access_reason, undefined, operation.id);
    else assert.ok(operation.methods.every((method) => ["GET", "HEAD", "OPTIONS"].includes(method)), operation.id);
    assert.deepEqual(Object.keys(operation.decisions).sort(), [...ROLES].sort(), operation.id);
    if (operation.allowed_roles.length === 1 && operation.allowed_roles[0] === "admin") {
      assert.notEqual(operation.decisions.admin.reason, "ADMIN_WILDCARD", operation.id);
    }
  }
});

test("05 sensitive writes bind CSRF, idempotency and transactional audit contracts", () => {
  const protectedWrites = matrix.operations.filter((operation) => operation.access === "PROTECTED" && operation.methods.some((method) => !["GET", "HEAD", "OPTIONS"].includes(method)));
  assert.ok(protectedWrites.length >= 100);
  for (const operation of protectedWrites) {
    assert.equal(operation.csrf, "REQUIRED", operation.id);
    assert.equal(operation.idempotency, "REQUIRED", operation.id);
    assert.equal(operation.audit, "REQUIRED_TRANSACTIONAL", operation.id);
  }
  for (const operation of matrix.operations.filter((item) => ["RETIRED", "OFFLINE_FORBIDDEN"].includes(item.access))) {
    assert.equal(operation.csrf, "FORBIDDEN", operation.id);
    assert.equal(operation.idempotency, "FORBIDDEN", operation.id);
  }
});

test("06 selected segregation-of-duty allows and denies are explicit", () => {
  const expect = (id, role, decision) => assert.equal(byId.get(id)?.decisions[role]?.decision, decision, `${id}:${role}`);
  expect("identity.users.create", "admin", "ALLOW");
  expect("identity.users.create", "manager", "DENY");
  expect("finance.settle", "finance", "ALLOW");
  expect("finance.settle", "sales", "DENY");
  expect("fulfillment.receive", "warehouse", "ALLOW");
  expect("fulfillment.receive", "purchase", "DENY");
  expect("sourcing.award", "purchase", "ALLOW");
  expect("sourcing.award", "warehouse", "DENY");
  expect("sales.delivery-create", "sales", "ALLOW");
  expect("sales.delivery-create", "warehouse", "DENY");
  expect("sales.delivery-execute", "warehouse", "ALLOW");
  expect("sales.delivery-execute", "sales", "DENY");
  expect("material.review.approve", "operations", "ALLOW");
  expect("material.review.approve", "purchase", "DENY");
  expect("routing.manage", "engineering", "ALLOW");
  expect("routing.manage", "production", "DENY");
});

test("07 Dashboard domain exposure never exceeds required read permissions", () => {
  assert.deepEqual(Object.keys(matrix.dashboard_domain_permissions).sort(), ["engineering", "finance", "inventory", "material", "operations", "partners", "procurement", "production", "quality", "sales"]);
  for (const role of ROLES) {
    const granted = new Set(matrix.role_permissions[role]);
    for (const domain of matrix.dashboard_role_domains[role]) {
      for (const permission of matrix.dashboard_domain_permissions[domain]) {
        assert.ok(granted.has("*") || granted.has(permission), `${role}:${domain}:${permission}`);
      }
    }
  }
});

test("08 business approval and unresolved legacy grants remain fail-closed readiness blockers", () => {
  assert.equal(matrix.approval.status, "BUSINESS_APPROVAL_PENDING");
  assert.equal(matrix.readiness.status, "BLOCKED");
  assert.deepEqual(matrix.readiness.blockers, ["BUSINESS_APPROVAL_PENDING", "ALL_EMPLOYEE_READ_SCOPE_REQUIRES_APPROVAL", "LEGACY_GRANTED_PERMISSIONS_REQUIRE_DISPOSITION"]);
  const legacy = matrix.permission_usage_exceptions.filter((item) => item.classification === "LEGACY_GRANTED_NOT_REACHABLE").map((item) => item.permission).sort();
  assert.deepEqual(legacy, ["material.import.commit", "sales.reverse"]);
  assert.equal(matrix.operations.filter((operation) => operation.access === "PROTECTED" && operation.denied_roles.length === 0).length, 21);
});

test("09 policy mutation gates reject role, wildcard, approval, Dashboard and source drift", () => {
  const cases = [
    ["role", (value) => value.expected_roles.pop(), "ROLE_SET_OR_ORDER_DRIFT"],
    ["wildcard", (value) => value.wildcard_roles.push("manager"), "WILDCARD_ROLE_POLICY_INVALID"],
    ["approval", (value) => { value.approval.status = "APPROVED"; }, "BUSINESS_APPROVAL_MUST_REMAIN_PENDING"],
    ["dashboard", (value) => { delete value.dashboard_domain_permissions.finance; }, "DASHBOARD_DOMAIN_POLICY_DRIFT"],
    ["manifest", (value) => { value.reviewed_authorization_source_manifest_sha256 = "0".repeat(64); }, "AUTHORIZATION_SOURCE_MANIFEST_DRIFT"],
    ["handler", (value) => value.reviewed_handler_sources.pop(), "DISPATCHER_HANDLER_SET_DRIFT"],
  ];
  for (const [name, mutate, expected] of cases) {
    const changed = clone(policy);
    mutate(changed);
    const errors = buildAuthorizationMatrix(changed).errors;
    assert.ok(errors.some((error) => error.startsWith(expected)), `${name}:${errors.join(",")}`);
  }
});

test("10 policy, matrix and source roots stay inside the repository", () => {
  assert.ok(ROOT.startsWith("/"));
  assert.equal(packageJson.name, "chenyida-erp-selfhosted");
  for (const source of matrix.source_manifest.files.map((item) => item.path)) {
    assert.ok(!source.startsWith("/"));
    assert.ok(!source.includes(".."));
  }
});
