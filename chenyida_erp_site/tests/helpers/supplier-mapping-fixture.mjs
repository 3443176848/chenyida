/**
 * Test-only compatibility for pre-governance fixtures that need an already
 * ACTIVE mapping as a foreign-key source. Production databases are rejected.
 */
async function requireIsolatedTestDatabase(client) {
  const name = String((await client.query("select current_database() name")).rows[0]?.name || "");
  if (!/(?:^|_)test(?:_|$)/i.test(name)) throw new Error("supplier mapping fixture writes require an isolated test database");
}

export async function withSupplierMappingFixtureTriggersDisabled(client, callback) {
  await requireIsolatedTestDatabase(client);
  await client.query("set local session_replication_role=replica");
  try { return await callback(); }
  finally { await client.query("set local session_replication_role=origin"); }
}

export async function insertActiveSupplierMappingFixture(pool, sql, values) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await withSupplierMappingFixtureTriggersDisabled(client, () => client.query(sql, values));
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}
