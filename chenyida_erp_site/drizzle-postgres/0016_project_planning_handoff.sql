CREATE TABLE "project_planning_document_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"package_id" bigint NOT NULL,
	"project_document_link_id" bigint NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_planning_handoff_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"package_id" bigint NOT NULL,
	"project_id" bigint NOT NULL,
	"event_type" text NOT NULL,
	"actor" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_planning_handoff_events_type_ck" CHECK ("project_planning_handoff_events"."event_type" in ('SUBMITTED','ACCEPTED','RETURNED','RESUBMITTED')),
	CONSTRAINT "project_planning_handoff_events_reason_ck" CHECK (("project_planning_handoff_events"."event_type"='RETURNED' and char_length(btrim("project_planning_handoff_events"."reason")) between 1 and 1000) or ("project_planning_handoff_events"."event_type"<>'RETURNED' and char_length("project_planning_handoff_events"."reason")<=1000))
);
--> statement-breakpoint
CREATE TABLE "project_planning_package_bom_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"package_item_id" bigint NOT NULL,
	"source_bom_line_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"quantity_per" numeric(24, 6) NOT NULL,
	"loss_rate" numeric(12, 8) NOT NULL,
	"calculated_gross_quantity" numeric(24, 6) NOT NULL,
	"specification_snapshot" jsonb NOT NULL,
	"material_digest" text NOT NULL,
	"line_no" integer NOT NULL,
	CONSTRAINT "project_planning_package_bom_lines_values_ck" CHECK ("project_planning_package_bom_lines"."line_no">0 and "project_planning_package_bom_lines"."quantity_per">0 and "project_planning_package_bom_lines"."loss_rate">=0 and "project_planning_package_bom_lines"."loss_rate"<1 and "project_planning_package_bom_lines"."calculated_gross_quantity">0),
	CONSTRAINT "project_planning_package_bom_lines_digest_ck" CHECK ("project_planning_package_bom_lines"."material_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "project_planning_package_bom_lines_snapshot_ck" CHECK (jsonb_typeof("project_planning_package_bom_lines"."specification_snapshot")='object' and pg_column_size("project_planning_package_bom_lines"."specification_snapshot")<=65536)
);
--> statement-breakpoint
CREATE TABLE "project_planning_package_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"package_id" bigint NOT NULL,
	"requirement_item_id" bigint NOT NULL,
	"product_version_id" bigint NOT NULL,
	"bom_version_id" bigint NOT NULL,
	"required_quantity" numeric(24, 6) NOT NULL,
	"unit_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"source_digest" text NOT NULL,
	CONSTRAINT "project_planning_package_items_quantity_ck" CHECK ("project_planning_package_items"."required_quantity">0 and "project_planning_package_items"."line_no">0),
	CONSTRAINT "project_planning_package_items_digest_ck" CHECK ("project_planning_package_items"."source_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "project_planning_packages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" bigint NOT NULL,
	"package_version_no" integer NOT NULL,
	"requirement_version_id" bigint NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"target_delivery_date" date,
	"package_digest" text NOT NULL,
	"prepared_by" text NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"accepted_by" text,
	"accepted_at" timestamp with time zone,
	"returned_by" text,
	"returned_at" timestamp with time zone,
	"return_reason" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"request_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_planning_packages_status_ck" CHECK ("project_planning_packages"."status" in ('DRAFT','SUBMITTED','RETURNED','ACCEPTED')),
	CONSTRAINT "project_planning_packages_version_ck" CHECK ("project_planning_packages"."version">0 and "project_planning_packages"."package_version_no">0),
	CONSTRAINT "project_planning_packages_digest_ck" CHECK ("project_planning_packages"."package_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "project_planning_packages_submit_ck" CHECK (("project_planning_packages"."status"='DRAFT' and "project_planning_packages"."submitted_by" is null and "project_planning_packages"."submitted_at" is null) or ("project_planning_packages"."status"<>'DRAFT' and "project_planning_packages"."submitted_by" is not null and "project_planning_packages"."submitted_at" is not null)),
	CONSTRAINT "project_planning_packages_accept_ck" CHECK (("project_planning_packages"."status"='ACCEPTED' and "project_planning_packages"."accepted_by" is not null and "project_planning_packages"."accepted_at" is not null and "project_planning_packages"."returned_by" is null and "project_planning_packages"."returned_at" is null and "project_planning_packages"."return_reason"='') or "project_planning_packages"."status"<>'ACCEPTED'),
	CONSTRAINT "project_planning_packages_return_ck" CHECK (("project_planning_packages"."status"='RETURNED' and "project_planning_packages"."returned_by" is not null and "project_planning_packages"."returned_at" is not null and char_length(btrim("project_planning_packages"."return_reason")) between 1 and 1000 and "project_planning_packages"."accepted_by" is null and "project_planning_packages"."accepted_at" is null) or "project_planning_packages"."status"<>'RETURNED')
);
--> statement-breakpoint
CREATE TABLE "project_requirement_resolutions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" bigint NOT NULL,
	"requirement_version_id" bigint NOT NULL,
	"requirement_item_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"product_version_id" bigint NOT NULL,
	"bom_header_id" bigint NOT NULL,
	"bom_version_id" bigint NOT NULL,
	"resolved_by" text NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_users" DROP CONSTRAINT "app_users_role_ck";--> statement-breakpoint
ALTER TABLE "project_planning_document_links" ADD CONSTRAINT "project_planning_document_links_package_id_project_planning_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."project_planning_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_document_links" ADD CONSTRAINT "project_planning_document_links_project_document_link_id_project_document_links_id_fk" FOREIGN KEY ("project_document_link_id") REFERENCES "public"."project_document_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_document_links" ADD CONSTRAINT "project_planning_document_links_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_handoff_events" ADD CONSTRAINT "project_planning_handoff_events_package_id_project_planning_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."project_planning_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_handoff_events" ADD CONSTRAINT "project_planning_handoff_events_project_id_business_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."business_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_handoff_events" ADD CONSTRAINT "project_planning_handoff_events_actor_app_users_username_fk" FOREIGN KEY ("actor") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_package_bom_lines" ADD CONSTRAINT "project_planning_package_bom_lines_package_item_id_project_planning_package_items_id_fk" FOREIGN KEY ("package_item_id") REFERENCES "public"."project_planning_package_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_package_bom_lines" ADD CONSTRAINT "project_planning_package_bom_lines_source_bom_line_id_bom_lines_id_fk" FOREIGN KEY ("source_bom_line_id") REFERENCES "public"."bom_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_package_bom_lines" ADD CONSTRAINT "project_planning_package_bom_lines_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_package_bom_lines" ADD CONSTRAINT "project_planning_package_bom_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_package_items" ADD CONSTRAINT "project_planning_package_items_package_id_project_planning_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."project_planning_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_package_items" ADD CONSTRAINT "project_planning_package_items_requirement_item_id_project_requirement_items_id_fk" FOREIGN KEY ("requirement_item_id") REFERENCES "public"."project_requirement_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_package_items" ADD CONSTRAINT "project_planning_package_items_product_version_id_product_versions_id_fk" FOREIGN KEY ("product_version_id") REFERENCES "public"."product_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_package_items" ADD CONSTRAINT "project_planning_package_items_bom_version_id_bom_versions_id_fk" FOREIGN KEY ("bom_version_id") REFERENCES "public"."bom_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_package_items" ADD CONSTRAINT "project_planning_package_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_packages" ADD CONSTRAINT "project_planning_packages_project_id_business_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."business_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_packages" ADD CONSTRAINT "project_planning_packages_requirement_version_id_project_requirement_versions_id_fk" FOREIGN KEY ("requirement_version_id") REFERENCES "public"."project_requirement_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_packages" ADD CONSTRAINT "project_planning_packages_prepared_by_app_users_username_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_packages" ADD CONSTRAINT "project_planning_packages_submitted_by_app_users_username_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_packages" ADD CONSTRAINT "project_planning_packages_accepted_by_app_users_username_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_planning_packages" ADD CONSTRAINT "project_planning_packages_returned_by_app_users_username_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_requirement_resolutions" ADD CONSTRAINT "project_requirement_resolutions_project_id_business_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."business_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_requirement_resolutions" ADD CONSTRAINT "project_requirement_resolutions_requirement_version_id_project_requirement_versions_id_fk" FOREIGN KEY ("requirement_version_id") REFERENCES "public"."project_requirement_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_requirement_resolutions" ADD CONSTRAINT "project_requirement_resolutions_requirement_item_id_project_requirement_items_id_fk" FOREIGN KEY ("requirement_item_id") REFERENCES "public"."project_requirement_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_requirement_resolutions" ADD CONSTRAINT "project_requirement_resolutions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_requirement_resolutions" ADD CONSTRAINT "project_requirement_resolutions_product_version_id_product_versions_id_fk" FOREIGN KEY ("product_version_id") REFERENCES "public"."product_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_requirement_resolutions" ADD CONSTRAINT "project_requirement_resolutions_bom_header_id_bom_headers_id_fk" FOREIGN KEY ("bom_header_id") REFERENCES "public"."bom_headers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_requirement_resolutions" ADD CONSTRAINT "project_requirement_resolutions_bom_version_id_bom_versions_id_fk" FOREIGN KEY ("bom_version_id") REFERENCES "public"."bom_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_requirement_resolutions" ADD CONSTRAINT "project_requirement_resolutions_resolved_by_app_users_username_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_planning_document_links_package_document_uq" ON "project_planning_document_links" USING btree ("package_id","project_document_link_id");--> statement-breakpoint
CREATE INDEX "project_planning_document_links_package_idx" ON "project_planning_document_links" USING btree ("package_id","id");--> statement-breakpoint
CREATE INDEX "project_planning_handoff_events_project_idx" ON "project_planning_handoff_events" USING btree ("project_id","id");--> statement-breakpoint
CREATE INDEX "project_planning_handoff_events_package_idx" ON "project_planning_handoff_events" USING btree ("package_id","id");--> statement-breakpoint
CREATE INDEX "project_planning_handoff_events_request_idx" ON "project_planning_handoff_events" USING btree ("request_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_planning_package_bom_lines_item_line_uq" ON "project_planning_package_bom_lines" USING btree ("package_item_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "project_planning_package_bom_lines_item_source_uq" ON "project_planning_package_bom_lines" USING btree ("package_item_id","source_bom_line_id");--> statement-breakpoint
CREATE INDEX "project_planning_package_bom_lines_material_idx" ON "project_planning_package_bom_lines" USING btree ("material_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_planning_package_items_package_line_uq" ON "project_planning_package_items" USING btree ("package_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "project_planning_package_items_package_requirement_uq" ON "project_planning_package_items" USING btree ("package_id","requirement_item_id");--> statement-breakpoint
CREATE INDEX "project_planning_package_items_product_bom_idx" ON "project_planning_package_items" USING btree ("product_version_id","bom_version_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_planning_packages_project_version_uq" ON "project_planning_packages" USING btree ("project_id","package_version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "project_planning_packages_project_digest_uq" ON "project_planning_packages" USING btree ("project_id","package_digest");--> statement-breakpoint
CREATE INDEX "project_planning_packages_queue_idx" ON "project_planning_packages" USING btree ("status","submitted_at","id");--> statement-breakpoint
CREATE INDEX "project_planning_packages_project_idx" ON "project_planning_packages" USING btree ("project_id","package_version_no","id");--> statement-breakpoint
CREATE INDEX "project_planning_packages_preparer_idx" ON "project_planning_packages" USING btree ("prepared_by","status","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_requirement_resolutions_item_uq" ON "project_requirement_resolutions" USING btree ("requirement_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_requirement_resolutions_project_version_item_uq" ON "project_requirement_resolutions" USING btree ("project_id","requirement_version_id","requirement_item_id");--> statement-breakpoint
CREATE INDEX "project_requirement_resolutions_project_idx" ON "project_requirement_resolutions" USING btree ("project_id","requirement_version_id","requirement_item_id");--> statement-breakpoint
CREATE INDEX "project_requirement_resolutions_product_bom_idx" ON "project_requirement_resolutions" USING btree ("product_version_id","bom_version_id","id");--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_role_ck" CHECK ("app_users"."role" in ('admin','manager','purchase','engineering','planning','production','warehouse','quality','sales','finance','operations'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_planning_resolution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.planning_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'planning resolution writes require PlanningHandoffService' USING ERRCODE='42501';
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'planning resolutions cannot be deleted' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND (NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.requirement_version_id IS DISTINCT FROM OLD.requirement_version_id OR NEW.requirement_item_id IS DISTINCT FROM OLD.requirement_item_id) THEN
    RAISE EXCEPTION 'stable planning resolution fields are immutable' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM project_planning_packages pp WHERE pp.project_id=NEW.project_id AND pp.status<>'RETURNED') THEN
    RAISE EXCEPTION 'planning resolutions are locked by current package' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM business_projects p
    JOIN project_requirement_versions rv ON rv.id=NEW.requirement_version_id AND rv.project_id=p.id
    JOIN project_requirement_items ri ON ri.id=NEW.requirement_item_id AND ri.requirement_version_id=rv.id
    JOIN products pr ON pr.id=NEW.product_id AND pr.status='ACTIVE' AND pr.customer_id=p.customer_id AND pr.customer_id IS NOT NULL
    JOIN product_versions pv ON pv.id=NEW.product_version_id AND pv.product_id=pr.id AND pv.status='RELEASED'
    JOIN bom_headers bh ON bh.id=NEW.bom_header_id AND bh.product_id=pr.id AND bh.status='ACTIVE'
    JOIN bom_versions bv ON bv.id=NEW.bom_version_id AND bv.bom_header_id=bh.id AND bv.product_version_id=pv.id AND bv.status='RELEASED'
    WHERE p.id=NEW.project_id AND p.status='ACCEPTED'
  ) THEN RAISE EXCEPTION 'planning resolution references are inconsistent' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_planning_package_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.planning_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'planning package writes require PlanningHandoffService' USING ERRCODE='42501';
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'planning packages cannot be deleted' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.package_version_no IS DISTINCT FROM OLD.package_version_no OR NEW.requirement_version_id IS DISTINCT FROM OLD.requirement_version_id OR NEW.target_delivery_date IS DISTINCT FROM OLD.target_delivery_date OR NEW.package_digest IS DISTINCT FROM OLD.package_digest OR NEW.prepared_by IS DISTINCT FROM OLD.prepared_by OR NEW.prepared_at IS DISTINCT FROM OLD.prepared_at THEN
      RAISE EXCEPTION 'stable planning package fields are immutable' USING ERRCODE='55000';
    END IF;
    IF NOT ((OLD.status='DRAFT' AND NEW.status='SUBMITTED') OR (OLD.status='SUBMITTED' AND NEW.status IN ('RETURNED','ACCEPTED'))) THEN
      RAISE EXCEPTION 'invalid planning package state transition' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM project_requirement_versions rv WHERE rv.id=NEW.requirement_version_id AND rv.project_id=NEW.project_id) THEN
    RAISE EXCEPTION 'planning package requirement does not belong to project' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_planning_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.planning_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'planning item writes require PlanningHandoffService' USING ERRCODE='42501';
  END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'planning package items are immutable' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM project_planning_packages pp JOIN project_requirement_items ri ON ri.id=NEW.requirement_item_id AND ri.requirement_version_id=pp.requirement_version_id JOIN bom_versions bv ON bv.id=NEW.bom_version_id AND bv.product_version_id=NEW.product_version_id WHERE pp.id=NEW.package_id) THEN
    RAISE EXCEPTION 'planning package item references are inconsistent' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_planning_bom_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.planning_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'planning bom snapshot writes require PlanningHandoffService' USING ERRCODE='42501';
  END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'planning BOM snapshots are immutable' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM project_planning_package_items pi JOIN bom_lines bl ON bl.id=NEW.source_bom_line_id AND bl.bom_version_id=pi.bom_version_id AND bl.material_id=NEW.material_id AND bl.unit_id=NEW.unit_id AND bl.quantity_per=NEW.quantity_per AND bl.loss_rate=NEW.loss_rate WHERE pi.id=NEW.package_item_id) THEN
    RAISE EXCEPTION 'planning BOM snapshot references are inconsistent' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_planning_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.planning_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'planning document writes require PlanningHandoffService' USING ERRCODE='42501';
  END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'planning document links are immutable' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM project_planning_packages pp JOIN project_document_links dl ON dl.id=NEW.project_document_link_id AND dl.project_id=pp.project_id AND dl.requirement_version_id=pp.requirement_version_id WHERE pp.id=NEW.package_id) THEN
    RAISE EXCEPTION 'planning document link references are inconsistent' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_planning_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.planning_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'planning event writes require PlanningHandoffService' USING ERRCODE='42501';
  END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'planning handoff events are immutable' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM project_planning_packages pp WHERE pp.id=NEW.package_id AND pp.project_id=NEW.project_id) THEN
    RAISE EXCEPTION 'planning event references are inconsistent' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER project_requirement_resolutions_service_guard BEFORE INSERT OR UPDATE OR DELETE ON project_requirement_resolutions FOR EACH ROW EXECUTE FUNCTION cyd_planning_resolution_guard();
--> statement-breakpoint
CREATE TRIGGER project_planning_packages_service_guard BEFORE INSERT OR UPDATE OR DELETE ON project_planning_packages FOR EACH ROW EXECUTE FUNCTION cyd_planning_package_guard();
--> statement-breakpoint
CREATE TRIGGER project_planning_package_items_immutable BEFORE INSERT OR UPDATE OR DELETE ON project_planning_package_items FOR EACH ROW EXECUTE FUNCTION cyd_planning_item_guard();
--> statement-breakpoint
CREATE TRIGGER project_planning_package_bom_lines_immutable BEFORE INSERT OR UPDATE OR DELETE ON project_planning_package_bom_lines FOR EACH ROW EXECUTE FUNCTION cyd_planning_bom_line_guard();
--> statement-breakpoint
CREATE TRIGGER project_planning_document_links_immutable BEFORE INSERT OR UPDATE OR DELETE ON project_planning_document_links FOR EACH ROW EXECUTE FUNCTION cyd_planning_document_guard();
--> statement-breakpoint
CREATE TRIGGER project_planning_handoff_events_immutable BEFORE INSERT OR UPDATE OR DELETE ON project_planning_handoff_events FOR EACH ROW EXECUTE FUNCTION cyd_planning_event_guard();
