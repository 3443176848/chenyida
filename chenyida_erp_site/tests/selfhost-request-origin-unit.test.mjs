import assert from "node:assert/strict";
import test from "node:test";

import { normalizePublicOrigin, requestOriginMatches } from "../app/lib/infrastructure/request-origin.ts";

function request(url, origin) {
  const headers = new Headers();
  if (origin !== undefined) headers.set("Origin", origin);
  return new Request(url, { headers });
}

test("direct same-origin and explicit TLS public origin are accepted", () => {
  assert.equal(requestOriginMatches(request("http://local.test/api/session", "http://local.test"), null), true);
  assert.equal(requestOriginMatches(
    request("http://43.135.157.211.nip.io:18888/api/me/password", "https://43.135.157.211.nip.io:18888"),
    "https://43.135.157.211.nip.io:18888",
  ), true);
  assert.equal(requestOriginMatches(
    request("http://43.135.157.211.nip.io:18888/api/me/password", "http://43.135.157.211.nip.io:18888"),
    "https://43.135.157.211.nip.io:18888",
  ), false);
});

test("missing, malformed, wildcard, wrong scheme, host, port, and path origins fail closed", () => {
  const internal = "http://43.135.157.211.nip.io:18888/api/me/password";
  const configured = "https://43.135.157.211.nip.io:18888";
  for (const origin of [
    undefined,
    "null",
    "https://43.135.157.211.nip.io",
    "http://43.135.157.211.nip.io:18888",
    "https://evil.example:18888",
    "https://43.135.157.211.nip.io:18889",
    "https://43.135.157.211.nip.io:18888/path",
  ]) assert.equal(requestOriginMatches(request(internal, origin), configured), false, String(origin));
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
