import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MATERIAL_ATTRIBUTES as MATERIAL_ATTRIBUTES_V1,
  MATERIAL_CATEGORIES as MATERIAL_CATEGORIES_V1,
  MATERIAL_CATEGORY_BINDINGS as MATERIAL_CATEGORY_BINDINGS_V1,
  MATERIAL_CATEGORY_SEED_VERSION as MATERIAL_CATEGORY_SEED_VERSION_V1,
} from "../seeds/material-category-v1.ts";
import {
  MATERIAL_ATTRIBUTES,
  MATERIAL_CATEGORIES,
  MATERIAL_CATEGORY_BINDINGS,
  MATERIAL_CATEGORY_SEED_VERSION,
  validateMaterialCategorySeed,
} from "../seeds/material-category-v2.ts";
import {
  AdminInitializationError,
  closeAdminRuntime,
  runAdminInitializationTransaction,
} from "../scripts/init-admin.ts";

const byCode = (items) => new Map(items.map((item) => [item.code, item]));
const byCategory = (items) => new Map(items.map((item) => [item.categoryCode, item]));
const sorted = (values) => [...values].sort((left, right) => left.localeCompare(right, "en"));

test("metadata v2 extends the immutable v1 declarations without dropping existing categories or attributes", () => {
  assert.equal(MATERIAL_CATEGORY_SEED_VERSION_V1, "material-category-v1");
  assert.equal(MATERIAL_CATEGORY_SEED_VERSION, "material-category-v2");
  assert.doesNotThrow(() => validateMaterialCategorySeed());

  const categories = byCode(MATERIAL_CATEGORIES);
  const attributes = byCode(MATERIAL_ATTRIBUTES);
  assert.equal(MATERIAL_CATEGORIES.length, MATERIAL_CATEGORIES_V1.length + 6);
  assert.equal(MATERIAL_ATTRIBUTES.length, MATERIAL_ATTRIBUTES_V1.length + 4);
  for (const item of MATERIAL_CATEGORIES_V1) assert.deepEqual(categories.get(item.code), item, item.code);
  const precisionOverrides = new Map([
    ["RESISTANCE", 6],
    ["POWER", 6],
    ["CAPACITANCE", 18],
    ["INDUCTANCE", 12],
    ["RATED_VOLTAGE", 6],
    ["PITCH", 6],
  ]);
  for (const item of MATERIAL_ATTRIBUTES_V1) {
    assert.deepEqual(attributes.get(item.code), precisionOverrides.has(item.code) ? { ...item, scale: precisionOverrides.get(item.code) } : item, item.code);
  }

  assert.equal(byCode(MATERIAL_CATEGORIES_V1).has("OSC_SMD"), false);
  assert.equal(byCode(MATERIAL_ATTRIBUTES_V1).has("DIELECTRIC"), false);
  assert.deepEqual(categories.get("PASS_OSCILLATOR"), {
    code: "PASS_OSCILLATOR",
    name: "晶振/振荡器",
    parentCode: "EL_PASSIVE",
    level: 3,
    sortOrder: 40,
  });
  assert.deepEqual(categories.get("OSC_SMD"), {
    code: "OSC_SMD",
    name: "贴片晶振",
    parentCode: "PASS_OSCILLATOR",
    level: 4,
    sortOrder: 10,
  });
  assert.deepEqual(categories.get("IC_SOT"), {
    code: "IC_SOT",
    name: "SOT/SC 封装 IC",
    parentCode: "SEMI_IC",
    level: 4,
    sortOrder: 30,
  });
  assert.deepEqual(categories.get("IC_SMD_OTHER"), {
    code: "IC_SMD_OTHER",
    name: "其他贴片封装 IC",
    parentCode: "SEMI_IC",
    level: 4,
    sortOrder: 90,
  });
  assert.deepEqual(categories.get("TRANS_SMD"), {
    code: "TRANS_SMD",
    name: "贴片三极管/晶体管",
    parentCode: "SEMI_TRANS",
    level: 4,
    sortOrder: 10,
  });
  assert.deepEqual(attributes.get("DIELECTRIC"), { code: "DIELECTRIC", name: "介质", type: "TEXT" });
  assert.deepEqual(attributes.get("RATED_CURRENT"), { code: "RATED_CURRENT", name: "额定电流", type: "DECIMAL", unit: "A", scale: 6 });
  assert.deepEqual(attributes.get("STRUCTURE"), { code: "STRUCTURE", name: "结构", type: "TEXT" });
  assert.deepEqual(attributes.get("FREQUENCY"), { code: "FREQUENCY", name: "频率", type: "DECIMAL", unit: "Hz", scale: 0 });
  assert.equal(attributes.get("CAPACITANCE").scale, 18);
  assert.equal(attributes.get("INDUCTANCE").scale, 12);
  assert.equal(attributes.get("RESISTANCE").scale, 6);
  assert.equal(attributes.get("POWER").scale, 6);
  assert.equal(attributes.get("RATED_VOLTAGE").scale, 6);
  assert.equal(attributes.get("PITCH").scale, 6);
});

