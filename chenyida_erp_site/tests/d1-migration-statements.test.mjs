import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";

import { splitD1MigrationStatements } from "../scripts/d1-migration-statements.mjs";

const BREAKPOINT = "--> statement-breakpoint";

async function withIsolatedD1(name, callback) {
  const mf = new Miniflare({
    modules: true,
    script: "export default {}",
    compatibilityDate: "2026-05-22",
    d1Databases: { DB: `migration-statements-${name}-${crypto.randomUUID()}` },
  });
  try {
    const { DB } = await mf.getBindings();
    await callback(DB);
  } finally {
    await mf.dispose();
  }
}

async function executeMigrationSql(DB, sql) {
  const statements = splitD1MigrationStatements(sql);
  if (statements.length > 0) await DB.batch(statements.map((statement) => DB.prepare(statement)));
  return statements;
}

test("ignores trailing line-comment-only statement", async () => {
  await withIsolatedD1("line-comment", async (DB) => {
    const statements = await executeMigrationSql(DB, `CREATE TABLE sample(id INTEGER);${BREAKPOINT}\n-- trailing; comment\n-- second line comment`);
    assert.equal(statements.length, 1);
    assert.ok(await DB.prepare("SELECT name FROM sqlite_master WHERE name='sample'").first());
  });
});

test("ignores block-comment-only statement", async () => {
  await withIsolatedD1("block-comment", async (DB) => {
    const statements = await executeMigrationSql(DB, `/* block; comment\n   only */${BREAKPOINT}\n/* another */`);
    assert.deepEqual(statements, []);
    assert.deepEqual(await DB.prepare("SELECT 1 AS ok").first(), { ok: 1 });
  });
});

test("ignores whitespace-only statement", async () => {
  await withIsolatedD1("whitespace", async (DB) => {
    const statements = await executeMigrationSql(DB, ` \r\n\t ${BREAKPOINT}  \n `);
    assert.deepEqual(statements, []);
    assert.deepEqual(await DB.prepare("SELECT 1 AS ok").first(), { ok: 1 });
  });
});

test("executes SQL preceded by line comments", async () => {
  await withIsolatedD1("leading-line", async (DB) => {
    const sql = "-- first\n-- second;\nCREATE TABLE sample(id INTEGER);";
    const statements = await executeMigrationSql(DB, sql);
    assert.deepEqual(statements, [sql]);
    assert.ok(await DB.prepare("SELECT name FROM sqlite_master WHERE name='sample'").first());
  });
});

test("executes SQL followed by trailing comments", async () => {
  await withIsolatedD1("trailing-line", async (DB) => {
    const sql = "CREATE TABLE sample(id INTEGER) -- retained trailing comment\n;";
    const statements = await executeMigrationSql(DB, sql);
    assert.deepEqual(statements, [sql]);
    assert.ok(await DB.prepare("SELECT name FROM sqlite_master WHERE name='sample'").first());
  });
});

test("preserves double-dash inside string literal", async () => {
  await withIsolatedD1("string-line-marker", async (DB) => {
    const sql = "CREATE TABLE sample(value TEXT);" + BREAKPOINT + "INSERT INTO sample VALUES('it''s -- literal');";
    await executeMigrationSql(DB, sql);
    assert.deepEqual(await DB.prepare("SELECT value FROM sample").first(), { value: "it's -- literal" });
  });
});

test("preserves block-comment markers inside string literal", async () => {
  await withIsolatedD1("string-block-marker", async (DB) => {
    const sql = "CREATE TABLE sample(value TEXT);" + BREAKPOINT + "INSERT INTO sample VALUES('/* literal */');";
    await executeMigrationSql(DB, sql);
    assert.deepEqual(await DB.prepare("SELECT value FROM sample").first(), { value: "/* literal */" });
  });
});

test("preserves semicolon inside string literal", async () => {
  await withIsolatedD1("string-semicolon", async (DB) => {
    const sql = "CREATE TABLE sample(value TEXT);" + BREAKPOINT + "INSERT INTO sample VALUES('left;right');";
    const statements = await executeMigrationSql(DB, sql);
    assert.equal(statements.length, 2);
    assert.deepEqual(await DB.prepare("SELECT value FROM sample").first(), { value: "left;right" });
  });
});

test("preserves SQL after mixed comments", async () => {
  await withIsolatedD1("mixed-comments", async (DB) => {
    const sql = " \n-- line\n/* block; */\nCREATE TABLE \"sample/*quoted*/\"(id INTEGER);";
    const statements = await executeMigrationSql(DB, sql);
    assert.deepEqual(statements, [sql]);
    assert.ok(await DB.prepare("SELECT name FROM sqlite_master WHERE name='sample/*quoted*/'").first());
  });
});

test("retains malformed fragments for D1 to reject", async () => {
  await withIsolatedD1("malformed", async (DB) => {
    const unclosedBlock = "/* not closed";
    const unclosedString = "SELECT 'not closed";
    assert.deepEqual(splitD1MigrationStatements(unclosedBlock), [unclosedBlock]);
    assert.deepEqual(splitD1MigrationStatements(unclosedString), [unclosedString]);
    await assert.rejects(executeMigrationSql(DB, unclosedBlock));
    await assert.rejects(executeMigrationSql(DB, unclosedString));
  });
});
