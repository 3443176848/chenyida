CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE TABLE "supplier_mapping_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mapping_uid" uuid NOT NULL,
	"mapping_version_id" bigint NOT NULL,
	"mapping_version_no" integer NOT NULL,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor" text NOT NULL,
	"result" text DEFAULT 'SUCCESS' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_mapping_events_type_ck" CHECK ("supplier_mapping_events"."event_type" in ('CREATED','DRAFT_EDITED','SUBMITTED','APPROVED','REJECTED','NEW_VERSION_CREATED','SUPERSEDED')),
	CONSTRAINT "supplier_mapping_events_status_ck" CHECK ("supplier_mapping_events"."to_status" in ('DRAFT','PENDING_REVIEW','ACTIVE','REJECTED','INACTIVE') and ("supplier_mapping_events"."from_status" is null or "supplier_mapping_events"."from_status" in ('DRAFT','PENDING_REVIEW','ACTIVE','REJECTED','INACTIVE'))),
	CONSTRAINT "supplier_mapping_events_result_ck" CHECK ("supplier_mapping_events"."result"='SUCCESS'),
	CONSTRAINT "supplier_mapping_events_version_ck" CHECK ("supplier_mapping_events"."mapping_version_no">0)
);
--> statement-breakpoint
CREATE TABLE "supplier_mapping_supplier_part_keys" (
	"supplier_id" bigint NOT NULL,
	"normalized_supplier_item_code" text NOT NULL,
	"mapping_uid" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_mapping_supplier_part_keys_code_ck" CHECK (char_length("supplier_mapping_supplier_part_keys"."normalized_supplier_item_code") between 1 and 160 and "supplier_mapping_supplier_part_keys"."normalized_supplier_item_code"=btrim(upper("supplier_mapping_supplier_part_keys"."normalized_supplier_item_code")))
);
--> statement-breakpoint
ALTER TABLE "supplier_mappings" DROP CONSTRAINT "supplier_mappings_status_ck";--> statement-breakpoint
ALTER TABLE "supplier_mappings" DROP CONSTRAINT "supplier_mappings_version_ck";--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD COLUMN "supplier_item_code_normalized" text;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD COLUMN "mapping_uid" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD COLUMN "mapping_version_no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD COLUMN "supersedes_mapping_version_id" bigint;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD COLUMN "superseded_by_mapping_version_id" bigint;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD COLUMN "content_digest" text;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD COLUMN "created_request_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD COLUMN "submitted_by" text;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD COLUMN "submitted_request_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD COLUMN "reviewed_request_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD COLUMN "review_outcome" text;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD COLUMN "review_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint

-- Existing rows remain valid legacy ACTIVE/INACTIVE facts.  They receive a stable
-- identity and creation request provenance, but no invented submit/review facts.
UPDATE "supplier_mappings"
SET "supplier_item_code_normalized"=upper(btrim("supplier_item_code")),
	"created_request_id"="request_id"
WHERE "supplier_item_code_normalized" is null OR "created_request_id" is null;
--> statement-breakpoint

-- Fail closed instead of silently choosing a winner when historical data violates
-- the governance identities introduced by this migration.
DO $$
DECLARE
	duplicate_part_count bigint;
	overlapping_mapping_count bigint;
BEGIN
	SELECT count(*) INTO duplicate_part_count
	FROM (
		SELECT supplier_id,upper(btrim(supplier_item_code))
		FROM supplier_mappings
		WHERE supplier_id is not null
		GROUP BY supplier_id,upper(btrim(supplier_item_code))
		HAVING count(*)>1
	) conflicts;

	SELECT count(*) INTO overlapping_mapping_count
	FROM supplier_mappings left_mapping
	JOIN supplier_mappings right_mapping
		ON right_mapping.id>left_mapping.id
		AND right_mapping.supplier_id=left_mapping.supplier_id
		AND right_mapping.material_id=left_mapping.material_id
		AND right_mapping.status='ACTIVE'
		AND right_mapping.conversion_numerator=right_mapping.conversion_denominator
		AND tstzrange(right_mapping.valid_from,coalesce(right_mapping.valid_to,'infinity'::timestamptz),'[)')
			&& tstzrange(left_mapping.valid_from,coalesce(left_mapping.valid_to,'infinity'::timestamptz),'[)')
	WHERE left_mapping.supplier_id is not null
		AND left_mapping.status='ACTIVE'
		AND left_mapping.conversion_numerator=left_mapping.conversion_denominator;

	IF duplicate_part_count<>0 OR overlapping_mapping_count<>0 THEN
		RAISE EXCEPTION '0038 supplier mapping conflicts require manual resolution: duplicate_parts=%, overlapping_active_1_to_1=%',
			duplicate_part_count,overlapping_mapping_count USING ERRCODE='23514';
	END IF;