test("governed passive, connector and oscillator leaves declare the required identity attributes", () => {
  const bindings = byCategory(MATERIAL_CATEGORY_BINDINGS);
  const expectedRequired = {
    RES_CHIP: ["PACKAGE", "RESISTANCE", "TOLERANCE", "POWER"],
    CAP_CHIP: ["PACKAGE", "CAPACITANCE", "RATED_VOLTAGE", "DIELECTRIC", "TOLERANCE"],
    IND_CHIP: ["PACKAGE", "INDUCTANCE", "RATED_CURRENT", "TOLERANCE"],
    CONN_BOARD_STD: ["BRAND", "MPN", "PIN_COUNT", "PITCH", "STRUCTURE"],
    CONN_FPC_STD: ["BRAND", "MPN", "PIN_COUNT", "PITCH", "STRUCTURE"],
    OSC_SMD: ["MPN", "PACKAGE", "FREQUENCY"],
    IC_BGA: ["MPN", "PACKAGE"],
    IC_QFN: ["MPN", "PACKAGE"],
    IC_SOT: ["MPN", "PACKAGE"],
    IC_SMD_OTHER: ["MPN", "PACKAGE"],
    DIODE_SMD: ["MPN", "PACKAGE"],
    MOS_SMD: ["MPN", "PACKAGE"],
    TRANS_SMD: ["MPN", "PACKAGE"],
  };
  for (const [categoryCode, requiredCodes] of Object.entries(expectedRequired)) {
    const item = bindings.get(categoryCode);
    assert.ok(item, categoryCode);
    assert.deepEqual(sorted(item.requiredCodes), sorted(requiredCodes), categoryCode);
    assert.ok(requiredCodes.every((code) => item.attributeCodes.includes(code)), categoryCode);
  }
  assert.ok(bindings.get("CAP_CHIP").attributeCodes.includes("BRAND"));
  assert.ok(bindings.get("CAP_CHIP").attributeCodes.includes("MPN"));
  assert.ok(bindings.get("IND_CHIP").attributeCodes.includes("POWER"));
  assert.equal(bindings.get("IND_CHIP").requiredCodes.includes("POWER"), false);
  assert.ok(bindings.get("CONN_BOARD_STD").attributeCodes.includes("PACKAGE"));
  assert.ok(bindings.get("OSC_SMD").attributeCodes.includes("BRAND"));
});

test("v2 preserves every unaffected v1 leaf binding and binds every level-4 category exactly once", () => {
  const overridden = new Set(["RES_CHIP", "CAP_CHIP", "IND_CHIP", "CONN_BOARD_STD", "CONN_FPC_STD", "IC_BGA", "IC_QFN", "DIODE_SMD", "MOS_SMD"]);
  const v2Bindings = byCategory(MATERIAL_CATEGORY_BINDINGS);
  for (const item of MATERIAL_CATEGORY_BINDINGS_V1) {
    if (!overridden.has(item.categoryCode)) assert.deepEqual(v2Bindings.get(item.categoryCode), item, item.categoryCode);
  }

  const leafCodes = MATERIAL_CATEGORIES.filter((item) => item.level === 4).map((item) => item.code);
  assert.equal(new Set(MATERIAL_CATEGORY_BINDINGS.map((item) => item.categoryCode)).size, MATERIAL_CATEGORY_BINDINGS.length);
  assert.deepEqual(sorted(MATERIAL_CATEGORY_BINDINGS.map((item) => item.categoryCode)), sorted(leafCodes));
  const attributeCodes = new Set(MATERIAL_ATTRIBUTES.map((item) => item.code));
  for (const item of MATERIAL_CATEGORY_BINDINGS) {
    assert.equal(new Set(item.attributeCodes).size, item.attributeCodes.length, item.categoryCode);
    assert.ok(item.requiredCodes.every((code) => item.attributeCodes.includes(code)), item.categoryCode);
    assert.ok(item.attributeCodes.every((code) => attributeCodes.has(code)), item.categoryCode);
  }
});

test("self-hosted admin initialization consumes v2 while the historical v1 seed remains independent", async () => {
  const source = await readFile(new URL("../scripts/init-admin.ts", import.meta.url), "utf8");
  assert.match(source, /from "\.\.\/seeds\/material-category-v2\.ts"/);
  assert.doesNotMatch(source, /from "\.\.\/seeds\/material-category-v1\.ts"/);
  assert.match(source, /validateMaterialCategorySeed\(\)/);
  assert.match(source, /seed_version: MATERIAL_CATEGORY_SEED_VERSION/);
});

test("admin initialization converts database and rollback failures to one stable non-leaking error", async () => {
  const sentinel = "TOP_SECRET_ADMIN_SENTINEL";
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql === "ROLLBACK") throw Object.assign(new Error(sentinel), { code: sentinel, detail: sentinel, path: `/run/${sentinel}` });
      return { rows: [] };
    },
  };
  await assert.rejects(
    runAdminInitializationTransaction(client, async () => {
      throw Object.assign(new Error(sentinel), { code: sentinel, detail: sentinel, password: sentinel });
    }),
    (error) => error instanceof AdminInitializationError
      && error.code === "ADMIN_INITIALIZATION_FAILED"
      && error.message === "ADMIN_INITIALIZATION_FAILED"
      && !JSON.stringify(error).includes(sentinel)
      && !error.stack.includes(sentinel),
  );
  assert.deepEqual(queries, ["BEGIN", "ROLLBACK"]);

  let released = 0;
  let closed = 0;
  await assert.doesNotReject(closeAdminRuntime({ release() {
    released += 1;
    throw Object.assign(new Error(sentinel), { path: `/run/${sentinel}` });
  } }, async () => {
    closed += 1;
    throw Object.assign(new Error(sentinel), { password: sentinel });
  }));
  assert.equal(released, 1);
  assert.equal(closed, 1);
});
