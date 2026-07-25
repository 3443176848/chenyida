import { fail } from "./errors.mjs";

export const MIGRATION_OPENING_ACTOR = "migration_opening_actor";
export const MIGRATION_OPENING_CAPABILITIES = Object.freeze(["migration.opening.plan", "migration.opening.post", "migration.opening.reverse", "migration.opening.read"]);

export function decimal6(value, field, { positive = false, allowZero = true } = {}) {
  const text = String(value);
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(text)) fail("MIGRATION_OPENING_PRECISION_EXCEEDED", `${field} 必须为最多六位小数`);
  const [whole, fraction = ""] = text.split(".");
  const scaled = BigInt(whole) * 1_000_000n + BigInt(`${whole.startsWith("-") ? "-" : ""}${fraction.padEnd(6, "0") || "0"}`);
  if (positive && scaled <= 0n) fail("MIGRATION_OPENING_AMOUNT_INVALID", `${field} 必须大于零`);
  if (!allowZero && scaled === 0n) fail("MIGRATION_OPENING_QUANTITY_INVALID", `${field} 不得为零`);
  if (!positive && scaled < 0n) fail("MIGRATION_OPENING_QUANTITY_INVALID", `${field} 不得为负数`);
  return { text, scaled };
}

export function validateInventoryOpening(command) {
  if (command.opening_type !== "INVENTORY" || command.location_code !== "MAIN" || command.lot_code !== "") fail("MIGRATION_OPENING_POSITION_INVALID", "库存期初仅允许 MAIN/空批次");
  const onHand = decimal6(command.on_hand_quantity, "on_hand_quantity", { positive: true });
  const frozen = decimal6(command.frozen_quantity, "frozen_quantity");
  if (frozen.scaled > onHand.scaled) fail("MIGRATION_OPENING_FROZEN_EXCEEDS_ON_HAND", "冻结量不得超过在手量");
  if (!command.material_key || !command.unit_key) fail("MIGRATION_OPENING_REFERENCE_MISSING", "库存期初内部引用缺失");
  return command;
}

export function validateFinanceOpening(command) {
  if (!new Set(["AR", "AP"]).has(command.direction) || command.opening_type !== command.direction) fail("MIGRATION_OPENING_DIRECTION_INVALID", "财务期初方向无效");
  if ((command.direction === "AR" && (!command.customer_key || command.supplier_key)) || (command.direction === "AP" && (!command.supplier_key || command.customer_key))) fail("MIGRATION_OPENING_COUNTERPARTY_INVALID", "AR/Customer 与 AP/Supplier 必须互斥且完整");
  if (command.currency_code !== "CNY") fail("MIGRATION_OPENING_CURRENCY_INVALID", "财务期初仅支持 CNY");
  decimal6(command.opening_outstanding_amount, "opening_outstanding_amount", { positive: true });
  return command;
}
