CREATE TABLE "business_projects" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_code" text NOT NULL,
	"customer_id" bigint NOT NULL,
	"project_name" text NOT NULL,
	"project_goal" text NOT NULL,
	"market_owner" text NOT NULL,
	"project_owner" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"target_delivery_date" date,
	"current_requirement_version_no" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"request_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_projects_code_ck" CHECK ("business_projects"."project_code" ~ '^PRJ-[0-9]{8}$'),
	CONSTRAINT "business_projects_status_ck" CHECK ("business_projects"."status" in ('DRAFT','SUBMITTED','RETURNED','ACCEPTED')),
	CONSTRAINT "business_projects_version_ck" CHECK ("business_projects"."version">0 and "business_projects"."current_requirement_version_no">0),
	CONSTRAINT "business_projects_text_ck" CHECK (char_length(btrim("business_projects"."project_name")) between 1 and 200 and char_length(btrim("business_projects"."project_goal")) between 1 and 2000),
	CONSTRAINT "business_projects_owner_ck" CHECK (("business_projects"."status"='ACCEPTED' and "business_projects"."project_owner" is not null) or ("business_projects"."status"<>'ACCEPTED'))
);
--> statement-breakpoint
CREATE TABLE "project_document_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" bigint NOT NULL,
	"requirement_version_id" bigint NOT NULL,
	"file_id" bigint NOT NULL,
	"document_type" text NOT NULL,
	"display_name" text NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_document_links_type_ck" CHECK ("project_document_links"."document_type" in ('CUSTOMER_REQUIREMENT','DRAWING','SPECIFICATION','REFERENCE')),
	CONSTRAINT "project_document_links_name_ck" CHECK (char_length(btrim("project_document_links"."display_name")) between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "project_handoff_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"handoff_id" bigint NOT NULL,
	"project_id" bigint NOT NULL,
	"requirement_version_id" bigint NOT NULL,
	"event_type" text NOT NULL,
	"actor" text NOT NULL,
	"request_id" uuid NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_handoff_events_type_ck" CHECK ("project_handoff_events"."event_type" in ('SUBMITTED','ACCEPTED','RETURNED','RESUBMITTED')),
	CONSTRAINT "project_handoff_events_reason_ck" CHECK (("project_handoff_events"."event_type"='RETURNED' and char_length(btrim("project_handoff_events"."reason")) between 1 and 1000) or ("project_handoff_events"."event_type"<>'RETURNED' and char_length("project_handoff_events"."reason")<=1000))
);
--> statement-breakpoint
CREATE TABLE "project_handoffs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" bigint NOT NULL,
	"requirement_version_id" bigint NOT NULL,
	"from_department" text DEFAULT 'MARKET' NOT NULL,
	"to_department" text DEFAULT 'PROJECT' NOT NULL,
	"status" text NOT NULL,
	"submitted_by" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"accepted_by" text,
	"accepted_at" timestamp with time zone,
	"returned_by" text,
	"returned_at" timestamp with time zone,
	"return_reason" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"request_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_handoffs_department_ck" CHECK ("project_handoffs"."from_department"='MARKET' and "project_handoffs"."to_department"='PROJECT'),
	CONSTRAINT "project_handoffs_status_ck" CHECK ("project_handoffs"."status" in ('SUBMITTED','RETURNED','ACCEPTED')),
	CONSTRAINT "project_handoffs_version_ck" CHECK ("project_handoffs"."version">0),
	CONSTRAINT "project_handoffs_accept_ck" CHECK (("project_handoffs"."status"='ACCEPTED' and "project_handoffs"."accepted_by" is not null and "project_handoffs"."accepted_at" is not null) or "project_handoffs"."status"<>'ACCEPTED'),
	CONSTRAINT "project_handoffs_return_ck" CHECK (("project_handoffs"."status"='RETURNED' and "project_handoffs"."returned_by" is not null and "project_handoffs"."returned_at" is not null and char_length(btrim("project_handoffs"."return_reason")) between 1 and 1000) or "project_handoffs"."status"<>'RETURNED')
);
--> statement-breakpoint
CREATE TABLE "project_requirement_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"requirement_version_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"provisional_name" text NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"unit_id" bigint,
	"unit_pending" boolean DEFAULT false NOT NULL,
	"specification_requirement" text DEFAULT '' NOT NULL,
	"product_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_requirement_items_line_ck" CHECK ("project_requirement_items"."line_no">0),
	CONSTRAINT "project_requirement_items_quantity_ck" CHECK ("project_requirement_items"."quantity">0),
	CONSTRAINT "project_requirement_items_unit_ck" CHECK (("project_requirement_items"."unit_pending"=true and "project_requirement_items"."unit_id" is null) or ("project_requirement_items"."unit_pending"=false and "project_requirement_items"."unit_id" is not null)),
	CONSTRAINT "project_requirement_items_name_ck" CHECK (char_length(btrim("project_requirement_items"."provisional_name")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "project_requirement_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" bigint NOT NULL,
	"version_no" integer NOT NULL,
	"customer_requirement_summary" text NOT NULL,
	"quantity_requirement" numeric(24, 6),
	"quantity_unit" text DEFAULT '' NOT NULL,
	"delivery_requirement" text DEFAULT '' NOT NULL,
	"commercial_terms" text DEFAULT '' NOT NULL,
	"technical_requirements" text DEFAULT '' NOT NULL,
	"content_digest" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_requirement_versions_no_ck" CHECK ("project_requirement_versions"."version_no">0),
	CONSTRAINT "project_requirement_versions_quantity_ck" CHECK ("project_requirement_versions"."quantity_requirement" is null or "project_requirement_versions"."quantity_requirement">0),
	CONSTRAINT "project_requirement_versions_digest_ck" CHECK ("project_requirement_versions"."content_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "project_requirement_versions_summary_ck" CHECK (char_length(btrim("project_requirement_versions"."customer_requirement_summary")) between 1 and 4000)
);
--> statement-breakpoint
ALTER TABLE "business_projects" ADD CONSTRAINT "business_projects_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_projects" ADD CONSTRAINT "business_projects_market_owner_app_users_username_fk" FOREIGN KEY ("market_owner") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_projects" ADD CONSTRAINT "business_projects_project_owner_app_users_username_fk" FOREIGN KEY ("project_owner") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_projects" ADD CONSTRAINT "business_projects_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_document_links" ADD CONSTRAINT "project_document_links_project_id_business_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."business_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_document_links" ADD CONSTRAINT "project_document_links_requirement_version_id_project_requirement_versions_id_fk" FOREIGN KEY ("requirement_version_id") REFERENCES "public"."project_requirement_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_document_links" ADD CONSTRAINT "project_document_links_file_id_material_import_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."material_import_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_document_links" ADD CONSTRAINT "project_document_links_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_handoff_events" ADD CONSTRAINT "project_handoff_events_handoff_id_project_handoffs_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "public"."project_handoffs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_handoff_events" ADD CONSTRAINT "project_handoff_events_project_id_business_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."business_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_handoff_events" ADD CONSTRAINT "project_handoff_events_requirement_version_id_project_requirement_versions_id_fk" FOREIGN KEY ("requirement_version_id") REFERENCES "public"."project_requirement_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_handoff_events" ADD CONSTRAINT "project_handoff_events_actor_app_users_username_fk" FOREIGN KEY ("actor") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_handoffs" ADD CONSTRAINT "project_handoffs_project_id_business_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."business_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_handoffs" ADD CONSTRAINT "project_handoffs_requirement_version_id_project_requirement_versions_id_fk" FOREIGN KEY ("requirement_version_id") REFERENCES "public"."project_requirement_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_handoffs" ADD CONSTRAINT "project_handoffs_submitted_by_app_users_username_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_handoffs" ADD CONSTRAINT "project_handoffs_accepted_by_app_users_username_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_handoffs" ADD CONSTRAINT "project_handoffs_returned_by_app_users_username_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_requirement_items" ADD CONSTRAINT "project_requirement_items_requirement_version_id_project_requirement_versions_id_fk" FOREIGN KEY ("requirement_version_id") REFERENCES "public"."project_requirement_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_requirement_items" ADD CONSTRAINT "project_requirement_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_requirement_items" ADD CONSTRAINT "project_requirement_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_requirement_versions" ADD CONSTRAINT "project_requirement_versions_project_id_business_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."business_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_requirement_versions" ADD CONSTRAINT "project_requirement_versions_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_projects_code_uq" ON "business_projects" USING btree ("project_code");--> statement-breakpoint
CREATE INDEX "business_projects_market_status_idx" ON "business_projects" USING btree ("market_owner","status","updated_at","id");--> statement-breakpoint
CREATE INDEX "business_projects_project_status_idx" ON "business_projects" USING btree ("project_owner","status","updated_at","id");--> statement-breakpoint
CREATE INDEX "business_projects_customer_idx" ON "business_projects" USING btree ("customer_id","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_document_links_version_file_type_uq" ON "project_document_links" USING btree ("requirement_version_id","file_id","document_type");--> statement-breakpoint
CREATE INDEX "project_document_links_project_idx" ON "project_document_links" USING btree ("project_id","requirement_version_id","id");--> statement-breakpoint
CREATE INDEX "project_handoff_events_project_idx" ON "project_handoff_events" USING btree ("project_id","id");--> statement-breakpoint
CREATE INDEX "project_handoff_events_handoff_idx" ON "project_handoff_events" USING btree ("handoff_id","id");--> statement-breakpoint
CREATE INDEX "project_handoff_events_request_idx" ON "project_handoff_events" USING btree ("request_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_handoffs_project_uq" ON "project_handoffs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_handoffs_queue_idx" ON "project_handoffs" USING btree ("to_department","status","submitted_at","id");--> statement-breakpoint
CREATE INDEX "project_handoffs_submitter_idx" ON "project_handoffs" USING btree ("submitted_by","status","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_requirement_items_version_line_uq" ON "project_requirement_items" USING btree ("requirement_version_id","line_no");--> statement-breakpoint
CREATE INDEX "project_requirement_items_product_idx" ON "project_requirement_items" USING btree ("product_id","id") WHERE "project_requirement_items"."product_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "project_requirement_versions_project_no_uq" ON "project_requirement_versions" USING btree ("project_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "project_requirement_versions_project_digest_uq" ON "project_requirement_versions" USING btree ("project_id","content_digest");--> statement-breakpoint
CREATE INDEX "project_requirement_versions_project_created_idx" ON "project_requirement_versions" USING btree ("project_id","created_at","id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_project_service_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.project_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'project workflow writes require ProjectService' USING ERRCODE='42501';
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'project records cannot be deleted' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND (
    NEW.project_code IS DISTINCT FROM OLD.project_code OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR
    NEW.market_owner IS DISTINCT FROM OLD.market_owner OR NEW.created_by IS DISTINCT FROM OLD.created_by OR
    NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN RAISE EXCEPTION 'stable project fields are immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_project_handoff_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.project_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'project handoff writes require ProjectService' USING ERRCODE='42501';
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'project handoffs cannot be deleted' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND (NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.from_department IS DISTINCT FROM OLD.from_department OR NEW.to_department IS DISTINCT FROM OLD.to_department) THEN
    RAISE EXCEPTION 'stable handoff fields are immutable' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM project_requirement_versions v WHERE v.id=NEW.requirement_version_id AND v.project_id=NEW.project_id) THEN
    RAISE EXCEPTION 'handoff requirement does not belong to project' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_project_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.project_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'project immutable writes require ProjectService' USING ERRCODE='42501';
  END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'project history is immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_project_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_project_id bigint;
BEGIN
  IF current_setting('cyd.project_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'project document writes require ProjectService' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'project document links cannot be updated' USING ERRCODE='55000'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT project_id INTO row_project_id FROM project_requirement_versions WHERE id=NEW.requirement_version_id;
  IF row_project_id IS DISTINCT FROM NEW.project_id THEN RAISE EXCEPTION 'document requirement does not belong to project' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_project_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_project_id bigint; row_handoff_project_id bigint;
BEGIN
  IF current_setting('cyd.project_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'project event writes require ProjectService' USING ERRCODE='42501';
  END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'project events are immutable' USING ERRCODE='55000'; END IF;
  SELECT project_id INTO row_project_id FROM project_requirement_versions WHERE id=NEW.requirement_version_id;
  SELECT project_id INTO row_handoff_project_id FROM project_handoffs WHERE id=NEW.handoff_id;
  IF row_project_id IS DISTINCT FROM NEW.project_id OR row_handoff_project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'project event references are inconsistent' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER business_projects_service_guard BEFORE INSERT OR UPDATE OR DELETE ON business_projects FOR EACH ROW EXECUTE FUNCTION cyd_project_service_guard();
--> statement-breakpoint
CREATE TRIGGER project_handoffs_service_guard BEFORE INSERT OR UPDATE OR DELETE ON project_handoffs FOR EACH ROW EXECUTE FUNCTION cyd_project_handoff_guard();
--> statement-breakpoint
CREATE TRIGGER project_requirement_versions_immutable BEFORE INSERT OR UPDATE OR DELETE ON project_requirement_versions FOR EACH ROW EXECUTE FUNCTION cyd_project_immutable_guard();
--> statement-breakpoint
CREATE TRIGGER project_requirement_items_immutable BEFORE INSERT OR UPDATE OR DELETE ON project_requirement_items FOR EACH ROW EXECUTE FUNCTION cyd_project_immutable_guard();
--> statement-breakpoint
CREATE TRIGGER project_document_links_service_guard BEFORE INSERT OR UPDATE OR DELETE ON project_document_links FOR EACH ROW EXECUTE FUNCTION cyd_project_document_guard();
--> statement-breakpoint
CREATE TRIGGER project_handoff_events_immutable BEFORE INSERT OR UPDATE OR DELETE ON project_handoff_events FOR EACH ROW EXECUTE FUNCTION cyd_project_event_guard();
