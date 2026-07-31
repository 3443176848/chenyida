CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE "project_requirement_unit_resolution_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" bigint NOT NULL,
	"requirement_version_id" bigint NOT NULL,
	"requirement_item_id" bigint NOT NULL,
	"resolution_version_no" integer NOT NULL,
	"unit_id" bigint NOT NULL,
	"source_type" text NOT NULL,
	"supersedes_resolution_id" bigint,
	"resolved_by" text NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	"content_digest" text NOT NULL,
	CONSTRAINT "project_requirement_unit_resolution_versions_no_ck" CHECK ("project_requirement_unit_resolution_versions"."resolution_version_no">0),
	CONSTRAINT "project_requirement_unit_resolution_versions_source_ck" CHECK ("project_requirement_unit_resolution_versions"."source_type" in ('ENGINEERING_CONFIRMED','REQUIREMENT_DECLARED')),
	CONSTRAINT "project_requirement_unit_resolution_versions_chain_ck" CHECK (("project_requirement_unit_resolution_versions"."resolution_version_no"=1 and "project_requirement_unit_resolution_versions"."supersedes_resolution_id" is null) or ("project_requirement_unit_resolution_versions"."resolution_version_no">1 and "project_requirement_unit_resolution_versions"."supersedes_resolution_id" is not null)),
	CONSTRAINT "project_requirement_unit_resolution_versions_digest_ck" CHECK ("project_requirement_unit_resolution_versions"."content_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "project_requirement_unit_resolution_heads" (
	"requirement_item_id" bigint PRIMARY KEY NOT NULL,
	"project_id" bigint NOT NULL,
	"requirement_version_id" bigint NOT NULL,
	"current_resolution_id" bigint NOT NULL,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_requirement_unit_resolution_heads_version_ck" CHECK ("project_requirement_unit_resolution_heads"."version">0)
);
--> statement-breakpoint
ALTER TABLE "project_planning_package_items" ADD COLUMN "unit_resolution_id" bigint;
--> statement-breakpoint
CREATE UNIQUE INDEX "project_requirement_versions_id_project_uq" ON "project_requirement_versions" USING btree ("id","project_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "project_requirement_items_id_version_uq" ON "project_requirement_items" USING btree ("id","requirement_version_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "project_requirement_unit_resolution_versions_item_no_uq" ON "project_requirement_unit_resolution_versions" USING btree ("requirement_item_id","resolution_version_no");
--> statement-breakpoint
CREATE UNIQUE INDEX "project_requirement_unit_resolution_versions_chain_no_uq" ON "project_requirement_unit_resolution_versions" USING btree ("project_id","requirement_version_id","requirement_item_id","resolution_version_no");
--> statement-breakpoint
CREATE UNIQUE INDEX "project_requirement_unit_resolution_versions_id_chain_uq" ON "project_requirement_unit_resolution_versions" USING btree ("id","project_id","requirement_version_id","requirement_item_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "project_requirement_unit_resolution_versions_id_item_unit_uq" ON "project_requirement_unit_resolution_versions" USING btree ("id","requirement_item_id","unit_id");
--> statement-breakpoint
CREATE INDEX "project_requirement_unit_resolution_versions_project_idx" ON "project_requirement_unit_resolution_versions" USING btree ("project_id","requirement_version_id","requirement_item_id","resolution_version_no");
--> statement-breakpoint
CREATE INDEX "project_requirement_unit_resolution_versions_unit_idx" ON "project_requirement_unit_resolution_versions" USING btree ("unit_id","id");
--> statement-breakpoint
CREATE INDEX "project_requirement_unit_resolution_versions_request_idx" ON "project_requirement_unit_resolution_versions" USING btree ("request_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "project_requirement_unit_resolution_heads_current_uq" ON "project_requirement_unit_resolution_heads" USING btree ("current_resolution_id");
--> statement-breakpoint
CREATE INDEX "project_requirement_unit_resolution_heads_project_idx" ON "project_requirement_unit_resolution_heads" USING btree ("project_id","requirement_version_id","requirement_item_id");
--> statement-breakpoint
CREATE INDEX "project_planning_package_items_unit_resolution_idx" ON "project_planning_package_items" USING btree ("unit_resolution_id","id") WHERE "project_planning_package_items"."unit_resolution_id" is not null;
--> statement-breakpoint

-- Backfill only immutable source rows that already declared a stable Unit ID. Unknown
-- units remain unresolved; no name lookup, BOM inference, or default Unit is allowed.
INSERT INTO "project_requirement_unit_resolution_versions" (
	"project_id","requirement_version_id","requirement_item_id","resolution_version_no",
	"unit_id","source_type","supersedes_resolution_id","resolved_by","resolved_at",
	"request_id","content_digest"
)
SELECT
	rv."project_id",ri."requirement_version_id",ri."id",1,
	ri."unit_id",'REQUIREMENT_DECLARED',null,rv."created_by",ri."created_at",
	'00360000-0000-4000-8000-000000000001'::uuid,
	encode(digest(concat_ws('|',
		'project-requirement-unit-resolution-v1',rv."project_id"::text,
		ri."requirement_version_id"::text,ri."id"::text,'1',ri."unit_id"::text,
		'REQUIREMENT_DECLARED','',rv."content_digest"
	),'sha256'),'hex')
FROM "project_requirement_items" ri
JOIN "project_requirement_versions" rv ON rv."id"=ri."requirement_version_id"
WHERE ri."unit_pending"=false AND ri."unit_id" is not null
ORDER BY ri."id";
--> statement-breakpoint
INSERT INTO "project_requirement_unit_resolution_heads" (
	"requirement_item_id","project_id","requirement_version_id","current_resolution_id","version","updated_at"
)
SELECT
	rv."requirement_item_id",rv."project_id",rv."requirement_version_id",rv."id",1,rv."resolved_at"
FROM "project_requirement_unit_resolution_versions" rv
WHERE rv."source_type"='REQUIREMENT_DECLARED' AND rv."resolution_version_no"=1
ORDER BY rv."requirement_item_id";
--> statement-breakpoint
DO $$
DECLARE
	declared_count bigint;
	unresolved_pending_count bigint;
BEGIN
	SELECT count(*) INTO declared_count
	FROM project_requirement_unit_resolution_versions
	WHERE source_type='REQUIREMENT_DECLARED';

	SELECT count(*) INTO unresolved_pending_count
	FROM project_requirement_items
	WHERE unit_pending=true AND unit_id is null;

	RAISE NOTICE '0036 requirement unit backfill: declared=%, unresolved_pending=%',
		declared_count, unresolved_pending_count;
END $$;
--> statement-breakpoint

ALTER TABLE "project_requirement_unit_resolution_versions" ADD CONSTRAINT "project_requirement_unit_resolution_versions_project_id_business_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."business_projects"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_requirement_unit_resolution_versions" ADD CONSTRAINT "project_requirement_unit_resolution_versions_requirement_version_id_project_requirement_versions_id_fk" FOREIGN KEY ("requirement_version_id") REFERENCES "public"."project_requirement_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_requirement_unit_resolution_versions" ADD CONSTRAINT "project_requirement_unit_resolution_versions_requirement_item_id_project_requirement_items_id_fk" FOREIGN KEY ("requirement_item_id") REFERENCES "public"."project_requirement_items"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_requirement_unit_resolution_versions" ADD CONSTRAINT "project_requirement_unit_resolution_versions_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_requirement_unit_resolution_versions" ADD CONSTRAINT "project_requirement_unit_resolution_versions_supersedes_resolution_id_project_requirement_unit_resolution_versions_id_fk" FOREIGN KEY ("supersedes_resolution_id") REFERENCES "public"."project_requirement_unit_resolution_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_requirement_unit_resolution_versions" ADD CONSTRAINT "project_requirement_unit_resolution_versions_resolved_by_app_users_username_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_requirement_unit_resolution_versions" ADD CONSTRAINT "project_requirement_unit_resolution_versions_project_version_fk" FOREIGN KEY ("requirement_version_id","project_id") REFERENCES "public"."project_requirement_versions"("id","project_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_requirement_unit_resolution_versions" ADD CONSTRAINT "project_requirement_unit_resolution_versions_item_version_fk" FOREIGN KEY ("requirement_item_id","requirement_version_id") REFERENCES "public"."project_requirement_items"("id","requirement_version_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_requirement_unit_resolution_versions" ADD CONSTRAINT "project_requirement_unit_resolution_versions_supersedes_chain_fk" FOREIGN KEY ("supersedes_resolution_id","project_id","requirement_version_id","requirement_item_id") REFERENCES "public"."project_requirement_unit_resolution_versions"("id","project_id","requirement_version_id","requirement_item_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_requirement_unit_resolution_heads" ADD CONSTRAINT "project_requirement_unit_resolution_heads_requirement_item_id_project_requirement_items_id_fk" FOREIGN KEY ("requirement_item_id") REFERENCES "public"."project_requirement_items"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_requirement_unit_resolution_heads" ADD CONSTRAINT "project_requirement_unit_resolution_heads_project_id_business_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."business_projects"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_requirement_unit_resolution_heads" ADD CONSTRAINT "project_requirement_unit_resolution_heads_requirement_version_id_project_requirement_versions_id_fk" FOREIGN KEY ("requirement_version_id") REFERENCES "public"."project_requirement_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_requirement_unit_resolution_heads" ADD CONSTRAINT "project_requirement_unit_resolution_heads_current_resolution_id_project_requirement_unit_resolution_versions_id_fk" FOREIGN KEY ("current_resolution_id") REFERENCES "public"."project_requirement_unit_resolution_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_requirement_unit_resolution_heads" ADD CONSTRAINT "project_requirement_unit_resolution_heads_project_version_fk" FOREIGN KEY ("requirement_version_id","project_id") REFERENCES "public"."project_requirement_versions"("id","project_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_requirement_unit_resolution_heads" ADD CONSTRAINT "project_requirement_unit_resolution_heads_item_version_fk" FOREIGN KEY ("requirement_item_id","requirement_version_id") REFERENCES "public"."project_requirement_items"("id","requirement_version_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_requirement_unit_resolution_heads" ADD CONSTRAINT "project_requirement_unit_resolution_heads_current_chain_fk" FOREIGN KEY ("current_resolution_id","project_id","requirement_version_id","requirement_item_id") REFERENCES "public"."project_requirement_unit_resolution_versions"("id","project_id","requirement_version_id","requirement_item_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_planning_package_items" ADD CONSTRAINT "project_planning_package_items_unit_resolution_id_project_requirement_unit_resolution_versions_id_fk" FOREIGN KEY ("unit_resolution_id") REFERENCES "public"."project_requirement_unit_resolution_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_planning_package_items" ADD CONSTRAINT "project_planning_package_items_unit_resolution_provenance_fk" FOREIGN KEY ("unit_resolution_id","requirement_item_id","unit_id") REFERENCES "public"."project_requirement_unit_resolution_versions"("id","requirement_item_id","unit_id") ON DELETE restrict ON UPDATE no action;
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
			AND pp.status<>'RETURNED'
	) THEN
		RAISE EXCEPTION 'requirement unit resolution is locked by current package' USING ERRCODE='55000';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_requirement_unit_resolution_head_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	current_resolution_version integer;
	current_source_type text;
BEGIN
	IF TG_OP='DELETE' THEN
		RAISE EXCEPTION 'requirement unit resolution heads cannot be deleted' USING ERRCODE='55000';
	END IF;
	IF current_setting('cyd.planning_service_write', true) IS DISTINCT FROM 'allowed'
		AND NOT (
			TG_OP='INSERT'
			AND current_setting('cyd.project_service_write', true) IS NOT DISTINCT FROM 'allowed'
		) THEN
		RAISE EXCEPTION 'requirement unit resolution head writes require an owning service' USING ERRCODE='42501';
	END IF;
	IF TG_OP='INSERT' AND NEW.version<>1 THEN
		RAISE EXCEPTION 'initial requirement unit resolution head version must be one' USING ERRCODE='23514';
	END IF;
	IF TG_OP='UPDATE' THEN
		IF NEW.requirement_item_id IS DISTINCT FROM OLD.requirement_item_id
			OR NEW.project_id IS DISTINCT FROM OLD.project_id
			OR NEW.requirement_version_id IS DISTINCT FROM OLD.requirement_version_id THEN
			RAISE EXCEPTION 'stable requirement unit resolution head fields are immutable' USING ERRCODE='55000';
		END IF;
		IF NEW.version<>OLD.version+1 OR NEW.current_resolution_id=OLD.current_resolution_id THEN
			RAISE EXCEPTION 'requirement unit resolution head version must advance once' USING ERRCODE='23514';
		END IF;
	END IF;
	SELECT resolution_version_no,source_type INTO current_resolution_version,current_source_type
	FROM project_requirement_unit_resolution_versions
	WHERE id=NEW.current_resolution_id
		AND project_id=NEW.project_id
		AND requirement_version_id=NEW.requirement_version_id
		AND requirement_item_id=NEW.requirement_item_id;
	IF current_resolution_version IS DISTINCT FROM NEW.version THEN
		RAISE EXCEPTION 'requirement unit resolution head does not match resolution version' USING ERRCODE='23514';
	END IF;
	IF current_setting('cyd.planning_service_write', true) IS DISTINCT FROM 'allowed'
		AND NOT (
			TG_OP='INSERT'
			AND current_setting('cyd.project_service_write', true) IS NOT DISTINCT FROM 'allowed'
			AND current_source_type='REQUIREMENT_DECLARED'
			AND current_resolution_version=1
		) THEN
		RAISE EXCEPTION 'requirement unit resolution head writes require an owning service' USING ERRCODE='42501';
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
	IF NEW.unit_resolution_id IS NULL THEN
		RAISE EXCEPTION 'planning package item requires unit resolution provenance' USING ERRCODE='23514';
	END IF;
	IF NOT EXISTS (
		SELECT 1
		FROM project_planning_packages pp
		JOIN project_requirement_items ri ON ri.id=NEW.requirement_item_id AND ri.requirement_version_id=pp.requirement_version_id
		JOIN bom_versions bv ON bv.id=NEW.bom_version_id AND bv.product_version_id=NEW.product_version_id
		JOIN project_requirement_unit_resolution_versions ur ON ur.id=NEW.unit_resolution_id
			AND ur.project_id=pp.project_id
			AND ur.requirement_version_id=pp.requirement_version_id
			AND ur.requirement_item_id=NEW.requirement_item_id
			AND ur.unit_id=NEW.unit_id
		JOIN project_requirement_unit_resolution_heads uh ON uh.requirement_item_id=NEW.requirement_item_id
			AND uh.project_id=pp.project_id
			AND uh.requirement_version_id=pp.requirement_version_id
			AND uh.current_resolution_id=ur.id
		JOIN units u ON u.id=ur.unit_id AND u.enabled=true
		WHERE pp.id=NEW.package_id
	) THEN
		RAISE EXCEPTION 'planning package item references are inconsistent' USING ERRCODE='23514';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER project_requirement_unit_resolution_versions_immutable BEFORE INSERT OR UPDATE OR DELETE ON project_requirement_unit_resolution_versions FOR EACH ROW EXECUTE FUNCTION cyd_requirement_unit_resolution_version_guard();
--> statement-breakpoint
CREATE TRIGGER project_requirement_unit_resolution_heads_service_guard BEFORE INSERT OR UPDATE OR DELETE ON project_requirement_unit_resolution_heads FOR EACH ROW EXECUTE FUNCTION cyd_requirement_unit_resolution_head_guard();
