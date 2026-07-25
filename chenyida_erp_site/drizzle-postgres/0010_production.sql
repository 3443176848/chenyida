CREATE TABLE "material_customer_restrictions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"material_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_customer_restrictions_status_ck" CHECK ("material_customer_restrictions"."status" in ('ACTIVE','INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "production_bom_snapshot_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"snapshot_id" bigint NOT NULL,
	"source_bom_line_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"material_id" bigint NOT NULL,
	"quantity_per" numeric(24, 6) NOT NULL,
	"loss_rate" numeric(12, 8) NOT NULL,
	"unit_id" bigint NOT NULL,
	"process_stage" text DEFAULT '' NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_bom_snapshot_lines_quantity_ck" CHECK ("production_bom_snapshot_lines"."line_no">0 and "production_bom_snapshot_lines"."quantity_per">0 and "production_bom_snapshot_lines"."loss_rate">=0 and "production_bom_snapshot_lines"."loss_rate"<1)
);
--> statement-breakpoint
CREATE TABLE "production_bom_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_order_id" bigint NOT NULL,
	"bom_header_id" bigint NOT NULL,
	"bom_version_id" bigint NOT NULL,
	"product_version_id" bigint NOT NULL,
	"released_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_completion_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"completion_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"material_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"inventory_ledger_entry_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_completion_lines_quantity_ck" CHECK ("production_completion_lines"."line_no">0 and "production_completion_lines"."quantity">0)
);
--> statement-breakpoint
CREATE TABLE "production_completions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"completion_code" text NOT NULL,
	"work_order_id" bigint NOT NULL,
	"inventory_adjustment_id" bigint NOT NULL,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"reason" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_completions_status_ck" CHECK ("production_completions"."status"='POSTED')
);
--> statement-breakpoint
CREATE TABLE "production_material_issue_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"issue_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"requirement_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"inventory_ledger_entry_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_material_issue_lines_quantity_ck" CHECK ("production_material_issue_lines"."line_no">0 and "production_material_issue_lines"."quantity">0)
);
--> statement-breakpoint
CREATE TABLE "production_material_issues" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"issue_code" text NOT NULL,
	"work_order_id" bigint NOT NULL,
	"inventory_adjustment_id" bigint NOT NULL,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"reason" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_material_issues_status_ck" CHECK ("production_material_issues"."status"='POSTED')
);
--> statement-breakpoint
CREATE TABLE "production_material_requirements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_order_id" bigint NOT NULL,
	"snapshot_line_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"required_qty" numeric(24, 6) NOT NULL,
	"net_issued_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_material_requirements_quantity_ck" CHECK ("production_material_requirements"."required_qty">0 and "production_material_requirements"."net_issued_qty">=0 and "production_material_requirements"."net_issued_qty"<="production_material_requirements"."required_qty"),
	CONSTRAINT "production_material_requirements_version_ck" CHECK ("production_material_requirements"."version">0)
);
--> statement-breakpoint
CREATE TABLE "production_material_return_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"return_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"requirement_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"inventory_ledger_entry_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_material_return_lines_quantity_ck" CHECK ("production_material_return_lines"."line_no">0 and "production_material_return_lines"."quantity">0)
);
--> statement-breakpoint
CREATE TABLE "production_material_returns" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"return_code" text NOT NULL,
	"work_order_id" bigint NOT NULL,
	"inventory_adjustment_id" bigint NOT NULL,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"reason" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_material_returns_status_ck" CHECK ("production_material_returns"."status"='POSTED')
);
--> statement-breakpoint
CREATE TABLE "production_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_code" text NOT NULL,
	"work_order_id" bigint NOT NULL,
	"reported_qty" numeric(24, 6) NOT NULL,
	"good_qty" numeric(24, 6) NOT NULL,
	"scrap_qty" numeric(24, 6) NOT NULL,
	"process_stage" text NOT NULL,
	"operator_name" text NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_reports_quantity_ck" CHECK ("production_reports"."reported_qty">0 and "production_reports"."good_qty">=0 and "production_reports"."scrap_qty">=0 and "production_reports"."good_qty"+"production_reports"."scrap_qty"<="production_reports"."reported_qty")
);
--> statement-breakpoint
CREATE TABLE "production_work_order_status_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_order_id" bigint NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"event_type" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_work_order_status_events_to_ck" CHECK ("production_work_order_status_events"."to_status" in ('DRAFT','RELEASED','IN_PROGRESS','COMPLETED','CLOSED','CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "production_work_orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_order_code" text NOT NULL,
	"product_id" bigint NOT NULL,
	"product_version_id" bigint NOT NULL,
	"bom_version_id" bigint NOT NULL,
	"finished_material_id" bigint NOT NULL,
	"finished_unit_id" bigint NOT NULL,
	"planned_qty" numeric(24, 6) NOT NULL,
	"reported_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"good_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"scrap_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"completed_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"planned_start" timestamp with time zone,
	"planned_finish" timestamp with time zone,
	"owner" text DEFAULT '' NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_work_orders_status_ck" CHECK ("production_work_orders"."status" in ('DRAFT','RELEASED','IN_PROGRESS','COMPLETED','CLOSED','CANCELLED')),
	CONSTRAINT "production_work_orders_quantity_ck" CHECK ("production_work_orders"."planned_qty">0 and "production_work_orders"."reported_qty">=0 and "production_work_orders"."good_qty">=0 and "production_work_orders"."scrap_qty">=0 and "production_work_orders"."completed_qty">=0 and "production_work_orders"."completed_qty"<="production_work_orders"."planned_qty"),
	CONSTRAINT "production_work_orders_report_ck" CHECK ("production_work_orders"."good_qty"+"production_work_orders"."scrap_qty"<="production_work_orders"."reported_qty"),
	CONSTRAINT "production_work_orders_version_ck" CHECK ("production_work_orders"."version">0)
);
--> statement-breakpoint
ALTER TABLE "material_customer_restrictions" ADD CONSTRAINT "material_customer_restrictions_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_customer_restrictions" ADD CONSTRAINT "material_customer_restrictions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_customer_restrictions" ADD CONSTRAINT "material_customer_restrictions_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_bom_snapshot_lines" ADD CONSTRAINT "production_bom_snapshot_lines_snapshot_id_production_bom_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."production_bom_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_bom_snapshot_lines" ADD CONSTRAINT "production_bom_snapshot_lines_source_bom_line_id_bom_lines_id_fk" FOREIGN KEY ("source_bom_line_id") REFERENCES "public"."bom_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_bom_snapshot_lines" ADD CONSTRAINT "production_bom_snapshot_lines_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_bom_snapshot_lines" ADD CONSTRAINT "production_bom_snapshot_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_bom_snapshots" ADD CONSTRAINT "production_bom_snapshots_work_order_id_production_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."production_work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_bom_snapshots" ADD CONSTRAINT "production_bom_snapshots_bom_header_id_bom_headers_id_fk" FOREIGN KEY ("bom_header_id") REFERENCES "public"."bom_headers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_bom_snapshots" ADD CONSTRAINT "production_bom_snapshots_bom_version_id_bom_versions_id_fk" FOREIGN KEY ("bom_version_id") REFERENCES "public"."bom_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_bom_snapshots" ADD CONSTRAINT "production_bom_snapshots_product_version_id_product_versions_id_fk" FOREIGN KEY ("product_version_id") REFERENCES "public"."product_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_bom_snapshots" ADD CONSTRAINT "production_bom_snapshots_released_by_app_users_username_fk" FOREIGN KEY ("released_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_completion_lines" ADD CONSTRAINT "production_completion_lines_completion_id_production_completions_id_fk" FOREIGN KEY ("completion_id") REFERENCES "public"."production_completions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_completion_lines" ADD CONSTRAINT "production_completion_lines_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_completion_lines" ADD CONSTRAINT "production_completion_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_completion_lines" ADD CONSTRAINT "production_completion_lines_inventory_ledger_entry_id_inventory_ledger_entries_id_fk" FOREIGN KEY ("inventory_ledger_entry_id") REFERENCES "public"."inventory_ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_completions" ADD CONSTRAINT "production_completions_work_order_id_production_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."production_work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_completions" ADD CONSTRAINT "production_completions_inventory_adjustment_id_inventory_adjustments_id_fk" FOREIGN KEY ("inventory_adjustment_id") REFERENCES "public"."inventory_adjustments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_completions" ADD CONSTRAINT "production_completions_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_issue_lines" ADD CONSTRAINT "production_material_issue_lines_issue_id_production_material_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."production_material_issues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_issue_lines" ADD CONSTRAINT "production_material_issue_lines_requirement_id_production_material_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."production_material_requirements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_issue_lines" ADD CONSTRAINT "production_material_issue_lines_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_issue_lines" ADD CONSTRAINT "production_material_issue_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_issue_lines" ADD CONSTRAINT "production_material_issue_lines_inventory_ledger_entry_id_inventory_ledger_entries_id_fk" FOREIGN KEY ("inventory_ledger_entry_id") REFERENCES "public"."inventory_ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_issues" ADD CONSTRAINT "production_material_issues_work_order_id_production_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."production_work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_issues" ADD CONSTRAINT "production_material_issues_inventory_adjustment_id_inventory_adjustments_id_fk" FOREIGN KEY ("inventory_adjustment_id") REFERENCES "public"."inventory_adjustments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_issues" ADD CONSTRAINT "production_material_issues_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_requirements" ADD CONSTRAINT "production_material_requirements_work_order_id_production_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."production_work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_requirements" ADD CONSTRAINT "production_material_requirements_snapshot_line_id_production_bom_snapshot_lines_id_fk" FOREIGN KEY ("snapshot_line_id") REFERENCES "public"."production_bom_snapshot_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_requirements" ADD CONSTRAINT "production_material_requirements_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_requirements" ADD CONSTRAINT "production_material_requirements_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_return_lines" ADD CONSTRAINT "production_material_return_lines_return_id_production_material_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."production_material_returns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_return_lines" ADD CONSTRAINT "production_material_return_lines_requirement_id_production_material_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."production_material_requirements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_return_lines" ADD CONSTRAINT "production_material_return_lines_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_return_lines" ADD CONSTRAINT "production_material_return_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_return_lines" ADD CONSTRAINT "production_material_return_lines_inventory_ledger_entry_id_inventory_ledger_entries_id_fk" FOREIGN KEY ("inventory_ledger_entry_id") REFERENCES "public"."inventory_ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_returns" ADD CONSTRAINT "production_material_returns_work_order_id_production_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."production_work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_returns" ADD CONSTRAINT "production_material_returns_inventory_adjustment_id_inventory_adjustments_id_fk" FOREIGN KEY ("inventory_adjustment_id") REFERENCES "public"."inventory_adjustments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_returns" ADD CONSTRAINT "production_material_returns_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_reports" ADD CONSTRAINT "production_reports_work_order_id_production_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."production_work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_reports" ADD CONSTRAINT "production_reports_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_order_status_events" ADD CONSTRAINT "production_work_order_status_events_work_order_id_production_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."production_work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_order_status_events" ADD CONSTRAINT "production_work_order_status_events_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_orders" ADD CONSTRAINT "production_work_orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_orders" ADD CONSTRAINT "production_work_orders_product_version_id_product_versions_id_fk" FOREIGN KEY ("product_version_id") REFERENCES "public"."product_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_orders" ADD CONSTRAINT "production_work_orders_bom_version_id_bom_versions_id_fk" FOREIGN KEY ("bom_version_id") REFERENCES "public"."bom_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_orders" ADD CONSTRAINT "production_work_orders_finished_material_id_material_master_id_fk" FOREIGN KEY ("finished_material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_orders" ADD CONSTRAINT "production_work_orders_finished_unit_id_units_id_fk" FOREIGN KEY ("finished_unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_orders" ADD CONSTRAINT "production_work_orders_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_customer_restrictions_pair_uq" ON "material_customer_restrictions" USING btree ("material_id","customer_id");--> statement-breakpoint
CREATE INDEX "material_customer_restrictions_customer_idx" ON "material_customer_restrictions" USING btree ("customer_id","status","material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_bom_snapshot_lines_line_uq" ON "production_bom_snapshot_lines" USING btree ("snapshot_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "production_bom_snapshot_lines_source_uq" ON "production_bom_snapshot_lines" USING btree ("snapshot_id","source_bom_line_id");--> statement-breakpoint
CREATE INDEX "production_bom_snapshot_lines_material_idx" ON "production_bom_snapshot_lines" USING btree ("material_id","snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_bom_snapshots_wo_uq" ON "production_bom_snapshots" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "production_bom_snapshots_source_idx" ON "production_bom_snapshots" USING btree ("bom_version_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_completion_lines_line_uq" ON "production_completion_lines" USING btree ("completion_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "production_completion_lines_ledger_uq" ON "production_completion_lines" USING btree ("inventory_ledger_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_completions_code_uq" ON "production_completions" USING btree ("completion_code");--> statement-breakpoint
CREATE UNIQUE INDEX "production_completions_operation_uq" ON "production_completions" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_completions_inventory_uq" ON "production_completions" USING btree ("inventory_adjustment_id");--> statement-breakpoint
CREATE INDEX "production_completions_wo_idx" ON "production_completions" USING btree ("work_order_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_material_issue_lines_line_uq" ON "production_material_issue_lines" USING btree ("issue_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "production_material_issue_lines_requirement_uq" ON "production_material_issue_lines" USING btree ("issue_id","requirement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_material_issue_lines_ledger_uq" ON "production_material_issue_lines" USING btree ("inventory_ledger_entry_id");--> statement-breakpoint
CREATE INDEX "production_material_issue_lines_requirement_idx" ON "production_material_issue_lines" USING btree ("requirement_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_material_issues_code_uq" ON "production_material_issues" USING btree ("issue_code");--> statement-breakpoint
CREATE UNIQUE INDEX "production_material_issues_operation_uq" ON "production_material_issues" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_material_issues_inventory_uq" ON "production_material_issues" USING btree ("inventory_adjustment_id");--> statement-breakpoint
CREATE INDEX "production_material_issues_wo_idx" ON "production_material_issues" USING btree ("work_order_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_material_requirements_snapshot_line_uq" ON "production_material_requirements" USING btree ("snapshot_line_id");--> statement-breakpoint
CREATE INDEX "production_material_requirements_wo_material_idx" ON "production_material_requirements" USING btree ("work_order_id","material_id","id");--> statement-breakpoint
CREATE INDEX "production_material_requirements_wo_idx" ON "production_material_requirements" USING btree ("work_order_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_material_return_lines_line_uq" ON "production_material_return_lines" USING btree ("return_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "production_material_return_lines_requirement_uq" ON "production_material_return_lines" USING btree ("return_id","requirement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_material_return_lines_ledger_uq" ON "production_material_return_lines" USING btree ("inventory_ledger_entry_id");--> statement-breakpoint
CREATE INDEX "production_material_return_lines_requirement_idx" ON "production_material_return_lines" USING btree ("requirement_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_material_returns_code_uq" ON "production_material_returns" USING btree ("return_code");--> statement-breakpoint
CREATE UNIQUE INDEX "production_material_returns_operation_uq" ON "production_material_returns" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_material_returns_inventory_uq" ON "production_material_returns" USING btree ("inventory_adjustment_id");--> statement-breakpoint
CREATE INDEX "production_material_returns_wo_idx" ON "production_material_returns" USING btree ("work_order_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_reports_code_uq" ON "production_reports" USING btree ("report_code");--> statement-breakpoint
CREATE UNIQUE INDEX "production_reports_operation_uq" ON "production_reports" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "production_reports_wo_idx" ON "production_reports" USING btree ("work_order_id","reported_at","id");--> statement-breakpoint
CREATE INDEX "production_work_order_status_events_wo_idx" ON "production_work_order_status_events" USING btree ("work_order_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_work_orders_code_uq" ON "production_work_orders" USING btree ("work_order_code");--> statement-breakpoint
CREATE UNIQUE INDEX "production_work_orders_operation_uq" ON "production_work_orders" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "production_work_orders_status_idx" ON "production_work_orders" USING btree ("status","updated_at","id");--> statement-breakpoint
CREATE INDEX "production_work_orders_product_idx" ON "production_work_orders" USING btree ("product_id","created_at","id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_production_require_service_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.production_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'production projection writes require production service' USING ERRCODE='42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'production projections cannot be deleted' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_production_requirement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.production_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'production requirement writes require production service' USING ERRCODE='42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'production requirements cannot be deleted' USING ERRCODE='55000'; END IF;
  IF NEW.work_order_id IS DISTINCT FROM OLD.work_order_id OR NEW.snapshot_line_id IS DISTINCT FROM OLD.snapshot_line_id OR NEW.material_id IS DISTINCT FROM OLD.material_id OR NEW.unit_id IS DISTINCT FROM OLD.unit_id OR NEW.required_qty IS DISTINCT FROM OLD.required_qty THEN
    RAISE EXCEPTION 'production requirement source fields are immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_production_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'posted production records are immutable' USING ERRCODE='55000';
END $$;
--> statement-breakpoint
CREATE TRIGGER production_work_orders_service_guard BEFORE UPDATE OR DELETE ON production_work_orders FOR EACH ROW EXECUTE FUNCTION cyd_production_require_service_write();
--> statement-breakpoint
CREATE TRIGGER production_material_requirements_service_guard BEFORE UPDATE OR DELETE ON production_material_requirements FOR EACH ROW EXECUTE FUNCTION cyd_production_requirement_guard();
--> statement-breakpoint
CREATE TRIGGER production_bom_snapshots_immutable BEFORE UPDATE OR DELETE ON production_bom_snapshots FOR EACH ROW EXECUTE FUNCTION cyd_production_immutable();
--> statement-breakpoint
CREATE TRIGGER production_bom_snapshot_lines_immutable BEFORE UPDATE OR DELETE ON production_bom_snapshot_lines FOR EACH ROW EXECUTE FUNCTION cyd_production_immutable();
--> statement-breakpoint
CREATE TRIGGER production_status_events_immutable BEFORE UPDATE OR DELETE ON production_work_order_status_events FOR EACH ROW EXECUTE FUNCTION cyd_production_immutable();
--> statement-breakpoint
CREATE TRIGGER production_material_issues_immutable BEFORE UPDATE OR DELETE ON production_material_issues FOR EACH ROW EXECUTE FUNCTION cyd_production_immutable();
--> statement-breakpoint
CREATE TRIGGER production_material_issue_lines_immutable BEFORE UPDATE OR DELETE ON production_material_issue_lines FOR EACH ROW EXECUTE FUNCTION cyd_production_immutable();
--> statement-breakpoint
CREATE TRIGGER production_material_returns_immutable BEFORE UPDATE OR DELETE ON production_material_returns FOR EACH ROW EXECUTE FUNCTION cyd_production_immutable();
--> statement-breakpoint
CREATE TRIGGER production_material_return_lines_immutable BEFORE UPDATE OR DELETE ON production_material_return_lines FOR EACH ROW EXECUTE FUNCTION cyd_production_immutable();
--> statement-breakpoint
CREATE TRIGGER production_reports_immutable BEFORE UPDATE OR DELETE ON production_reports FOR EACH ROW EXECUTE FUNCTION cyd_production_immutable();
--> statement-breakpoint
CREATE TRIGGER production_completions_immutable BEFORE UPDATE OR DELETE ON production_completions FOR EACH ROW EXECUTE FUNCTION cyd_production_immutable();
--> statement-breakpoint
CREATE TRIGGER production_completion_lines_immutable BEFORE UPDATE OR DELETE ON production_completion_lines FOR EACH ROW EXECUTE FUNCTION cyd_production_immutable();
