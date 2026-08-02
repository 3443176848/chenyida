CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE "project_planning_revision_response_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_package_id" bigint NOT NULL,
	"return_event_id" bigint NOT NULL,
	"project_id" bigint NOT NULL,
	"response_version_no" integer NOT NULL,
	"response_text" text NOT NULL,
	"response_text_digest" text NOT NULL,
	"supersedes_response_id" bigint,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	CONSTRAINT "project_planning_revision_response_versions_no_ck" CHECK ("project_planning_revision_response_versions"."response_version_no">0),
	CONSTRAINT "project_planning_revision_response_versions_chain_ck" CHECK (("project_planning_revision_response_versions"."response_version_no"=1 and "project_planning_revision_response_versions"."supersedes_response_id" is null) or ("project_planning_revision_response_versions"."response_version_no">1 and "project_planning_revision_response_versions"."supersedes_response_id" is not null)),
	CONSTRAINT "project_planning_revision_response_versions_text_ck" CHECK ("project_planning_revision_response_versions"."response_text"=btrim("project_planning_revision_response_versions"."response_text") and char_length("project_planning_revision_response_versions"."response_text") between 10 and 2000 and regexp_replace("project_planning_revision_response_versions"."response_text", E'\n', '', 'g') !~ '[[:cntrl:]]'),
	CONSTRAINT "project_planning_revision_response_versions_digest_ck" CHECK ("project_planning_revision_response_versions"."response_text_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "project_planning_revision_response_heads" (
	"return_event_id" bigint PRIMARY KEY NOT NULL,
	"source_package_id" bigint NOT NULL,
	"project_id" bigint NOT NULL,
	"current_response_version_id" bigint NOT NULL,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_planning_revision_response_heads_version_ck" CHECK ("project_planning_revision_response_heads"."version">0)
);
--> statement-breakpoint
ALTER TABLE "project_planning_handoff_events" DROP CONSTRAINT "project_planning_handoff_events_type_ck";
--> statement-breakpoint
ALTER TABLE "project_planning_packages" ADD COLUMN "previous_package_id" bigint;
--> statement-breakpoint
ALTER TABLE "project_planning_packages" ADD COLUMN "responds_to_return_event_id" bigint;
--> statement-breakpoint
ALTER TABLE "project_planning_packages" ADD COLUMN "revision_response_version_id" bigint;
--> statement-breakpoint