END $$;
--> statement-breakpoint

-- The legacy content tuple index treated a controlled version with unchanged
-- identity/effective date as a duplicate. Stable UID/version, supplier-part
-- claims and the ACTIVE Supplier/Material period exclusion supersede it.
DROP INDEX "supplier_mappings_identity_period_uq";
--> statement-breakpoint

INSERT INTO "supplier_mapping_supplier_part_keys"(
	"supplier_id","normalized_supplier_item_code","mapping_uid","created_by","request_id","created_at"
)
SELECT "supplier_id","supplier_item_code_normalized","mapping_uid","created_by","created_request_id","created_at"
FROM "supplier_mappings"
WHERE "supplier_id" is not null;
--> statement-breakpoint
ALTER TABLE "supplier_mapping_events" ADD CONSTRAINT "supplier_mapping_events_mapping_version_id_supplier_mappings_id_fk" FOREIGN KEY ("mapping_version_id") REFERENCES "public"."supplier_mappings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_mapping_events" ADD CONSTRAINT "supplier_mapping_events_actor_app_users_username_fk" FOREIGN KEY ("actor") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_mapping_supplier_part_keys" ADD CONSTRAINT "supplier_mapping_supplier_part_keys_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_mapping_supplier_part_keys" ADD CONSTRAINT "supplier_mapping_supplier_part_keys_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_mapping_events_request_type_uq" ON "supplier_mapping_events" USING btree ("request_id","mapping_version_id","event_type");--> statement-breakpoint
CREATE INDEX "supplier_mapping_events_mapping_history_idx" ON "supplier_mapping_events" USING btree ("mapping_uid","mapping_version_no","id");--> statement-breakpoint
CREATE INDEX "supplier_mapping_events_review_queue_idx" ON "supplier_mapping_events" USING btree ("event_type","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_mapping_supplier_part_keys_identity_uq" ON "supplier_mapping_supplier_part_keys" USING btree ("supplier_id","normalized_supplier_item_code");--> statement-breakpoint
CREATE INDEX "supplier_mapping_supplier_part_keys_mapping_idx" ON "supplier_mapping_supplier_part_keys" USING btree ("mapping_uid","supplier_id");--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_supersedes_mapping_version_id_supplier_mappings_id_fk" FOREIGN KEY ("supersedes_mapping_version_id") REFERENCES "public"."supplier_mappings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_superseded_by_mapping_version_id_supplier_mappings_id_fk" FOREIGN KEY ("superseded_by_mapping_version_id") REFERENCES "public"."supplier_mappings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_submitted_by_app_users_username_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_reviewed_by_app_users_username_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_mappings_uid_version_uq" ON "supplier_mappings" USING btree ("mapping_uid","mapping_version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_mappings_supersedes_uq" ON "supplier_mappings" USING btree ("supersedes_mapping_version_id") WHERE "supplier_mappings"."supersedes_mapping_version_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_mappings_superseded_by_uq" ON "supplier_mappings" USING btree ("superseded_by_mapping_version_id") WHERE "supplier_mappings"."superseded_by_mapping_version_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_mappings_open_draft_uq" ON "supplier_mappings" USING btree ("mapping_uid") WHERE "supplier_mappings"."status"='DRAFT';--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_mappings_pending_review_uq" ON "supplier_mappings" USING btree ("mapping_uid") WHERE "supplier_mappings"."status"='PENDING_REVIEW';--> statement-breakpoint
CREATE INDEX "supplier_mappings_review_queue_idx" ON "supplier_mappings" USING btree ("status","submitted_at","id");--> statement-breakpoint
CREATE INDEX "supplier_mappings_uid_history_idx" ON "supplier_mappings" USING btree ("mapping_uid","mapping_version_no","id");--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_digest_ck" CHECK ("supplier_mappings"."content_digest" is null or "supplier_mappings"."content_digest" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_review_outcome_ck" CHECK ("supplier_mappings"."review_outcome" is null or "supplier_mappings"."review_outcome" in ('APPROVED','REJECTED'));--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_status_ck" CHECK ("supplier_mappings"."status" in ('DRAFT','PENDING_REVIEW','ACTIVE','REJECTED','INACTIVE'));--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_version_ck" CHECK ("supplier_mappings"."version" > 0 and "supplier_mappings"."mapping_version_no" > 0);
--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_governed_lifecycle_ck" CHECK (
	("status"='DRAFT'
		AND "submitted_by" is null AND "submitted_at" is null AND "submitted_request_id" is null
		AND "reviewed_by" is null AND "reviewed_at" is null AND "reviewed_request_id" is null
		AND "review_outcome" is null AND "content_digest" is null AND "review_reason"='')
	OR ("status"='PENDING_REVIEW'
		AND "submitted_by" is not null AND "submitted_at" is not null AND "submitted_request_id" is not null
		AND "reviewed_by" is null AND "reviewed_at" is null AND "reviewed_request_id" is null
		AND "review_outcome" is null AND "content_digest" is not null AND "review_reason"='')
	OR ("status"='REJECTED'
		AND "submitted_by" is not null AND "submitted_at" is not null AND "submitted_request_id" is not null
		AND "reviewed_by" is not null AND "reviewed_at" is not null AND "reviewed_request_id" is not null
		AND "review_outcome"='REJECTED' AND "content_digest" is not null
		AND char_length(btrim("review_reason")) between 1 and 500)
	OR ("status" in ('ACTIVE','INACTIVE') AND (
		("submitted_by" is null AND "submitted_at" is null AND "submitted_request_id" is null
			AND "reviewed_by" is null AND "reviewed_at" is null AND "reviewed_request_id" is null
			AND "review_outcome" is null AND "content_digest" is null AND "review_reason"='')
		OR
		("submitted_by" is not null AND "submitted_at" is not null AND "submitted_request_id" is not null
			AND "reviewed_by" is not null AND "reviewed_at" is not null AND "reviewed_request_id" is not null
			AND "review_outcome"='APPROVED' AND "content_digest" is not null AND "review_reason"='')
	))
);
--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_governed_text_ck" CHECK (
	char_length(btrim("supplier_item_code")) between 1 and 160
	AND ("supplier_item_code_normalized" is null OR char_length("supplier_item_code_normalized") between 1 and 160)
	AND char_length("supplier_item_name")<=200
	AND char_length("supplier_specification")<=1000
	AND char_length("manufacturer")<=160
	AND char_length("mpn")<=160
	AND char_length("revision")<=80
	AND char_length("review_reason")<=500
);
--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_mappings_active_supplier_part_uq"
	ON "supplier_mappings" ("supplier_id",upper(btrim("supplier_item_code")))
	WHERE "status"='ACTIVE' AND "supplier_id" is not null;
