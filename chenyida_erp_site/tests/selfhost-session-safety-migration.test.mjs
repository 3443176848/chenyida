import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const migrationDirectory = new URL("../drizzle-postgres/", import.meta.url);
const metadataDirectory = new URL("../drizzle-postgres/meta/", import.meta.url);
const schemaFile = new URL("../db/schema.ts", import.meta.url);
const repositoryFile = new URL("../app/lib/identity-selfhost/repository.ts", import.meta.url);
const handlerFile = new URL("../app/lib/identity-selfhost/handler.ts", import.meta.url);
const apiFile = new URL("../app/lib/selfhost-api.ts", import.meta.url);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const frozenPrefixChecksums = [
  "c1cd71803b0f504594a41234a82eb13ce8e6713f5d346f3e49247b4921ff1702", "2d8d4facf54c950fa19d1346705aa0f549669544da1a87c2fc584c1fe8b7eb80",
  "8ce859551198a8a5a334665f68eee503590fa5472f3a6396f44670d2110dddbf", "1bb0eb9b7b3ddbe6c6058a75a04a4bbc69a088e201856f258a4c75728f64aa39",
  "e4f2dc62afb8908c7d5a1a0202639809c9dd3f3be3fc09f0ad469224e46ecdcc", "6e185d01a69c4bd132c577793ae72baceaa075e5beecc738bcdf4310430d7079",
  "0e9cf9327b37673eb09483035117d15789047862f348cd5eb7098476d62fd3a6", "49334afa405d03b61568559edcdffa68c232c899251181e3a27ff271aa1da80b",
  "351b322f562e39bf0e17cf16cd6da20de6d801ff33f7692300a85c15403874d7", "d60c4100f726d6572a9969c78cf06f64aa2f789d3a31d3be5fd58c22fa7dec35",
  "6d97c854ecd2fd47f4540c0403de097332f406c7d9f5155c2355dd44d5a57e3b", "64f065783769c0913af482402199b10f9224a1a81e52c30a3b8a087978bcd5bf",
  "8c52efe69d836fadf4f2841caab6dad140c51d0b78e37612cbcbac46076c45a1", "61f65ef3d588bfbf178f3dd9ba196886fa18fb3ecca119a151f6a3bc0bc5a99b",
  "419a80cb1ec3daad614f23b89895c9e8e3679bee40f506b0d0a811aba98a546f", "26d6e4cc609a53403b377d8550fcf5d8fd88f677178681f4cca1692544bb2076",
  "33cb162e5e32aeaca015a9d6e25a33f048166c7c895ebbc242819f6bbe2b6b28", "64276e1292c0696ae097a322115662b958156ba6486b1cd16752cf84b6c987c9",
  "6e517f6d2beffc74c94dcd5c5d60c9bcdc5baf9c93711a6add6cec4a08ed989a", "1164536d51fbcf2f022c45aeab54b2b1ebc3d20cb2e4caabba9341d63fb4e182",
  "1cf953d98da2d3a7703f3866b852cbe10bdb37b33e1826cb78b24079fc5a11ec", "65b31aec91ad30ffd309796f58500a73c47a20bc12f855e010a4b4f17e808155",
  "5f07c7aebe9513e040fa0ab2f31f5cd5a51faf64fe78516794cd0fd46309221d", "cab6f7679e91589cfe2c7fdecf9750b222b9212acbbd3341301c7a67ec2e9624",
  "39b1212df99d392739aa20b95859f3e2789fa287e23061006a34efc342c258f9", "b00e49aa4d4f8279372c5aab291ccfcbd54afc09ab284a6390a50fea9e66aca0",
  "b226cc958215400c38f48c925e4b33c4e97723340aaf729d4da75322213b9c76", "a7a55f7c6c81b1c5a80df59a1b3f639187cc2c2ce8658087ceb392b1f2ada912",
  "6814a728f4d04e4fbceb83c7a288fa214a9ec64317b547cc6cbaebfec456b40c", "37fd53b02f517023a3fc6aba22b0904a4881273b8752de2946f0c5432a2d050c",
  "ac0f6a63cfdb30d42edf50741afc7c8af632f74ff6fb08398d6b6e398a637fd4", "3a2fc22ff73706d226641119135b68d042d393124c89233a63d774f76aa2d4fa",
  "ca01cbc6a40ebfe9c17e9c3133f8704748d12b64c21d56155313ff73ce0c3d44", "29b380050d7d7003df82df981aea061e7287845dde773f181caf918a49d47b2d",
  "d64ec733bb937d8cde11d93d5370605fb7e754ffb0c93d2f9795c8d7b66c9714", "a5ad532837acb0c9704f5c885206cf2ec10c891628c7fe4ed660233468b134a0",
  "139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f", "2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941",
  "3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37", "b6781c94da3f52a8f719ce57cdf13acbb4e3fe1c66f2a0480bdb6a9ff10a5a93",
  "676626b9dcb78f31643612e5662cf5c36e06259c72ff922287bb913394071bf2", "c0eeab63bc51f1d1dd96805b43e78c83c5ef5e0a5d5712a08a0308c95b9385bf",
  "0fdb3d4b92d999a5dede5a36a08bd99ea054879ebb6857341e08f0f0e07852d9",
];

