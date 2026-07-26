CREATE TABLE "production_routing_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"routing_version_id" bigint NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"event_type" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"actor" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_routing_events_status_ck" CHECK ("production_routing_events"."to_status" in ('DRAFT','SUBMITTED','RELEASED','SUPERSEDED','OBSOLETE'))
);
--> statement-breakpoint
CREATE TABLE "production_routing_headers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"routing_code" text NOT NULL,
	"product_id" bigint NOT NULL,
	"current_version_no" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	CONSTRAINT "production_routing_headers_version_ck" CHECK ("production_routing_headers"."current_version_no">0 and "production_routing_headers"."version">0)
);
--> statement-breakpoint
CREATE TABLE "production_routing_operations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"routing_version_id" bigint NOT NULL,
	"sequence_no" integer NOT NULL,
	"operation_code" text NOT NULL,
	"operation_name" text NOT NULL,
	"work_center_id" bigint NOT NULL,
	"setup_minutes" numeric(18, 6) DEFAULT '0' NOT NULL,
	"run_minutes_per_unit" numeric(18, 6) DEFAULT '0' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_routing_operations_sequence_ck" CHECK ("production_routing_operations"."sequence_no">0),
	CONSTRAINT "production_routing_operations_time_ck" CHECK ("production_routing_operations"."setup_minutes">=0 and "production_routing_operations"."run_minutes_per_unit">=0),
	CONSTRAINT "production_routing_operations_text_ck" CHECK (char_length(btrim("production_routing_operations"."operation_code")) between 1 and 40 and char_length(btrim("production_routing_operations"."operation_name")) between 1 and 200 and char_length("production_routing_operations"."description")<=2000)
);
--> statement-breakpoint
CREATE TABLE "production_routing_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"routing_header_id" bigint NOT NULL,
	"product_version_id" bigint NOT NULL,
	"version_no" integer NOT NULL,
	"version_code" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"canonical_digest" text,
	"remark" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"released_by" text,
	"released_at" timestamp with time zone,
	"request_id" uuid NOT NULL,
	CONSTRAINT "production_routing_versions_status_ck" CHECK ("production_routing_versions"."status" in ('DRAFT','SUBMITTED','RELEASED','SUPERSEDED','OBSOLETE')),
	CONSTRAINT "production_routing_versions_version_ck" CHECK ("production_routing_versions"."version_no">0 and "production_routing_versions"."version">0),
	CONSTRAINT "production_routing_versions_digest_ck" CHECK ("production_routing_versions"."canonical_digest" is null or "production_routing_versions"."canonical_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "production_routing_versions_release_ck" CHECK (("production_routing_versions"."status" in ('RELEASED','SUPERSEDED','OBSOLETE') and "production_routing_versions"."canonical_digest" is not null and "production_routing_versions"."released_by" is not null and "production_routing_versions"."released_at" is not null) or ("production_routing_versions"."status" in ('DRAFT','SUBMITTED') and "production_routing_versions"."canonical_digest" is null))
);
--> statement-breakpoint
CREATE TABLE "production_work_centers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_center_code" text NOT NULL,
	"name_cn" text NOT NULL,
	"work_center_type" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	CONSTRAINT "production_work_centers_code_ck" CHECK ("production_work_centers"."work_center_code" ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
	CONSTRAINT "production_work_centers_status_ck" CHECK ("production_work_centers"."status" in ('ACTIVE','INACTIVE')),
	CONSTRAINT "production_work_centers_version_ck" CHECK ("production_work_centers"."version">0),
	CONSTRAINT "production_work_centers_text_ck" CHECK (char_length(btrim("production_work_centers"."name_cn")) between 1 and 200 and char_length(btrim("production_work_centers"."work_center_type")) between 1 and 80 and char_length("production_work_centers"."description")<=2000)
);
--> statement-breakpoint
CREATE TABLE "production_work_order_routing_snapshot_operations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"snapshot_id" bigint NOT NULL,
	"source_routing_operation_id" bigint NOT NULL,
	"sequence_no" integer NOT NULL,
	"operation_code" text NOT NULL,
	"operation_name" text NOT NULL,
	"work_center_id" bigint NOT NULL,
	"work_center_code" text NOT NULL,
	"work_center_name" text NOT NULL,
	"setup_minutes" numeric(18, 6) NOT NULL,
	"run_minutes_per_unit" numeric(18, 6) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_work_order_routing_snapshot_ops_ck" CHECK ("production_work_order_routing_snapshot_operations"."sequence_no">0 and "production_work_order_routing_snapshot_operations"."setup_minutes">=0 and "production_work_order_routing_snapshot_operations"."run_minutes_per_unit">=0)
);
--> statement-breakpoint
CREATE TABLE "production_work_order_routing_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_order_id" bigint NOT NULL,
	"routing_header_id" bigint NOT NULL,
	"routing_version_id" bigint NOT NULL,
	"product_version_id" bigint NOT NULL,
	"routing_code" text NOT NULL,
	"routing_version_no" integer NOT NULL,
	"routing_version_code" text NOT NULL,
	"routing_digest" text NOT NULL,
	"released_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_work_order_routing_snapshots_digest_ck" CHECK ("production_work_order_routing_snapshots"."routing_digest" ~ '^[0-9a-f]{64}$' and "production_work_order_routing_snapshots"."routing_version_no">0)
);
--> statement-breakpoint
ALTER TABLE "production_routing_events" ADD CONSTRAINT "production_routing_events_routing_version_id_production_routing_versions_id_fk" FOREIGN KEY ("routing_version_id") REFERENCES "public"."production_routing_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_routing_events" ADD CONSTRAINT "production_routing_events_actor_app_users_username_fk" FOREIGN KEY ("actor") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_routing_headers" ADD CONSTRAINT "production_routing_headers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_routing_headers" ADD CONSTRAINT "production_routing_headers_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_routing_headers" ADD CONSTRAINT "production_routing_headers_updated_by_app_users_username_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_routing_operations" ADD CONSTRAINT "production_routing_operations_routing_version_id_production_routing_versions_id_fk" FOREIGN KEY ("routing_version_id") REFERENCES "public"."production_routing_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_routing_operations" ADD CONSTRAINT "production_routing_operations_work_center_id_production_work_centers_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."production_work_centers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_routing_operations" ADD CONSTRAINT "production_routing_operations_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_routing_versions" ADD CONSTRAINT "production_routing_versions_routing_header_id_production_routing_headers_id_fk" FOREIGN KEY ("routing_header_id") REFERENCES "public"."production_routing_headers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_routing_versions" ADD CONSTRAINT "production_routing_versions_product_version_id_product_versions_id_fk" FOREIGN KEY ("product_version_id") REFERENCES "public"."product_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_routing_versions" ADD CONSTRAINT "production_routing_versions_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_routing_versions" ADD CONSTRAINT "production_routing_versions_updated_by_app_users_username_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_routing_versions" ADD CONSTRAINT "production_routing_versions_submitted_by_app_users_username_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_routing_versions" ADD CONSTRAINT "production_routing_versions_released_by_app_users_username_fk" FOREIGN KEY ("released_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_centers" ADD CONSTRAINT "production_work_centers_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_centers" ADD CONSTRAINT "production_work_centers_updated_by_app_users_username_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_order_routing_snapshot_operations" ADD CONSTRAINT "production_work_order_routing_snapshot_operations_snapshot_id_production_work_order_routing_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."production_work_order_routing_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_order_routing_snapshot_operations" ADD CONSTRAINT "production_work_order_routing_snapshot_operations_source_routing_operation_id_production_routing_operations_id_fk" FOREIGN KEY ("source_routing_operation_id") REFERENCES "public"."production_routing_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_order_routing_snapshot_operations" ADD CONSTRAINT "production_work_order_routing_snapshot_operations_work_center_id_production_work_centers_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."production_work_centers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_order_routing_snapshots" ADD CONSTRAINT "production_work_order_routing_snapshots_work_order_id_production_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."production_work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_order_routing_snapshots" ADD CONSTRAINT "production_work_order_routing_snapshots_routing_header_id_production_routing_headers_id_fk" FOREIGN KEY ("routing_header_id") REFERENCES "public"."production_routing_headers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_order_routing_snapshots" ADD CONSTRAINT "production_work_order_routing_snapshots_routing_version_id_production_routing_versions_id_fk" FOREIGN KEY ("routing_version_id") REFERENCES "public"."production_routing_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_order_routing_snapshots" ADD CONSTRAINT "production_work_order_routing_snapshots_product_version_id_product_versions_id_fk" FOREIGN KEY ("product_version_id") REFERENCES "public"."product_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_order_routing_snapshots" ADD CONSTRAINT "production_work_order_routing_snapshots_released_by_app_users_username_fk" FOREIGN KEY ("released_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_routing_events_version_idx" ON "production_routing_events" USING btree ("routing_version_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_routing_headers_code_uq" ON "production_routing_headers" USING btree ("routing_code");--> statement-breakpoint
CREATE UNIQUE INDEX "production_routing_headers_product_uq" ON "production_routing_headers" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_routing_operations_sequence_uq" ON "production_routing_operations" USING btree ("routing_version_id","sequence_no");--> statement-breakpoint
CREATE UNIQUE INDEX "production_routing_operations_code_uq" ON "production_routing_operations" USING btree ("routing_version_id","operation_code");--> statement-breakpoint
CREATE INDEX "production_routing_operations_work_center_idx" ON "production_routing_operations" USING btree ("work_center_id","routing_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_routing_versions_header_no_uq" ON "production_routing_versions" USING btree ("routing_header_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "production_routing_versions_header_code_uq" ON "production_routing_versions" USING btree ("routing_header_id","version_code");--> statement-breakpoint
CREATE UNIQUE INDEX "production_routing_versions_current_product_uq" ON "production_routing_versions" USING btree ("product_version_id") WHERE "production_routing_versions"."status"='RELEASED';--> statement-breakpoint
CREATE INDEX "production_routing_versions_queue_idx" ON "production_routing_versions" USING btree ("status","submitted_at","id");--> statement-breakpoint
CREATE INDEX "production_routing_versions_product_idx" ON "production_routing_versions" USING btree ("product_version_id","status","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_work_centers_code_uq" ON "production_work_centers" USING btree ("work_center_code");--> statement-breakpoint
CREATE INDEX "production_work_centers_status_idx" ON "production_work_centers" USING btree ("status","work_center_code");--> statement-breakpoint
CREATE UNIQUE INDEX "production_work_order_routing_snapshot_ops_sequence_uq" ON "production_work_order_routing_snapshot_operations" USING btree ("snapshot_id","sequence_no");--> statement-breakpoint
CREATE UNIQUE INDEX "production_work_order_routing_snapshot_ops_source_uq" ON "production_work_order_routing_snapshot_operations" USING btree ("snapshot_id","source_routing_operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_work_order_routing_snapshots_wo_uq" ON "production_work_order_routing_snapshots" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "production_work_order_routing_snapshots_source_idx" ON "production_work_order_routing_snapshots" USING btree ("routing_version_id","id");
--> statement-breakpoint
CREATE FUNCTION cyd_production_routing_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
  IF current_setting('cyd.production_routing_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'production routing writes require ProductionRoutingService';
  END IF;
  IF TG_TABLE_NAME='production_work_centers' THEN
    IF TG_OP='UPDATE' AND NEW.work_center_code IS DISTINCT FROM OLD.work_center_code THEN RAISE EXCEPTION 'work center code is immutable'; END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_TABLE_NAME='production_routing_headers' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'routing headers cannot be deleted'; END IF;
    IF TG_OP='UPDATE' AND (NEW.routing_code IS DISTINCT FROM OLD.routing_code OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN RAISE EXCEPTION 'routing header identity is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='production_routing_versions' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'routing versions cannot be deleted'; END IF;
    IF TG_OP='UPDATE' THEN
      IF OLD.status='DRAFT' THEN
        IF NEW.status NOT IN ('DRAFT','SUBMITTED') THEN RAISE EXCEPTION 'draft routing transition invalid'; END IF;
      ELSIF OLD.status='SUBMITTED' THEN
        IF NEW.status NOT IN ('DRAFT','RELEASED') OR NEW.routing_header_id IS DISTINCT FROM OLD.routing_header_id OR NEW.product_version_id IS DISTINCT FROM OLD.product_version_id OR NEW.version_no IS DISTINCT FROM OLD.version_no OR NEW.version_code IS DISTINCT FROM OLD.version_code OR NEW.remark IS DISTINCT FROM OLD.remark OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN RAISE EXCEPTION 'submitted routing content is immutable'; END IF;
      ELSIF OLD.status='RELEASED' THEN
        IF NEW.status NOT IN ('SUPERSEDED','OBSOLETE') OR NEW.routing_header_id IS DISTINCT FROM OLD.routing_header_id OR NEW.product_version_id IS DISTINCT FROM OLD.product_version_id OR NEW.version_no IS DISTINCT FROM OLD.version_no OR NEW.version_code IS DISTINCT FROM OLD.version_code OR NEW.canonical_digest IS DISTINCT FROM OLD.canonical_digest OR NEW.remark IS DISTINCT FROM OLD.remark OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.updated_by IS DISTINCT FROM OLD.updated_by OR NEW.released_by IS DISTINCT FROM OLD.released_by OR NEW.released_at IS DISTINCT FROM OLD.released_at THEN RAISE EXCEPTION 'released routing content is immutable'; END IF;
      ELSE
        RAISE EXCEPTION 'historical routing version is immutable';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='production_routing_operations' THEN
    SELECT status INTO parent_status FROM production_routing_versions WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.routing_version_id ELSE NEW.routing_version_id END;
    IF parent_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'only draft routing operations may change'; END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'routing events are immutable'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER production_work_centers_service_guard BEFORE INSERT OR UPDATE OR DELETE ON production_work_centers FOR EACH ROW EXECUTE FUNCTION cyd_production_routing_guard();
--> statement-breakpoint
CREATE TRIGGER production_routing_headers_service_guard BEFORE INSERT OR UPDATE OR DELETE ON production_routing_headers FOR EACH ROW EXECUTE FUNCTION cyd_production_routing_guard();
--> statement-breakpoint
CREATE TRIGGER production_routing_versions_service_guard BEFORE INSERT OR UPDATE OR DELETE ON production_routing_versions FOR EACH ROW EXECUTE FUNCTION cyd_production_routing_guard();
--> statement-breakpoint
CREATE TRIGGER production_routing_operations_service_guard BEFORE INSERT OR UPDATE OR DELETE ON production_routing_operations FOR EACH ROW EXECUTE FUNCTION cyd_production_routing_guard();
--> statement-breakpoint
CREATE TRIGGER production_routing_events_service_guard BEFORE INSERT OR UPDATE OR DELETE ON production_routing_events FOR EACH ROW EXECUTE FUNCTION cyd_production_routing_guard();
--> statement-breakpoint
CREATE FUNCTION cyd_work_order_routing_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_row record; snapshot_row record;
BEGIN
  IF current_setting('cyd.production_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'work order routing snapshots require ProductionService'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'work order routing snapshots are immutable'; END IF;
  IF TG_TABLE_NAME='production_work_order_routing_snapshots' THEN
    SELECT rv.*,rh.routing_code,wo.product_version_id work_order_product_version_id INTO source_row
      FROM production_routing_versions rv JOIN production_routing_headers rh ON rh.id=rv.routing_header_id JOIN production_work_orders wo ON wo.id=NEW.work_order_id
      WHERE rv.id=NEW.routing_version_id AND rv.status='RELEASED';
    IF source_row.id IS NULL OR NEW.routing_header_id IS DISTINCT FROM source_row.routing_header_id OR NEW.product_version_id IS DISTINCT FROM source_row.product_version_id OR NEW.product_version_id IS DISTINCT FROM source_row.work_order_product_version_id OR NEW.routing_code IS DISTINCT FROM source_row.routing_code OR NEW.routing_version_no IS DISTINCT FROM source_row.version_no OR NEW.routing_version_code IS DISTINCT FROM source_row.version_code OR NEW.routing_digest IS DISTINCT FROM source_row.canonical_digest THEN RAISE EXCEPTION 'work order routing snapshot source mismatch'; END IF;
    RETURN NEW;
  END IF;
  SELECT s.*,o.sequence_no source_sequence_no,o.operation_code source_operation_code,o.operation_name source_operation_name,o.work_center_id source_work_center_id,o.setup_minutes source_setup_minutes,o.run_minutes_per_unit source_run_minutes,o.description source_description,w.work_center_code source_work_center_code,w.name_cn source_work_center_name INTO snapshot_row
    FROM production_work_order_routing_snapshots s JOIN production_routing_operations o ON o.id=NEW.source_routing_operation_id AND o.routing_version_id=s.routing_version_id JOIN production_work_centers w ON w.id=o.work_center_id WHERE s.id=NEW.snapshot_id;
  IF snapshot_row.id IS NULL OR NEW.sequence_no IS DISTINCT FROM snapshot_row.source_sequence_no OR NEW.operation_code IS DISTINCT FROM snapshot_row.source_operation_code OR NEW.operation_name IS DISTINCT FROM snapshot_row.source_operation_name OR NEW.work_center_id IS DISTINCT FROM snapshot_row.source_work_center_id OR NEW.work_center_code IS DISTINCT FROM snapshot_row.source_work_center_code OR NEW.work_center_name IS DISTINCT FROM snapshot_row.source_work_center_name OR NEW.setup_minutes IS DISTINCT FROM snapshot_row.source_setup_minutes OR NEW.run_minutes_per_unit IS DISTINCT FROM snapshot_row.source_run_minutes OR NEW.description IS DISTINCT FROM snapshot_row.source_description THEN RAISE EXCEPTION 'work order routing snapshot operation mismatch'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER production_work_order_routing_snapshots_guard BEFORE INSERT OR UPDATE OR DELETE ON production_work_order_routing_snapshots FOR EACH ROW EXECUTE FUNCTION cyd_work_order_routing_snapshot_guard();
--> statement-breakpoint
CREATE TRIGGER production_work_order_routing_snapshot_ops_guard BEFORE INSERT OR UPDATE OR DELETE ON production_work_order_routing_snapshot_operations FOR EACH ROW EXECUTE FUNCTION cyd_work_order_routing_snapshot_guard();
