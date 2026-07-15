CREATE TABLE material_import_batch_foundation_rollback_guard (id INTEGER NOT NULL);
--> statement-breakpoint
INSERT INTO material_import_batch_foundation_rollback_guard(id)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM material_import_batches)
  OR EXISTS (SELECT 1 FROM material_import_files)
  OR EXISTS (SELECT 1 FROM material_import_rows)
  OR EXISTS (SELECT 1 FROM material_import_events)
  OR EXISTS (SELECT 1 FROM material_import_idempotency)
THEN NULL ELSE 1 END;
--> statement-breakpoint
DROP TABLE material_import_batch_foundation_rollback_guard;
--> statement-breakpoint
DROP TABLE material_import_idempotency;
--> statement-breakpoint
DROP TABLE material_import_rows;
--> statement-breakpoint
DROP TABLE material_import_events;
--> statement-breakpoint
DROP TABLE material_import_files;
--> statement-breakpoint
DROP TABLE material_import_batches;
