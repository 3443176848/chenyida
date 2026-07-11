import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertSafeTestTarget, getEnvironmentProfiles, resolveEnvironment } from "../scripts/environment.mjs";

const safeTestEnvironment = {
  ERP_ENV: "test",
  ERP_TEST_URL: "http://127.0.0.1:3100",
  ERP_SITE_URL: "http://127.0.0.1:3100",
  ERP_API_URL: "http://127.0.0.1:3100/api",
  ERP_D1_PERSIST_PATH: join(tmpdir(), "chenyida-erp-test-unit", "d1"),
};

test("all three environment profiles define the required fields", () => {
  const profiles = getEnvironmentProfiles();
  for (const name of ["development", "test", "production"]) {
    assert.ok(profiles[name]);
    for (const field of ["database", "apiUrl", "siteUrl", "logLevel", "debug"]) {
      assert.notEqual(profiles[name][field], undefined, `${name}.${field}`);
    }
  }
  assert.doesNotMatch(profiles.production.apiUrl, /^https?:\/\//);
  assert.doesNotMatch(profiles.production.siteUrl, /^https?:\/\//);
});

test("production environment is rejected before a test operation", () => {
  assert.throws(
    () => assertSafeTestTarget({ ...safeTestEnvironment, ERP_ENV: "production" }),
    /ERP_ENV is production/,
  );
});

test("a public or HTTPS target is rejected", () => {
  assert.throws(
    () => assertSafeTestTarget({ ...safeTestEnvironment, ERP_TEST_URL: "https://example.invalid" }),
    /HTTP loopback test URL/,
  );
});

test("a non-temporary D1 path is rejected", () => {
  assert.throws(
    () => assertSafeTestTarget({ ...safeTestEnvironment, ERP_D1_PERSIST_PATH: process.cwd() }),
    /operating-system temporary directory/,
  );
});

test("an explicitly isolated local test target is accepted", () => {
  const result = assertSafeTestTarget(safeTestEnvironment);
  assert.equal(result.environment.name, "test");
  assert.equal(result.target.hostname, "127.0.0.1");
});

test("unknown environment names are rejected", () => {
  assert.throws(() => resolveEnvironment({ ERP_ENV: "staging" }), /must be development, test, or production/);
});
