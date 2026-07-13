CREATE TABLE material_api_rollback_guard (
  id INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO material_api_rollback_guard(id)
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM material_api_idempotency)
    OR EXISTS (SELECT 1 FROM material_api_rate_limit_buckets)
    OR EXISTS (SELECT 1 FROM audit_log WHERE route_code <> '' OR operation_id <> '')
  THEN NULL
  ELSE 1
END;
--> statement-breakpoint
DROP TABLE material_api_rollback_guard;
--> statement-breakpoint
DROP TABLE material_api_rate_limit_buckets;
--> statement-breakpoint
DROP TABLE material_api_idempotency;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE __old_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT 'success',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT INTO __old_audit_log(id, username, action, detail, request_id, result, created_at)
SELECT id, username, action, detail, request_id, result, created_at
FROM audit_log;
--> statement-breakpoint
DROP TABLE audit_log;
--> statement-breakpoint
ALTER TABLE __old_audit_log RENAME TO audit_log;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE INDEX audit_log_created_at_idx ON audit_log(created_at);
