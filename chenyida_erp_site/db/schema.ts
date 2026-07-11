import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const appUsers = sqliteTable("app_users", {
  username: text("username").primaryKey(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  isActive: integer("is_active").notNull().default(1),
  mustChangePassword: integer("must_change_password").notNull().default(1),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastLoginAt: text("last_login_at").notNull().default(""),
});

export const appSessions = sqliteTable(
  "app_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    username: text("username").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("app_sessions_username_idx").on(table.username)],
);

export const erpRecords = sqliteTable(
  "erp_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").notNull(),
    code: text("code").notNull(),
    dataJson: text("data_json").notNull().default("{}"),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("erp_records_kind_code_uq").on(table.kind, table.code),
    index("erp_records_kind_idx").on(table.kind),
  ],
);

export const inventoryBalances = sqliteTable("inventory_balances", {
  itemCode: text("item_code").primaryKey(),
  onHandQty: real("on_hand_qty").notNull().default(0),
  reservedQty: real("reserved_qty").notNull().default(0),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const inventoryTransactions = sqliteTable(
  "inventory_transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemCode: text("item_code").notNull(),
    txnType: text("txn_type").notNull(),
    qty: real("qty").notNull(),
    refType: text("ref_type").notNull().default(""),
    refNo: text("ref_no").notNull().default(""),
    beforeQty: real("before_qty").notNull().default(0),
    afterQty: real("after_qty").notNull().default(0),
    createdBy: text("created_by").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("inventory_transactions_item_idx").on(table.itemCode)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull().default(""),
    action: text("action").notNull(),
    detail: text("detail").notNull().default(""),
    requestId: text("request_id").notNull().default(""),
    result: text("result").notNull().default("success"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("audit_log_created_at_idx").on(table.createdAt)],
);

export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    username: text("username").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    statusCode: integer("status_code").notNull(),
    responseJson: text("response_json").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idempotency_keys_expires_at_idx").on(table.expiresAt)],
);