--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_active_material_period_excl"
	EXCLUDE USING gist (
		"supplier_id" WITH =,
		"material_id" WITH =,
		tstzrange("valid_from",coalesce("valid_to",'infinity'::timestamptz),'[)') WITH &&
	)
	WHERE ("status"='ACTIVE' AND "supplier_id" is not null AND "conversion_numerator"="conversion_denominator");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_supplier_mapping_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	prior_version_no integer;
	prior_status text;
	managed_insert boolean;
BEGIN
	managed_insert := TG_OP='INSERT';

	IF TG_OP='DELETE' THEN
		RAISE EXCEPTION 'supplier mapping versions cannot be deleted' USING ERRCODE='55000';
	END IF;

	IF (TG_OP='UPDATE' OR managed_insert)
		AND current_setting('cyd.supplier_mapping_service_write',true) IS DISTINCT FROM 'allowed' THEN
		RAISE EXCEPTION 'supplier mapping writes require SupplierMappingService' USING ERRCODE='42501';
	END IF;

	IF TG_OP='INSERT' AND managed_insert THEN
		IF NEW.status<>'DRAFT' OR NEW.version<>1 OR NEW.created_request_id is null
			OR NEW.supplier_id is null OR NEW.purchase_unit_id is null
			OR NEW.supplier_item_code_normalized is null THEN
			RAISE EXCEPTION 'governed supplier mapping versions must start as complete DRAFT facts' USING ERRCODE='23514';
		END IF;
		IF NEW.mapping_version_no=1 AND NEW.supersedes_mapping_version_id is not null THEN
			RAISE EXCEPTION 'initial supplier mapping version cannot supersede another version' USING ERRCODE='23514';
		ELSIF NEW.mapping_version_no>1 THEN
			SELECT mapping_version_no,status INTO prior_version_no,prior_status
			FROM supplier_mappings
			WHERE id=NEW.supersedes_mapping_version_id AND mapping_uid=NEW.mapping_uid;
			IF prior_version_no IS DISTINCT FROM NEW.mapping_version_no-1 OR prior_status NOT IN ('ACTIVE','REJECTED') THEN
				RAISE EXCEPTION 'supplier mapping version chain is not consecutive' USING ERRCODE='23514';
			END IF;
		END IF;
		IF NOT EXISTS (
			SELECT 1 FROM supplier_mapping_supplier_part_keys key
			WHERE key.supplier_id=NEW.supplier_id
				AND key.normalized_supplier_item_code=NEW.supplier_item_code_normalized
				AND key.mapping_uid=NEW.mapping_uid
		) THEN
			RAISE EXCEPTION 'supplier mapping part number is not claimed by this stable mapping' USING ERRCODE='23514';
		END IF;
	END IF;

	IF TG_OP='UPDATE' THEN
		IF NEW.id IS DISTINCT FROM OLD.id
			OR NEW.mapping_uid IS DISTINCT FROM OLD.mapping_uid
			OR NEW.mapping_version_no IS DISTINCT FROM OLD.mapping_version_no
			OR NEW.supersedes_mapping_version_id IS DISTINCT FROM OLD.supersedes_mapping_version_id
			OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
			OR NEW.supplier_item_code IS DISTINCT FROM OLD.supplier_item_code
			OR NEW.supplier_item_code_normalized IS DISTINCT FROM OLD.supplier_item_code_normalized
			OR NEW.created_by IS DISTINCT FROM OLD.created_by
			OR NEW.created_at IS DISTINCT FROM OLD.created_at
			OR NEW.created_request_id IS DISTINCT FROM OLD.created_request_id THEN
			RAISE EXCEPTION 'stable supplier mapping version fields are immutable' USING ERRCODE='55000';
		END IF;
		IF NEW.version<>OLD.version+1 OR NEW.updated_by=OLD.updated_by AND NEW.request_id=OLD.request_id THEN
			RAISE EXCEPTION 'supplier mapping CAS version must advance exactly once' USING ERRCODE='23514';
		END IF;

		IF OLD.status='DRAFT' AND NEW.status='DRAFT' THEN
			IF NEW.submitted_at is not null OR NEW.reviewed_at is not null THEN
				RAISE EXCEPTION 'draft supplier mapping cannot contain decision facts' USING ERRCODE='23514';
			END IF;
		ELSIF OLD.status='DRAFT' AND NEW.status='PENDING_REVIEW' THEN
			IF ROW(NEW.material_id,NEW.supplier_id,NEW.supplier_name,NEW.supplier_key,NEW.supplier_item_code,NEW.supplier_item_code_normalized,NEW.supplier_item_name,NEW.supplier_specification,NEW.manufacturer,NEW.mpn,NEW.revision,NEW.purchase_uom,NEW.purchase_unit_id,NEW.conversion_numerator,NEW.conversion_denominator,NEW.valid_from,NEW.valid_to)
				IS DISTINCT FROM ROW(OLD.material_id,OLD.supplier_id,OLD.supplier_name,OLD.supplier_key,OLD.supplier_item_code,OLD.supplier_item_code_normalized,OLD.supplier_item_name,OLD.supplier_specification,OLD.manufacturer,OLD.mpn,OLD.revision,OLD.purchase_uom,OLD.purchase_unit_id,OLD.conversion_numerator,OLD.conversion_denominator,OLD.valid_from,OLD.valid_to)
				OR NEW.submitted_by is null OR NEW.submitted_at is null OR NEW.submitted_request_id is null OR NEW.content_digest is null THEN
				RAISE EXCEPTION 'supplier mapping submit must freeze a complete body' USING ERRCODE='23514';
			END IF;
		ELSIF OLD.status='PENDING_REVIEW' AND NEW.status IN ('ACTIVE','REJECTED') THEN
			IF ROW(NEW.material_id,NEW.supplier_id,NEW.supplier_name,NEW.supplier_key,NEW.supplier_item_code,NEW.supplier_item_code_normalized,NEW.supplier_item_name,NEW.supplier_specification,NEW.manufacturer,NEW.mpn,NEW.revision,NEW.purchase_uom,NEW.purchase_unit_id,NEW.conversion_numerator,NEW.conversion_denominator,NEW.valid_from,NEW.valid_to,NEW.content_digest,NEW.submitted_by,NEW.submitted_at,NEW.submitted_request_id)
				IS DISTINCT FROM ROW(OLD.material_id,OLD.supplier_id,OLD.supplier_name,OLD.supplier_key,OLD.supplier_item_code,OLD.supplier_item_code_normalized,OLD.supplier_item_name,OLD.supplier_specification,OLD.manufacturer,OLD.mpn,OLD.revision,OLD.purchase_uom,OLD.purchase_unit_id,OLD.conversion_numerator,OLD.conversion_denominator,OLD.valid_from,OLD.valid_to,OLD.content_digest,OLD.submitted_by,OLD.submitted_at,OLD.submitted_request_id)
				OR NEW.reviewed_by is null OR NEW.reviewed_at is null OR NEW.reviewed_request_id is null
				OR NEW.reviewed_by=NEW.created_by
				OR (NEW.status='ACTIVE' AND (NEW.review_outcome<>'APPROVED' OR NEW.review_reason<>''))
				OR (NEW.status='REJECTED' AND (NEW.review_outcome<>'REJECTED' OR char_length(btrim(NEW.review_reason))<1)) THEN
				RAISE EXCEPTION 'supplier mapping review facts are incomplete or violate separation of duties' USING ERRCODE='23514';
			END IF;
		ELSIF OLD.status='ACTIVE' AND NEW.status='INACTIVE' THEN
			IF ROW(NEW.material_id,NEW.supplier_id,NEW.supplier_name,NEW.supplier_key,NEW.supplier_item_code,NEW.supplier_item_code_normalized,NEW.supplier_item_name,NEW.supplier_specification,NEW.manufacturer,NEW.mpn,NEW.revision,NEW.purchase_uom,NEW.purchase_unit_id,NEW.conversion_numerator,NEW.conversion_denominator,NEW.valid_from,NEW.valid_to,NEW.content_digest,NEW.submitted_by,NEW.submitted_at,NEW.submitted_request_id,NEW.reviewed_by,NEW.reviewed_at,NEW.reviewed_request_id,NEW.review_outcome,NEW.review_reason)
				IS DISTINCT FROM ROW(OLD.material_id,OLD.supplier_id,OLD.supplier_name,OLD.supplier_key,OLD.supplier_item_code,OLD.supplier_item_code_normalized,OLD.supplier_item_name,OLD.supplier_specification,OLD.manufacturer,OLD.mpn,OLD.revision,OLD.purchase_uom,OLD.purchase_unit_id,OLD.conversion_numerator,OLD.conversion_denominator,OLD.valid_from,OLD.valid_to,OLD.content_digest,OLD.submitted_by,OLD.submitted_at,OLD.submitted_request_id,OLD.reviewed_by,OLD.reviewed_at,OLD.reviewed_request_id,OLD.review_outcome,OLD.review_reason)
				OR NEW.superseded_by_mapping_version_id is null THEN
				RAISE EXCEPTION 'active supplier mapping can only become a controlled superseded fact' USING ERRCODE='23514';
			END IF;
		ELSE
			RAISE EXCEPTION 'invalid supplier mapping state transition' USING ERRCODE='23514';
		END IF;
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_supplier_mapping_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP<>'INSERT' THEN
		RAISE EXCEPTION 'supplier mapping events are immutable' USING ERRCODE='55000';
	END IF;
	IF current_setting('cyd.supplier_mapping_service_write',true) IS DISTINCT FROM 'allowed' THEN
		RAISE EXCEPTION 'supplier mapping events require SupplierMappingService' USING ERRCODE='42501';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM supplier_mappings mapping
		WHERE mapping.id=NEW.mapping_version_id AND mapping.mapping_uid=NEW.mapping_uid
			AND mapping.mapping_version_no=NEW.mapping_version_no
	) THEN
		RAISE EXCEPTION 'supplier mapping event lineage mismatch' USING ERRCODE='23514';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_supplier_mapping_part_key_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP<>'INSERT' THEN
		RAISE EXCEPTION 'supplier mapping part number claims are immutable' USING ERRCODE='55000';
	END IF;
	IF current_setting('cyd.supplier_mapping_service_write',true) IS DISTINCT FROM 'allowed' THEN
		RAISE EXCEPTION 'supplier mapping part number claims require SupplierMappingService' USING ERRCODE='42501';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER "supplier_mappings_version_guard"
	BEFORE INSERT OR UPDATE OR DELETE ON "supplier_mappings"
	FOR EACH ROW EXECUTE FUNCTION cyd_supplier_mapping_version_guard();
--> statement-breakpoint
CREATE TRIGGER "supplier_mapping_events_guard"
	BEFORE INSERT OR UPDATE OR DELETE ON "supplier_mapping_events"
	FOR EACH ROW EXECUTE FUNCTION cyd_supplier_mapping_event_guard();
--> statement-breakpoint
CREATE TRIGGER "supplier_mapping_supplier_part_keys_guard"
	BEFORE INSERT OR UPDATE OR DELETE ON "supplier_mapping_supplier_part_keys"
	FOR EACH ROW EXECUTE FUNCTION cyd_supplier_mapping_part_key_guard();
