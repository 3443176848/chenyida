import assert from "node:assert/strict";
import test from "node:test";

import { resolveOriginPolicy } from "../app/lib/infrastructure/config.ts";
import { isStrictLoopbackOrigin, normalizePublicOrigin, requestOriginMatches } from "../app/lib/infrastructure/request-origin.ts";

function request(url, origin, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  if (origin !== undefined) headers.set("Origin", origin);
  return new Request(url, { headers });
}

test("direct same-origin and explicit TLS public origin are accepted", () => {
  assert.equal(requestOriginMatches(request("http://local.test/api/session", "http://local.test"), null), true);
  assert.equal(requestOriginMatches(
    request("http://43.135.148.43.nip.io:18888/api/me/password", "https://43.135.148.43.nip.io:18888"),
    "https://43.135.148.43.nip.io:18888",
  ), true);
  assert.equal(requestOriginMatches(
    request("http://43.135.148.43.nip.io:18888/api/me/password", "http://43.135.148.43.nip.io:18888"),
    "https://43.135.148.43.nip.io:18888",
  ), false);
  assert.equal(requestOriginMatches(
    request("http://43.135.148.43.nip.io:18888/api/me/password", "https://43.135.157.211.nip.io:18888"),
    "https://43.135.148.43.nip.io:18888",
  ), false);
});

test("missing, malformed, wildcard, wrong scheme, host, port, and path origins fail closed", () => {
  const internal = "http://43.135.148.43.nip.io:18888/api/me/password";
  const configured = "https://43.135.148.43.nip.io:18888";
  for (const origin of [
    undefined,
    "null",
    "https://43.135.148.43.nip.io",
    "http://43.135.148.43.nip.io:18888",
    "https://43.135.157.211.nip.io:18888",
    "https://evil.example:18888",
    "https://43.135.148.43.nip.io:18889",
    "https://43.135.148.43.nip.io:18888/path",
  ]) assert.equal(requestOriginMatches(request(internal, origin), configured), false, String(origin));
});

test("explicit UAT policy accepts only strict loopback browser and request origins", () => {
  const configured = "https://erp.example.test:18888";
  assert.equal(requestOriginMatches(
    request("http://127.0.0.1:3000/api/users", "http://127.0.0.1:43127"),
    configured,
    true,
  ), true);
  assert.equal(requestOriginMatches(
    request("http://localhost:3000/api/logout", "http://localhost:43128"),
    configured,
    true,
  ), true);
  assert.equal(requestOriginMatches(
    request("http://[::1]:3000/api/logout", "http://[::1]:43129"),
    configured,
    true,
  ), true);
  assert.equal(requestOriginMatches(
    request("http://127.0.0.1:3000/api/users", "http://127.0.0.1:43127"),
    configured,
    false,
  ), false);
});

test("UAT loopback policy rejects external, lookalike and proxy-header origins", () => {
  const configured = "https://erp.example.test:18888";
  const cases = [
    ["http://127.0.0.1:3000/api/users", "https://evil.example"],
    ["https://erp.example.test:18888/api/users", "http://127.0.0.1:43127"],
    ["http://127.0.0.2:3000/api/users", "http://127.0.0.1:43127"],
    ["http://127.0.0.1:3000/api/users", "http://127.0.0.2:43127"],
    ["http://localhost.evil:3000/api/users", "http://localhost:43127"],
    ["http://localhost:3000/api/users", "http://localhost.evil:43127"],
  ];
  for (const [url, origin] of cases) {
    assert.equal(requestOriginMatches(request(url, origin), configured, true), false, `${url} ${origin}`);
  }
  const forged = request("http://127.0.0.1:3000/api/users", "https://evil.example", {
    "X-Forwarded-Host": "127.0.0.1:43127",
    "X-Forwarded-Proto": "http",
    Forwarded: "host=127.0.0.1:43127;proto=http",
  });
  assert.equal(requestOriginMatches(forged, configured, true), false);
});

test("loopback recognition and deployment policy fail closed", () => {
  for (const origin of ["http://localhost:43127", "https://127.0.0.1", "http://[::1]:43127"]) {
    assert.equal(isStrictLoopbackOrigin(origin), true, origin);
  }
  for (const origin of ["ftp://localhost", "http://127.0.0.2", "http://localhost.evil", "http://user@localhost", "http://localhost/path"]) {
    assert.equal(isStrictLoopbackOrigin(origin), false, origin);
  }
  assert.deepEqual(resolveOriginPolicy("production", undefined, undefined), { deploymentClass: "production", allowUatLoopbackOrigin: false });
  assert.deepEqual(resolveOriginPolicy("production", "uat", "true"), { deploymentClass: "uat", allowUatLoopbackOrigin: true });
  assert.throws(() => resolveOriginPolicy("production", "production", "true"), /requires ERP_DEPLOYMENT_CLASS=uat/);
  assert.throws(() => resolveOriginPolicy("test", "staging", "false"), /ERP_DEPLOYMENT_CLASS/);
  assert.throws(() => resolveOriginPolicy("test", "test", "yes"), /ERP_UAT_ALLOW_LOOPBACK_ORIGIN/);
});

test("public origin configuration is canonical and rejects unsafe forms", () => {
  assert.equal(normalizePublicOrigin(undefined), null);
  assert.equal(normalizePublicOrigin(" HTTPS://ERP.EXAMPLE.COM:443/ "), "https://erp.example.com");
  for (const value of [
    "ftp://erp.example.com",
    "https://user:secret@erp.example.com",
    "https://*.example.com",
    "https://erp.example.com/path",
    "https://erp.example.com?query=1",
    "https://erp.example.com#fragment",
  ]) assert.throws(() => normalizePublicOrigin(value), /ERP_PUBLIC_ORIGIN/);
});