test("0044 is the sole append-only migration and freezes every published predecessor", async () => {
  const names = (await readdir(migrationDirectory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  assert.equal(names.length, 44);
  assert.equal(names.at(-1), "0044_identity_session_absolute_lifetime.sql");
  await assert.rejects(access(new URL("0045_identity_session_absolute_lifetime.sql", migrationDirectory)));
  const actual = await Promise.all(names.slice(0, 43).map(async (name) => sha256(await readFile(new URL(name, migrationDirectory)))));
  assert.deepEqual(actual, frozenPrefixChecksums);
});

test("0044 journal and snapshot change only app_sessions", async () => {
  const journal = JSON.parse(await readFile(new URL("_journal.json", metadataDirectory), "utf8"));
  assert.equal(journal.entries.length, 44);
  assert.deepEqual(journal.entries.at(-1), {
    idx: 44, version: "7", when: journal.entries.at(-1).when,
    tag: "0044_identity_session_absolute_lifetime", breakpoints: true,
  });
  assert.ok(Number.isSafeInteger(journal.entries.at(-1).when));
  const previous = JSON.parse(await readFile(new URL("0043_snapshot.json", metadataDirectory), "utf8"));
  const current = JSON.parse(await readFile(new URL("0044_snapshot.json", metadataDirectory), "utf8"));
  assert.equal(current.prevId, previous.id);
  const changed = new Set();
  for (const name of new Set([...Object.keys(previous.tables), ...Object.keys(current.tables)])) {
    if (JSON.stringify(previous.tables[name]) !== JSON.stringify(current.tables[name])) changed.add(name);
  }
  assert.deepEqual(changed, new Set(["public.app_sessions"]));
});

test("0044 binds idle and absolute deadlines, terminal reasons and immutable identity facts", async () => {
  const sql = await readFile(new URL("0044_identity_session_absolute_lifetime.sql", migrationDirectory), "utf8");
  const schema = await readFile(schemaFile, "utf8");
  for (const token of [
    'ADD COLUMN "absolute_expires_at" timestamp with time zone',
    '"absolute_expires_at"="created_at"+interval \'24 hours\'',
    '"expires_at"=least("expires_at","created_at"+interval \'24 hours\')',
    'ADD CONSTRAINT "app_sessions_deadline_ck"',
    'CREATE INDEX "app_sessions_active_absolute_expiry_idx"',
    "'IDLE_TIMEOUT'", "'ABSOLUTE_TIMEOUT'", "APP_SESSION_IDENTITY_IMMUTABLE",
  ]) assert.ok(sql.includes(token), `missing 0044 contract: ${token}`);
  assert.ok(sql.indexOf("UPDATE \"app_sessions\"") < sql.indexOf('ALTER COLUMN "absolute_expires_at" SET NOT NULL'));
  for (const token of ["absoluteExpiresAt", "app_sessions_active_absolute_expiry_idx", "app_sessions_deadline_ck", "IDLE_TIMEOUT", "ABSOLUTE_TIMEOUT"]) {
    assert.ok(schema.includes(token), `missing schema contract: ${token}`);
  }
});

test("authentication uses database time, ordered locks, bounded renewal and terminal audit", async () => {
  const repository = await readFile(repositoryFile, "utf8");
  const authentication = repository.slice(repository.indexOf("async authenticate("), repository.indexOf("async createSession("));
  assert.doesNotMatch(authentication, /Date\.now\(|new Date\(/);
  assert.ok(
    authentication.indexOf("select * from app_users where username=$1 for share")
      < authentication.indexOf("where token_hash=$1 and username=$2\n        for update"),
    "the authoritative user lock must precede the session row lock",
  );
  for (const token of [
    "for update", "absolute_expires_at<=now() absolute_expired", "expires_at<=now() idle_expired",
    "set expires_at=least(absolute_expires_at,now()+interval '${SESSION_HOURS} hours')",
    'action: "SESSION_EXPIRED"', 'safeDetails: { reason }', "terminalized.rowCount !== 1",
  ]) assert.ok(authentication.includes(token), `missing authentication contract: ${token}`);
  const creation = repository.slice(repository.indexOf("async createSession("), repository.indexOf("async revokeCurrentSession("));
  assert.match(creation, /app_users[\s\S]+for share[\s\S]+absolute_expires_at[\s\S]+SESSION_ABSOLUTE_HOURS/);
});

test("identity and generic protected routes clear both cookies for invalid token states", async () => {
  const handler = await readFile(handlerFile, "utf8");
  const api = await readFile(apiFile, "utf8");
  assert.match(handler, /state === "EXPIRED"[\s\S]+SESSION_EXPIRED/);
  assert.match(handler, /path === "\/api\/session"[\s\S]+context\.token_hash \? buildClearCookieHeaders/);
  assert.match(handler, /sessionGateFailure[\s\S]+SESSION_EXPIRED[\s\S]+SESSION_REVOKED/);
  assert.match(api, /identityContext\.token_hash && identityContext\.state !== "AUTHENTICATED" \? buildClearCookieHeaders/);
  assert.match(handler, /identityFailureResponse\(error: unknown, requestId: string, headers\?: HeadersInit\)/);
});
