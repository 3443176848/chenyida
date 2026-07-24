CREATE TABLE "material_code_sequences" (
	"category_id" bigint PRIMARY KEY NOT NULL,
	"category_code" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_code_sequences_next_value_ck" CHECK ("material_code_sequences"."next_value" between 1 and 1000001),
	CONSTRAINT "material_code_sequences_category_code_ck" CHECK ("material_code_sequences"."category_code" ~ '^[A-Z][A-Z0-9_]{1,63}$')
);
--> statement-breakpoint
ALTER TABLE "material_code_sequences" ADD CONSTRAINT "material_code_sequences_category_id_material_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."material_categories"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "material_code_sequences_category_code_uq" ON "material_code_sequences" USING btree ("category_code");
--> statement-breakpoint
CREATE INDEX "material_master_review_queue_idx" ON "material_master" USING btree ("material_status", "submitted_at", "id");
--> statement-breakpoint
CREATE INDEX "material_versions_material_event_idx" ON "material_versions" USING btree ("material_id", "event_type", "version_no");
--> statement-breakpoint
ALTER TABLE "material_master" ADD CONSTRAINT "material_master_draft_code_ck" CHECK ("material_status" NOT IN ('DRAFT', 'PENDING_REVIEW') OR "internal_material_code" IS NULL);
--> statement-breakpoint
ALTER TABLE "material_master" ADD CONSTRAINT "material_master_active_code_ck" CHECK ("material_status" <> 'ACTIVE' OR "internal_material_code" IS NOT NULL);