-- Referenced composite keys must exist before the corresponding foreign keys.
CREATE UNIQUE INDEX "project_planning_packages_id_project_uq" ON "project_planning_packages" USING btree ("id","project_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "project_planning_handoff_events_id_package_project_uq" ON "project_planning_handoff_events" USING btree ("id","package_id","project_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "project_planning_revision_response_versions_id_lineage_uq" ON "project_planning_revision_response_versions" USING btree ("id","source_package_id","return_event_id","project_id");
--> statement-breakpoint

ALTER TABLE "project_planning_revision_response_versions" ADD CONSTRAINT "project_planning_revision_response_versions_source_package_id_project_planning_packages_id_fk" FOREIGN KEY ("source_package_id") REFERENCES "public"."project_planning_packages"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_planning_revision_response_versions" ADD CONSTRAINT "project_planning_revision_response_versions_return_event_id_project_planning_handoff_events_id_fk" FOREIGN KEY ("return_event_id") REFERENCES "public"."project_planning_handoff_events"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_planning_revision_response_versions" ADD CONSTRAINT "project_planning_revision_response_versions_project_id_business_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."business_projects"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_planning_revision_response_versions" ADD CONSTRAINT "project_planning_revision_response_versions_supersedes_response_id_project_planning_revision_response_versions_id_fk" FOREIGN KEY ("supersedes_response_id") REFERENCES "public"."project_planning_revision_response_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_planning_revision_response_versions" ADD CONSTRAINT "project_planning_revision_response_versions_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_planning_revision_response_versions" ADD CONSTRAINT "project_planning_revision_response_versions_source_project_fk" FOREIGN KEY ("source_package_id","project_id") REFERENCES "public"."project_planning_packages"("id","project_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_planning_revision_response_versions" ADD CONSTRAINT "project_planning_revision_response_versions_return_source_fk" FOREIGN KEY ("return_event_id","source_package_id","project_id") REFERENCES "public"."project_planning_handoff_events"("id","package_id","project_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_planning_revision_response_versions" ADD CONSTRAINT "project_planning_revision_response_versions_supersedes_lineage_fk" FOREIGN KEY ("supersedes_response_id","source_package_id","return_event_id","project_id") REFERENCES "public"."project_planning_revision_response_versions"("id","source_package_id","return_event_id","project_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "project_planning_revision_response_heads" ADD CONSTRAINT "project_planning_revision_response_heads_return_event_id_project_planning_handoff_events_id_fk" FOREIGN KEY ("return_event_id") REFERENCES "public"."project_planning_handoff_events"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_planning_revision_response_heads" ADD CONSTRAINT "project_planning_revision_response_heads_source_package_id_project_planning_packages_id_fk" FOREIGN KEY ("source_package_id") REFERENCES "public"."project_planning_packages"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_planning_revision_response_heads" ADD CONSTRAINT "project_planning_revision_response_heads_project_id_business_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."business_projects"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_planning_revision_response_heads" ADD CONSTRAINT "project_planning_revision_response_heads_current_response_version_id_project_planning_revision_response_versions_id_fk" FOREIGN KEY ("current_response_version_id") REFERENCES "public"."project_planning_revision_response_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_planning_revision_response_heads" ADD CONSTRAINT "project_planning_revision_response_heads_source_project_fk" FOREIGN KEY ("source_package_id","project_id") REFERENCES "public"."project_planning_packages"("id","project_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_planning_revision_response_heads" ADD CONSTRAINT "project_planning_revision_response_heads_return_source_fk" FOREIGN KEY ("return_event_id","source_package_id","project_id") REFERENCES "public"."project_planning_handoff_events"("id","package_id","project_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_planning_revision_response_heads" ADD CONSTRAINT "project_planning_revision_response_heads_current_lineage_fk" FOREIGN KEY ("current_response_version_id","source_package_id","return_event_id","project_id") REFERENCES "public"."project_planning_revision_response_versions"("id","source_package_id","return_event_id","project_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "project_planning_packages" ADD CONSTRAINT "project_planning_packages_previous_project_fk" FOREIGN KEY ("previous_package_id","project_id") REFERENCES "public"."project_planning_packages"("id","project_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_planning_packages" ADD CONSTRAINT "project_planning_packages_return_source_fk" FOREIGN KEY ("responds_to_return_event_id","previous_package_id","project_id") REFERENCES "public"."project_planning_handoff_events"("id","package_id","project_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_planning_packages" ADD CONSTRAINT "project_planning_packages_response_source_fk" FOREIGN KEY ("revision_response_version_id","previous_package_id","responds_to_return_event_id","project_id") REFERENCES "public"."project_planning_revision_response_versions"("id","source_package_id","return_event_id","project_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX "project_planning_revision_response_heads_current_uq" ON "project_planning_revision_response_heads" USING btree ("current_response_version_id");
--> statement-breakpoint
CREATE INDEX "project_planning_revision_response_heads_source_idx" ON "project_planning_revision_response_heads" USING btree ("source_package_id","return_event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "project_planning_revision_response_versions_return_no_uq" ON "project_planning_revision_response_versions" USING btree ("return_event_id","response_version_no");
--> statement-breakpoint
CREATE INDEX "project_planning_revision_response_versions_source_idx" ON "project_planning_revision_response_versions" USING btree ("source_package_id","return_event_id","response_version_no");
--> statement-breakpoint
CREATE INDEX "project_planning_revision_response_versions_request_idx" ON "project_planning_revision_response_versions" USING btree ("request_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "project_planning_handoff_events_package_created_uq" ON "project_planning_handoff_events" USING btree ("package_id") WHERE "project_planning_handoff_events"."event_type"='CREATED';
--> statement-breakpoint
CREATE UNIQUE INDEX "project_planning_handoff_events_package_returned_uq" ON "project_planning_handoff_events" USING btree ("package_id") WHERE "project_planning_handoff_events"."event_type"='RETURNED';
--> statement-breakpoint
CREATE UNIQUE INDEX "project_planning_packages_previous_uq" ON "project_planning_packages" USING btree ("previous_package_id") WHERE "project_planning_packages"."previous_package_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "project_planning_packages_return_successor_uq" ON "project_planning_packages" USING btree ("responds_to_return_event_id") WHERE "project_planning_packages"."responds_to_return_event_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "project_planning_packages_project_response_uq" ON "project_planning_packages" USING btree ("project_id","revision_response_version_id") WHERE "project_planning_packages"."revision_response_version_id" is not null;
--> statement-breakpoint
CREATE INDEX "project_planning_packages_lineage_idx" ON "project_planning_packages" USING btree ("previous_package_id","responds_to_return_event_id","revision_response_version_id");
--> statement-breakpoint
ALTER TABLE "project_planning_handoff_events" ADD CONSTRAINT "project_planning_handoff_events_type_ck" CHECK ("project_planning_handoff_events"."event_type" in ('CREATED','SUBMITTED','ACCEPTED','RETURNED','RESUBMITTED'));
--> statement-breakpoint
ALTER TABLE "project_planning_packages" ADD CONSTRAINT "project_planning_packages_lineage_ck" CHECK (("project_planning_packages"."package_version_no"=1 and "project_planning_packages"."previous_package_id" is null and "project_planning_packages"."responds_to_return_event_id" is null and "project_planning_packages"."revision_response_version_id" is null) or ("project_planning_packages"."package_version_no">1 and (("project_planning_packages"."previous_package_id" is null and "project_planning_packages"."responds_to_return_event_id" is null and "project_planning_packages"."revision_response_version_id" is null) or ("project_planning_packages"."previous_package_id" is not null and "project_planning_packages"."responds_to_return_event_id" is not null and "project_planning_packages"."revision_response_version_id" is not null))));
--> statement-breakpoint

-- Existing RETURNED packages are preserved without invented Engineering responses.
DO $$
DECLARE
	returned_without_response bigint;
	historical_successor_without_lineage bigint;
BEGIN
	SELECT count(*) INTO returned_without_response
	FROM project_planning_packages pp
	WHERE pp.status='RETURNED'
		AND NOT EXISTS (SELECT 1 FROM project_planning_revision_response_versions rr WHERE rr.source_package_id=pp.id);

	SELECT count(*) INTO historical_successor_without_lineage
	FROM project_planning_packages pp
	WHERE pp.package_version_no>1 AND pp.previous_package_id IS NULL;

	RAISE NOTICE '0037 planning revision lineage: returned_without_response=%, historical_successor_without_lineage=%',
		returned_without_response,historical_successor_without_lineage;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_planning_revision_response_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	prior_version_no integer;
BEGIN
	IF TG_OP<>'INSERT' THEN
		RAISE EXCEPTION 'planning revision response versions are immutable' USING ERRCODE='55000';
	END IF;
	IF current_setting('cyd.planning_service_write', true) IS DISTINCT FROM 'allowed' THEN
		RAISE EXCEPTION 'planning revision response writes require PlanningHandoffService' USING ERRCODE='42501';
	END IF;
	IF NEW.response_text_digest IS DISTINCT FROM encode(digest(convert_to(NEW.response_text,'UTF8'),'sha256'),'hex') THEN
		RAISE EXCEPTION 'planning revision response digest mismatch' USING ERRCODE='23514';
	END IF;
	IF NOT EXISTS (
		SELECT 1
		FROM project_planning_handoff_events e
		JOIN project_planning_packages pp ON pp.id=e.package_id AND pp.project_id=e.project_id
		WHERE e.id=NEW.return_event_id AND e.package_id=NEW.source_package_id
			AND e.project_id=NEW.project_id AND e.event_type='RETURNED' AND pp.status='RETURNED'
	) THEN
		RAISE EXCEPTION 'planning revision response requires the source package RETURN event' USING ERRCODE='23514';
	END IF;
	IF NEW.response_version_no>1 THEN
		SELECT response_version_no INTO prior_version_no
		FROM project_planning_revision_response_versions
		WHERE id=NEW.supersedes_response_id
			AND source_package_id=NEW.source_package_id
			AND return_event_id=NEW.return_event_id
			AND project_id=NEW.project_id;
		IF prior_version_no IS DISTINCT FROM NEW.response_version_no-1 THEN
			RAISE EXCEPTION 'planning revision response chain is not consecutive' USING ERRCODE='23514';
		END IF;
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_planning_revision_response_head_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	current_response_version integer;
BEGIN
	IF TG_OP='DELETE' THEN
		RAISE EXCEPTION 'planning revision response heads cannot be deleted' USING ERRCODE='55000';
	END IF;
	IF current_setting('cyd.planning_service_write', true) IS DISTINCT FROM 'allowed' THEN
		RAISE EXCEPTION 'planning revision response head writes require PlanningHandoffService' USING ERRCODE='42501';
	END IF;
	IF TG_OP='INSERT' AND NEW.version<>1 THEN
		RAISE EXCEPTION 'initial planning revision response head version must be one' USING ERRCODE='23514';
	END IF;
	IF TG_OP='UPDATE' THEN
		IF NEW.return_event_id IS DISTINCT FROM OLD.return_event_id
			OR NEW.source_package_id IS DISTINCT FROM OLD.source_package_id
			OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
			RAISE EXCEPTION 'stable planning revision response head fields are immutable' USING ERRCODE='55000';
		END IF;
		IF NEW.version<>OLD.version+1 OR NEW.current_response_version_id=OLD.current_response_version_id THEN
			RAISE EXCEPTION 'planning revision response head version must advance once' USING ERRCODE='23514';
		END IF;
	END IF;
	SELECT response_version_no INTO current_response_version
	FROM project_planning_revision_response_versions
	WHERE id=NEW.current_response_version_id
		AND source_package_id=NEW.source_package_id
		AND return_event_id=NEW.return_event_id
		AND project_id=NEW.project_id;
	IF current_response_version IS DISTINCT FROM NEW.version THEN
		RAISE EXCEPTION 'planning revision response head does not match response version' USING ERRCODE='23514';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_planning_package_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	previous_status text;
	previous_requirement_version_id bigint;
	previous_package_version_no integer;
	return_event_type text;
BEGIN
	IF current_setting('cyd.planning_service_write', true) IS DISTINCT FROM 'allowed' THEN
		RAISE EXCEPTION 'planning package writes require PlanningHandoffService' USING ERRCODE='42501';
	END IF;
	IF TG_OP='DELETE' THEN
		RAISE EXCEPTION 'planning packages cannot be deleted' USING ERRCODE='55000';
	END IF;
	IF TG_OP='UPDATE' THEN
		IF NEW.project_id IS DISTINCT FROM OLD.project_id
			OR NEW.package_version_no IS DISTINCT FROM OLD.package_version_no
			OR NEW.requirement_version_id IS DISTINCT FROM OLD.requirement_version_id
			OR NEW.previous_package_id IS DISTINCT FROM OLD.previous_package_id
			OR NEW.responds_to_return_event_id IS DISTINCT FROM OLD.responds_to_return_event_id
			OR NEW.revision_response_version_id IS DISTINCT FROM OLD.revision_response_version_id
			OR NEW.target_delivery_date IS DISTINCT FROM OLD.target_delivery_date
			OR NEW.package_digest IS DISTINCT FROM OLD.package_digest
			OR NEW.prepared_by IS DISTINCT FROM OLD.prepared_by
			OR NEW.prepared_at IS DISTINCT FROM OLD.prepared_at THEN
			RAISE EXCEPTION 'stable planning package fields are immutable' USING ERRCODE='55000';
		END IF;
		IF NOT ((OLD.status='DRAFT' AND NEW.status='SUBMITTED') OR (OLD.status='SUBMITTED' AND NEW.status IN ('RETURNED','ACCEPTED'))) THEN
			RAISE EXCEPTION 'invalid planning package state transition' USING ERRCODE='23514';
		END IF;
	END IF;
	IF TG_OP='INSERT' AND NEW.package_version_no>1 THEN
		IF NEW.previous_package_id IS NULL OR NEW.responds_to_return_event_id IS NULL OR NEW.revision_response_version_id IS NULL THEN
			RAISE EXCEPTION 'new successor planning packages require complete revision lineage' USING ERRCODE='23514';
		END IF;
		SELECT pp.status,pp.requirement_version_id,pp.package_version_no,e.event_type
		INTO previous_status,previous_requirement_version_id,previous_package_version_no,return_event_type
		FROM project_planning_packages pp
		JOIN project_planning_handoff_events e ON e.id=NEW.responds_to_return_event_id
			AND e.package_id=pp.id AND e.project_id=pp.project_id
		JOIN project_planning_revision_response_versions rr ON rr.id=NEW.revision_response_version_id
			AND rr.source_package_id=pp.id AND rr.return_event_id=e.id AND rr.project_id=pp.project_id
		WHERE pp.id=NEW.previous_package_id AND pp.project_id=NEW.project_id;
		IF previous_status IS DISTINCT FROM 'RETURNED'
			OR return_event_type IS DISTINCT FROM 'RETURNED'
			OR previous_requirement_version_id IS DISTINCT FROM NEW.requirement_version_id
			OR previous_package_version_no+1 IS DISTINCT FROM NEW.package_version_no THEN
			RAISE EXCEPTION 'planning successor lineage is inconsistent' USING ERRCODE='23514';
		END IF;
	END IF;
	IF TG_OP='INSERT' AND NEW.package_version_no=1
		AND (NEW.previous_package_id IS NOT NULL OR NEW.responds_to_return_event_id IS NOT NULL OR NEW.revision_response_version_id IS NOT NULL) THEN
		RAISE EXCEPTION 'initial planning package cannot declare revision lineage' USING ERRCODE='23514';
	END IF;
	IF NOT EXISTS (SELECT 1 FROM project_requirement_versions rv WHERE rv.id=NEW.requirement_version_id AND rv.project_id=NEW.project_id) THEN
		RAISE EXCEPTION 'planning package requirement does not belong to project' USING ERRCODE='23514';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_planning_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	lineage_source_package_id bigint;
BEGIN
	IF current_setting('cyd.planning_service_write', true) IS DISTINCT FROM 'allowed' THEN
		RAISE EXCEPTION 'planning item writes require PlanningHandoffService' USING ERRCODE='42501';
	END IF;
	IF TG_OP<>'INSERT' THEN
		RAISE EXCEPTION 'planning package items are immutable' USING ERRCODE='55000';
	END IF;
	IF NEW.unit_resolution_id IS NULL THEN
		RAISE EXCEPTION 'planning package item requires unit resolution provenance' USING ERRCODE='23514';
	END IF;
	SELECT previous_package_id INTO lineage_source_package_id FROM project_planning_packages WHERE id=NEW.package_id;
	IF lineage_source_package_id IS NULL THEN
		IF NOT EXISTS (
			SELECT 1
			FROM project_planning_packages pp
			JOIN project_requirement_items ri ON ri.id=NEW.requirement_item_id AND ri.requirement_version_id=pp.requirement_version_id
			JOIN bom_versions bv ON bv.id=NEW.bom_version_id AND bv.product_version_id=NEW.product_version_id
			JOIN project_requirement_unit_resolution_versions ur ON ur.id=NEW.unit_resolution_id
				AND ur.project_id=pp.project_id AND ur.requirement_version_id=pp.requirement_version_id
				AND ur.requirement_item_id=NEW.requirement_item_id AND ur.unit_id=NEW.unit_id
			JOIN project_requirement_unit_resolution_heads uh ON uh.requirement_item_id=NEW.requirement_item_id
				AND uh.project_id=pp.project_id AND uh.requirement_version_id=pp.requirement_version_id
				AND uh.current_resolution_id=ur.id
			JOIN units u ON u.id=ur.unit_id AND u.enabled=true
			WHERE pp.id=NEW.package_id
		) THEN
			RAISE EXCEPTION 'planning package item references are inconsistent' USING ERRCODE='23514';
		END IF;
	ELSE
		IF NOT EXISTS (
			SELECT 1
			FROM project_planning_packages successor
			JOIN project_planning_package_items source_item ON source_item.package_id=successor.previous_package_id
				AND source_item.requirement_item_id=NEW.requirement_item_id
				AND source_item.product_version_id=NEW.product_version_id
				AND source_item.bom_version_id=NEW.bom_version_id
				AND source_item.required_quantity=NEW.required_quantity
				AND source_item.unit_id=NEW.unit_id
				AND source_item.unit_resolution_id=NEW.unit_resolution_id
				AND source_item.line_no=NEW.line_no
				AND source_item.source_digest=NEW.source_digest
			JOIN product_versions pv ON pv.id=NEW.product_version_id AND pv.status='RELEASED'
			JOIN products p ON p.id=pv.product_id AND p.status='ACTIVE'
			JOIN bom_versions bv ON bv.id=NEW.bom_version_id AND bv.product_version_id=pv.id AND bv.status='RELEASED'
			JOIN bom_headers bh ON bh.id=bv.bom_header_id AND bh.product_id=p.id AND bh.status='ACTIVE'
			JOIN project_requirement_unit_resolution_versions ur ON ur.id=NEW.unit_resolution_id AND ur.unit_id=NEW.unit_id
			JOIN units u ON u.id=NEW.unit_id AND u.enabled=true
			WHERE successor.id=NEW.package_id
		) THEN
			RAISE EXCEPTION 'planning successor item must copy the fixed source package item' USING ERRCODE='23514';
		END IF;
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_planning_bom_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	lineage_source_package_id bigint;
BEGIN
	IF current_setting('cyd.planning_service_write', true) IS DISTINCT FROM 'allowed' THEN
		RAISE EXCEPTION 'planning bom snapshot writes require PlanningHandoffService' USING ERRCODE='42501';
	END IF;
	IF TG_OP<>'INSERT' THEN
		RAISE EXCEPTION 'planning BOM snapshots are immutable' USING ERRCODE='55000';
	END IF;
	SELECT pp.previous_package_id INTO lineage_source_package_id
	FROM project_planning_package_items pi JOIN project_planning_packages pp ON pp.id=pi.package_id
	WHERE pi.id=NEW.package_item_id;
	IF lineage_source_package_id IS NULL THEN
		IF NOT EXISTS (
			SELECT 1 FROM project_planning_package_items pi
			JOIN bom_lines bl ON bl.id=NEW.source_bom_line_id AND bl.bom_version_id=pi.bom_version_id
				AND bl.material_id=NEW.material_id AND bl.unit_id=NEW.unit_id
				AND bl.quantity_per=NEW.quantity_per AND bl.loss_rate=NEW.loss_rate
			WHERE pi.id=NEW.package_item_id
		) THEN
			RAISE EXCEPTION 'planning BOM snapshot references are inconsistent' USING ERRCODE='23514';
		END IF;
	ELSE
		IF NOT EXISTS (
			SELECT 1
			FROM project_planning_package_items successor_item
			JOIN project_planning_packages successor ON successor.id=successor_item.package_id
			JOIN project_planning_package_items source_item ON source_item.package_id=successor.previous_package_id
				AND source_item.line_no=successor_item.line_no
			JOIN project_planning_package_bom_lines source_line ON source_line.package_item_id=source_item.id
				AND source_line.source_bom_line_id=NEW.source_bom_line_id
				AND source_line.material_id=NEW.material_id
				AND source_line.unit_id=NEW.unit_id
				AND source_line.quantity_per=NEW.quantity_per
				AND source_line.loss_rate=NEW.loss_rate
				AND source_line.calculated_gross_quantity=NEW.calculated_gross_quantity
				AND source_line.specification_snapshot=NEW.specification_snapshot
				AND source_line.material_digest=NEW.material_digest
				AND source_line.line_no=NEW.line_no
			WHERE successor_item.id=NEW.package_item_id
		) THEN
			RAISE EXCEPTION 'planning successor BOM snapshot must copy the fixed source snapshot' USING ERRCODE='23514';
		END IF;
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_planning_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	lineage_source_package_id bigint;
BEGIN
	IF current_setting('cyd.planning_service_write', true) IS DISTINCT FROM 'allowed' THEN
		RAISE EXCEPTION 'planning document writes require PlanningHandoffService' USING ERRCODE='42501';
	END IF;
	IF TG_OP<>'INSERT' THEN
		RAISE EXCEPTION 'planning document links are immutable' USING ERRCODE='55000';
	END IF;
	SELECT previous_package_id INTO lineage_source_package_id FROM project_planning_packages WHERE id=NEW.package_id;
	IF lineage_source_package_id IS NULL THEN
		IF NOT EXISTS (
			SELECT 1 FROM project_planning_packages pp
			JOIN project_document_links dl ON dl.id=NEW.project_document_link_id
				AND dl.project_id=pp.project_id AND dl.requirement_version_id=pp.requirement_version_id
			WHERE pp.id=NEW.package_id
		) THEN
			RAISE EXCEPTION 'planning document link references are inconsistent' USING ERRCODE='23514';
		END IF;
	ELSE
		IF NOT EXISTS (
			SELECT 1 FROM project_planning_document_links source_link
			WHERE source_link.package_id=lineage_source_package_id
				AND source_link.project_document_link_id=NEW.project_document_link_id
		) THEN
			RAISE EXCEPTION 'planning successor document must copy the fixed source link' USING ERRCODE='23514';
		END IF;
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_planning_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF current_setting('cyd.planning_service_write', true) IS DISTINCT FROM 'allowed' THEN
		RAISE EXCEPTION 'planning event writes require PlanningHandoffService' USING ERRCODE='42501';
	END IF;
	IF TG_OP<>'INSERT' THEN
		RAISE EXCEPTION 'planning handoff events are immutable' USING ERRCODE='55000';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM project_planning_packages pp
		WHERE pp.id=NEW.package_id AND pp.project_id=NEW.project_id
			AND (
				(NEW.event_type='CREATED' AND pp.status='DRAFT' AND pp.prepared_by=NEW.actor)
				OR (NEW.event_type='SUBMITTED' AND pp.package_version_no=1 AND pp.status='SUBMITTED' AND pp.submitted_by=NEW.actor)
				OR (NEW.event_type='RESUBMITTED' AND pp.package_version_no>1 AND pp.status='SUBMITTED' AND pp.submitted_by=NEW.actor)
				OR (NEW.event_type='RETURNED' AND pp.status='RETURNED' AND pp.returned_by=NEW.actor AND pp.return_reason=NEW.reason)
				OR (NEW.event_type='ACCEPTED' AND pp.status='ACCEPTED' AND pp.accepted_by=NEW.actor)
			)
	) THEN
		RAISE EXCEPTION 'planning event references or package state are inconsistent' USING ERRCODE='23514';
	END IF;
	RETURN NEW;
END $$;
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
	IF EXISTS (SELECT 1 FROM project_planning_packages pp WHERE pp.project_id=NEW.project_id) THEN
		RAISE EXCEPTION 'planning resolutions require an explicit change-resolution workflow after package creation' USING ERRCODE='55000';
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
	) THEN
		RAISE EXCEPTION 'planning resolution references are inconsistent' USING ERRCODE='23514';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_requirement_unit_resolution_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	prior_version_no integer;
BEGIN
	IF TG_OP<>'INSERT' THEN
		RAISE EXCEPTION 'requirement unit resolution versions are immutable' USING ERRCODE='55000';
	END IF;
	IF NEW.source_type='ENGINEERING_CONFIRMED'
		AND current_setting('cyd.planning_service_write', true) IS DISTINCT FROM 'allowed' THEN
		RAISE EXCEPTION 'engineering requirement unit resolution writes require PlanningHandoffService' USING ERRCODE='42501';
	END IF;
	IF NEW.source_type='REQUIREMENT_DECLARED'
		AND current_setting('cyd.project_service_write', true) IS DISTINCT FROM 'allowed' THEN
		RAISE EXCEPTION 'declared requirement unit resolution writes require ProjectService' USING ERRCODE='42501';
	END IF;
	IF NOT EXISTS (SELECT 1 FROM units u WHERE u.id=NEW.unit_id AND u.enabled=true) THEN
		RAISE EXCEPTION 'requirement unit resolution requires an enabled unit' USING ERRCODE='23514';
	END IF;
	IF NEW.source_type='REQUIREMENT_DECLARED' AND NOT EXISTS (
		SELECT 1 FROM project_requirement_items ri
		WHERE ri.id=NEW.requirement_item_id AND ri.requirement_version_id=NEW.requirement_version_id
			AND ri.unit_pending=false AND ri.unit_id=NEW.unit_id
	) THEN
		RAISE EXCEPTION 'declared requirement unit provenance is inconsistent' USING ERRCODE='23514';
	END IF;
	IF NEW.source_type='REQUIREMENT_DECLARED'
		AND (NEW.resolution_version_no<>1 OR NEW.supersedes_resolution_id IS NOT NULL) THEN
		RAISE EXCEPTION 'declared requirement unit provenance can only create the initial version' USING ERRCODE='23514';
	END IF;
	IF NEW.resolution_version_no>1 THEN
		SELECT resolution_version_no INTO prior_version_no
		FROM project_requirement_unit_resolution_versions
		WHERE id=NEW.supersedes_resolution_id
			AND project_id=NEW.project_id
			AND requirement_version_id=NEW.requirement_version_id
			AND requirement_item_id=NEW.requirement_item_id;
		IF prior_version_no IS DISTINCT FROM NEW.resolution_version_no-1 THEN
			RAISE EXCEPTION 'requirement unit resolution chain is not consecutive' USING ERRCODE='23514';
		END IF;
	END IF;
	IF EXISTS (
		SELECT 1 FROM project_planning_packages pp
		WHERE pp.project_id=NEW.project_id AND pp.requirement_version_id=NEW.requirement_version_id
	) THEN
		RAISE EXCEPTION 'requirement unit resolution requires an explicit change-resolution workflow after package creation' USING ERRCODE='55000';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER project_planning_revision_response_versions_immutable BEFORE INSERT OR UPDATE OR DELETE ON project_planning_revision_response_versions FOR EACH ROW EXECUTE FUNCTION cyd_planning_revision_response_version_guard();
--> statement-breakpoint
CREATE TRIGGER project_planning_revision_response_heads_service_guard BEFORE INSERT OR UPDATE OR DELETE ON project_planning_revision_response_heads FOR EACH ROW EXECUTE FUNCTION cyd_planning_revision_response_head_guard();
