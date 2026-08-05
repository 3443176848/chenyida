-- SELFHOST-UAT-FIX-22: relational RFQ Mapping bindings and complete RFQ lifecycle credentials.
-- This migration is intentionally expand-only. Existing RFQs are not backfilled:
-- a historical DRAFT without binding rows remains explicitly unbound.

-- Existing rows are explicitly generation 1.  Only RFQs inserted after this
-- migration receive generation 2, so a historical draft can never be relabelled
-- as having create-time Mapping bindings or a create-time lifecycle event.
ALTER TABLE "procurement_rfqs" ADD COLUMN "traceability_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "procurement_rfqs" ADD CONSTRAINT "procurement_rfqs_traceability_version_ck" CHECK ("traceability_version" in (1,2));
--> statement-breakpoint
ALTER TABLE "procurement_rfqs" ALTER COLUMN "traceability_version" SET DEFAULT 2;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_procurement_rfq_generation_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF current_setting('cyd.procurement_sourcing_service_write',true) IS DISTINCT FROM 'allowed' THEN
		RAISE EXCEPTION 'RFQ creation requires ProcurementSourcingService' USING ERRCODE='42501';
	END IF;
	IF NEW.traceability_version IS DISTINCT FROM 2
		OR NEW.status IS DISTINCT FROM 'DRAFT'
		OR NEW.version IS DISTINCT FROM 1
		OR NEW.issued_by is not null OR NEW.issued_at is not null OR NEW.closed_at is not null
		OR NEW.created_at IS DISTINCT FROM transaction_timestamp() THEN
		RAISE EXCEPTION 'new RFQ must be a generation-2 DRAFT created in the current service transaction' USING ERRCODE='23514';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "procurement_rfqs_generation_insert_guard"
	BEFORE INSERT ON "procurement_rfqs"
	FOR EACH ROW EXECUTE FUNCTION cyd_procurement_rfq_generation_insert_guard();
--> statement-breakpoint

ALTER TABLE "procurement_sourcing_events" ADD COLUMN "credential_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "procurement_sourcing_events" ADD COLUMN "result" text DEFAULT 'SUCCESS' NOT NULL;
--> statement-breakpoint
ALTER TABLE "procurement_sourcing_events" ADD COLUMN "idempotency_key_digest" text;
--> statement-breakpoint
ALTER TABLE "procurement_sourcing_events" ADD COLUMN "old_version" integer;
--> statement-breakpoint
ALTER TABLE "procurement_sourcing_events" ADD COLUMN "new_version" integer;
--> statement-breakpoint
ALTER TABLE "procurement_sourcing_events" ADD COLUMN "from_status" text;
--> statement-breakpoint
ALTER TABLE "procurement_sourcing_events" ADD COLUMN "to_status" text;
--> statement-breakpoint
ALTER TABLE "procurement_sourcing_events" ADD COLUMN "scope_digest" text;
--> statement-breakpoint

ALTER TABLE "procurement_sourcing_events" DROP CONSTRAINT "procurement_sourcing_events_type_ck";
--> statement-breakpoint
ALTER TABLE "procurement_sourcing_events" ADD CONSTRAINT "procurement_sourcing_events_type_ck" CHECK (
	"event_type" in ('RFQ_CREATED','RFQ_MAPPING_CONFIRMED','RFQ_ISSUED','QUOTE_SUBMITTED','QUOTE_SUPERSEDED','COMPARISON_GENERATED','AWARDED','AWARD_REVERSED')
);
--> statement-breakpoint
ALTER TABLE "procurement_sourcing_events" ADD CONSTRAINT "procurement_sourcing_events_result_ck" CHECK ("result"='SUCCESS');
--> statement-breakpoint
ALTER TABLE "procurement_sourcing_events" ADD CONSTRAINT "procurement_sourcing_events_credential_version_ck" CHECK ("credential_version" in (1,2));
--> statement-breakpoint
ALTER TABLE "procurement_sourcing_events" ADD CONSTRAINT "procurement_sourcing_events_digest_ck" CHECK (
	("idempotency_key_digest" is null OR "idempotency_key_digest" ~ '^[0-9a-f]{64}$')
	AND ("scope_digest" is null OR "scope_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "procurement_sourcing_events" ADD CONSTRAINT "procurement_sourcing_events_versions_ck" CHECK (
	("old_version" is null AND "new_version" is null)
	OR ("old_version" is null AND "new_version"=1)
	OR ("old_version" is not null AND "new_version"="old_version"+1 AND "old_version">0)
);
--> statement-breakpoint
ALTER TABLE "procurement_sourcing_events" ADD CONSTRAINT "procurement_sourcing_events_statuses_ck" CHECK (
	("from_status" is null OR "from_status" in ('DRAFT','ISSUED','CLOSED','CANCELLED'))
	AND ("to_status" is null OR "to_status" in ('DRAFT','ISSUED','CLOSED','CANCELLED'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX "procurement_sourcing_events_rfq_created_uq" ON "procurement_sourcing_events" ("rfq_id") WHERE "event_type"='RFQ_CREATED';
--> statement-breakpoint
CREATE UNIQUE INDEX "procurement_sourcing_events_rfq_mapping_confirmed_uq" ON "procurement_sourcing_events" ("rfq_id") WHERE "event_type"='RFQ_MAPPING_CONFIRMED';
--> statement-breakpoint
CREATE UNIQUE INDEX "procurement_sourcing_events_rfq_issued_uq" ON "procurement_sourcing_events" ("rfq_id") WHERE "event_type"='RFQ_ISSUED';
--> statement-breakpoint

CREATE TABLE "procurement_rfq_supplier_line_mapping_bindings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rfq_id" bigint NOT NULL,
	"rfq_supplier_id" bigint NOT NULL,
	"rfq_line_id" bigint NOT NULL,
	"supplier_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"supplier_mapping_version_id" bigint NOT NULL,
	"mapping_uid" uuid NOT NULL,
	"mapping_version_no" integer NOT NULL,
	"mapping_row_version" integer NOT NULL,
	"mapping_content_digest" text,
	"supplier_part_number" text NOT NULL,
	"purchase_unit_id" bigint NOT NULL,
	"conversion_numerator" bigint NOT NULL,
	"conversion_denominator" bigint NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"binding_source" text NOT NULL,
	"binding_status" text NOT NULL,
	"bound_by" text NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	CONSTRAINT "procurement_rfq_mapping_bindings_version_ck" CHECK ("mapping_version_no">0 AND "mapping_row_version">0),
	CONSTRAINT "procurement_rfq_mapping_bindings_digest_ck" CHECK ("mapping_content_digest" is null OR "mapping_content_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "procurement_rfq_mapping_bindings_part_ck" CHECK (char_length(btrim("supplier_part_number")) between 1 and 160),
	CONSTRAINT "procurement_rfq_mapping_bindings_conversion_ck" CHECK ("conversion_numerator">0 AND "conversion_denominator">0 AND "conversion_numerator"="conversion_denominator"),
	CONSTRAINT "procurement_rfq_mapping_bindings_period_ck" CHECK ("valid_to" is null OR "valid_to">"valid_from"),
	CONSTRAINT "procurement_rfq_mapping_bindings_source_ck" CHECK ("binding_source" in ('RFQ_CREATE','LEGACY_DRAFT_CONFIRMATION')),
	CONSTRAINT "procurement_rfq_mapping_bindings_status_ck" CHECK ("binding_status"='ACTIVE')
);
--> statement-breakpoint
ALTER TABLE "procurement_rfq_supplier_line_mapping_bindings" ADD CONSTRAINT "proc_rfq_map_binding_rfq_fk" FOREIGN KEY ("rfq_id") REFERENCES "procurement_rfqs"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "procurement_rfq_supplier_line_mapping_bindings" ADD CONSTRAINT "proc_rfq_map_binding_supplier_scope_fk" FOREIGN KEY ("rfq_supplier_id") REFERENCES "procurement_rfq_suppliers"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "procurement_rfq_supplier_line_mapping_bindings" ADD CONSTRAINT "proc_rfq_map_binding_line_fk" FOREIGN KEY ("rfq_line_id") REFERENCES "procurement_rfq_lines"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "procurement_rfq_supplier_line_mapping_bindings" ADD CONSTRAINT "proc_rfq_map_binding_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "procurement_rfq_supplier_line_mapping_bindings" ADD CONSTRAINT "proc_rfq_map_binding_material_fk" FOREIGN KEY ("material_id") REFERENCES "material_master"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "procurement_rfq_supplier_line_mapping_bindings" ADD CONSTRAINT "proc_rfq_map_binding_mapping_version_fk" FOREIGN KEY ("supplier_mapping_version_id") REFERENCES "supplier_mappings"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "procurement_rfq_supplier_line_mapping_bindings" ADD CONSTRAINT "proc_rfq_map_binding_mapping_identity_fk" FOREIGN KEY ("mapping_uid","mapping_version_no") REFERENCES "supplier_mappings"("mapping_uid","mapping_version_no") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "procurement_rfq_supplier_line_mapping_bindings" ADD CONSTRAINT "proc_rfq_map_binding_unit_fk" FOREIGN KEY ("purchase_unit_id") REFERENCES "units"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "procurement_rfq_supplier_line_mapping_bindings" ADD CONSTRAINT "proc_rfq_map_binding_actor_fk" FOREIGN KEY ("bound_by") REFERENCES "app_users"("username") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "procurement_rfq_mapping_bindings_supplier_line_uq" ON "procurement_rfq_supplier_line_mapping_bindings" ("rfq_supplier_id","rfq_line_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "procurement_rfq_mapping_bindings_rfq_supplier_line_uq" ON "procurement_rfq_supplier_line_mapping_bindings" ("rfq_id","supplier_id","rfq_line_id");
--> statement-breakpoint
CREATE INDEX "procurement_rfq_mapping_bindings_rfq_idx" ON "procurement_rfq_supplier_line_mapping_bindings" ("rfq_id","rfq_supplier_id","rfq_line_id");
--> statement-breakpoint
CREATE INDEX "procurement_rfq_mapping_bindings_mapping_version_idx" ON "procurement_rfq_supplier_line_mapping_bindings" ("supplier_mapping_version_id","rfq_id");
--> statement-breakpoint
CREATE INDEX "procurement_rfq_mapping_bindings_mapping_uid_idx" ON "procurement_rfq_supplier_line_mapping_bindings" ("mapping_uid","mapping_version_no","rfq_id");
--> statement-breakpoint
CREATE INDEX "procurement_rfq_mapping_bindings_request_idx" ON "procurement_rfq_supplier_line_mapping_bindings" ("request_id","rfq_id");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_procurement_rfq_mapping_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	rfq_row procurement_rfqs%ROWTYPE;
	rfq_supplier_row procurement_rfq_suppliers%ROWTYPE;
	rfq_line_row procurement_rfq_lines%ROWTYPE;
	mapping_row supplier_mappings%ROWTYPE;
BEGIN
	IF TG_OP<>'INSERT' THEN
		RAISE EXCEPTION 'RFQ Mapping bindings are immutable' USING ERRCODE='55000';
	END IF;
	IF current_setting('cyd.procurement_sourcing_service_write',true) IS DISTINCT FROM 'allowed' THEN
		RAISE EXCEPTION 'RFQ Mapping bindings require ProcurementSourcingService' USING ERRCODE='42501';
	END IF;

	SELECT * INTO rfq_row FROM procurement_rfqs WHERE id=NEW.rfq_id;
	IF NOT FOUND OR rfq_row.status<>'DRAFT' THEN
		RAISE EXCEPTION 'RFQ Mapping bindings require an existing DRAFT RFQ' USING ERRCODE='23514';
	END IF;
	IF EXISTS (
		SELECT 1 FROM procurement_sourcing_events event
		WHERE event.rfq_id=NEW.rfq_id AND event.event_type IN ('RFQ_CREATED','RFQ_MAPPING_CONFIRMED')
	) THEN
		RAISE EXCEPTION 'RFQ Mapping scope is already frozen by a lifecycle credential' USING ERRCODE='23514';
	END IF;
	SELECT * INTO rfq_supplier_row FROM procurement_rfq_suppliers WHERE id=NEW.rfq_supplier_id;
	IF NOT FOUND OR rfq_supplier_row.rfq_id<>NEW.rfq_id OR rfq_supplier_row.supplier_id<>NEW.supplier_id OR rfq_supplier_row.status<>'INVITED' THEN
		RAISE EXCEPTION 'RFQ Mapping binding supplier scope mismatch' USING ERRCODE='23514';
	END IF;
	SELECT * INTO rfq_line_row FROM procurement_rfq_lines WHERE id=NEW.rfq_line_id;
	IF NOT FOUND OR rfq_line_row.rfq_id<>NEW.rfq_id OR rfq_line_row.material_id<>NEW.material_id OR rfq_line_row.unit_id<>NEW.purchase_unit_id THEN
		RAISE EXCEPTION 'RFQ Mapping binding line/material/unit mismatch' USING ERRCODE='23514';
	END IF;
	SELECT * INTO mapping_row FROM supplier_mappings WHERE id=NEW.supplier_mapping_version_id FOR SHARE;
	IF NOT FOUND
		OR mapping_row.mapping_uid IS DISTINCT FROM NEW.mapping_uid
		OR mapping_row.mapping_version_no IS DISTINCT FROM NEW.mapping_version_no
		OR mapping_row.version IS DISTINCT FROM NEW.mapping_row_version
		OR mapping_row.content_digest IS DISTINCT FROM NEW.mapping_content_digest
		OR mapping_row.supplier_id IS DISTINCT FROM NEW.supplier_id
		OR mapping_row.material_id IS DISTINCT FROM NEW.material_id
		OR mapping_row.supplier_item_code IS DISTINCT FROM NEW.supplier_part_number
		OR mapping_row.purchase_unit_id IS DISTINCT FROM NEW.purchase_unit_id
		OR mapping_row.conversion_numerator IS DISTINCT FROM NEW.conversion_numerator
		OR mapping_row.conversion_denominator IS DISTINCT FROM NEW.conversion_denominator
		OR mapping_row.valid_from IS DISTINCT FROM NEW.valid_from
		OR mapping_row.valid_to IS DISTINCT FROM NEW.valid_to
		OR mapping_row.status IS DISTINCT FROM 'ACTIVE'
		OR NEW.binding_status IS DISTINCT FROM 'ACTIVE'
		OR mapping_row.conversion_numerator IS DISTINCT FROM mapping_row.conversion_denominator
		OR mapping_row.valid_from>statement_timestamp()
		OR (mapping_row.valid_to is not null AND mapping_row.valid_to<=statement_timestamp()) THEN
		RAISE EXCEPTION 'RFQ Mapping binding does not match the current exact ACTIVE Mapping version' USING ERRCODE='23514';
	END IF;
	PERFORM s.id FROM suppliers s WHERE s.id=NEW.supplier_id AND s.status='ACTIVE' FOR SHARE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'RFQ Mapping binding Supplier is not ACTIVE' USING ERRCODE='23514';
	END IF;
	PERFORM material.id FROM material_master material
	WHERE material.id=NEW.material_id AND material.material_status='ACTIVE'
		AND material.internal_material_code ~ '^CYD-[A-Z0-9_]+-[0-9]{6}$'
	FOR SHARE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'RFQ Mapping binding Material is not an ACTIVE formal Material' USING ERRCODE='23514';
	END IF;
	IF NEW.binding_source='RFQ_CREATE' AND (
		rfq_row.traceability_version IS DISTINCT FROM 2
		OR NEW.bound_by IS DISTINCT FROM rfq_row.created_by
		OR NEW.request_id IS DISTINCT FROM rfq_row.request_id
		OR NEW.bound_at IS DISTINCT FROM rfq_row.created_at
		OR rfq_row.created_at IS DISTINCT FROM transaction_timestamp()
	) THEN
		RAISE EXCEPTION 'RFQ create Mapping binding provenance mismatch' USING ERRCODE='23514';
	ELSIF NEW.binding_source='LEGACY_DRAFT_CONFIRMATION' AND (
		rfq_row.traceability_version IS DISTINCT FROM 1
		OR NEW.bound_at IS DISTINCT FROM transaction_timestamp()
	) THEN
		RAISE EXCEPTION 'legacy RFQ Mapping confirmation provenance mismatch' USING ERRCODE='23514';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "procurement_rfq_mapping_bindings_guard"
	BEFORE INSERT OR UPDATE OR DELETE ON "procurement_rfq_supplier_line_mapping_bindings"
	FOR EACH ROW EXECUTE FUNCTION cyd_procurement_rfq_mapping_binding_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_procurement_rfq_scope_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	rfq_row procurement_rfqs%ROWTYPE;
BEGIN
	SELECT * INTO rfq_row FROM procurement_rfqs WHERE id=NEW.rfq_id;
	IF NOT FOUND OR rfq_row.status IS DISTINCT FROM 'DRAFT'
		OR rfq_row.traceability_version IS DISTINCT FROM 2
		OR rfq_row.created_at IS DISTINCT FROM transaction_timestamp()
		OR EXISTS (
			SELECT 1 FROM procurement_sourcing_events event
			WHERE event.rfq_id=NEW.rfq_id AND event.event_type IN ('RFQ_CREATED','RFQ_MAPPING_CONFIRMED')
		) THEN
		RAISE EXCEPTION 'RFQ Line and Supplier scope can only be inserted in the generation-2 RFQ creation transaction' USING ERRCODE='23514';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "procurement_rfq_lines_traceability_insert_guard"
	BEFORE INSERT ON "procurement_rfq_lines"
	FOR EACH ROW EXECUTE FUNCTION cyd_procurement_rfq_scope_insert_guard();
--> statement-breakpoint
CREATE TRIGGER "procurement_rfq_suppliers_traceability_insert_guard"
	BEFORE INSERT ON "procurement_rfq_suppliers"
	FOR EACH ROW EXECUTE FUNCTION cyd_procurement_rfq_scope_insert_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_procurement_sourcing_event_credential_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	rfq_row procurement_rfqs%ROWTYPE;
	expected_binding_count bigint;
	actual_binding_count bigint;
BEGIN
	IF current_setting('cyd.procurement_sourcing_service_write',true) IS DISTINCT FROM 'allowed' THEN
		RAISE EXCEPTION 'procurement sourcing events require service transaction' USING ERRCODE='42501';
	END IF;
	IF NEW.event_type IN ('RFQ_CREATED','RFQ_MAPPING_CONFIRMED','RFQ_ISSUED') THEN
		IF NEW.credential_version<>2 OR NEW.result<>'SUCCESS'
			OR NEW.idempotency_key_digest is null OR NEW.scope_digest is null
			OR NEW.new_version is null OR NEW.to_status is null THEN
			RAISE EXCEPTION 'RFQ lifecycle event credential is incomplete' USING ERRCODE='23514';
		END IF;
		SELECT * INTO rfq_row FROM procurement_rfqs WHERE id=NEW.rfq_id;
		IF NOT FOUND THEN
			RAISE EXCEPTION 'RFQ lifecycle event has no RFQ' USING ERRCODE='23514';
		END IF;
		IF NEW.event_type='RFQ_CREATED' AND (
			NEW.old_version is not null OR NEW.new_version IS DISTINCT FROM 1
			OR NEW.from_status is not null OR NEW.to_status IS DISTINCT FROM 'DRAFT'
			OR rfq_row.status IS DISTINCT FROM 'DRAFT' OR rfq_row.version IS DISTINCT FROM 1
			OR rfq_row.created_by IS DISTINCT FROM NEW.actor OR rfq_row.request_id IS DISTINCT FROM NEW.request_id
			OR rfq_row.traceability_version IS DISTINCT FROM 2
			OR NEW.created_at IS DISTINCT FROM rfq_row.created_at
			OR rfq_row.created_at IS DISTINCT FROM transaction_timestamp()
		) THEN
			RAISE EXCEPTION 'RFQ_CREATED credential does not match the created RFQ' USING ERRCODE='23514';
		ELSIF NEW.event_type='RFQ_MAPPING_CONFIRMED' AND (
			NEW.old_version is null OR NEW.old_version<=0 OR NEW.new_version IS DISTINCT FROM NEW.old_version+1
			OR NEW.from_status IS DISTINCT FROM 'DRAFT' OR NEW.to_status IS DISTINCT FROM 'DRAFT'
			OR rfq_row.status IS DISTINCT FROM 'DRAFT' OR rfq_row.version IS DISTINCT FROM NEW.new_version
			OR rfq_row.traceability_version IS DISTINCT FROM 1
			OR NEW.created_at IS DISTINCT FROM transaction_timestamp()
		) THEN
			RAISE EXCEPTION 'RFQ_MAPPING_CONFIRMED credential does not match RFQ CAS' USING ERRCODE='23514';
		ELSIF NEW.event_type='RFQ_ISSUED' AND (
			NEW.old_version is null OR NEW.old_version<=0 OR NEW.new_version IS DISTINCT FROM NEW.old_version+1
			OR NEW.from_status IS DISTINCT FROM 'DRAFT' OR NEW.to_status IS DISTINCT FROM 'ISSUED'
			OR rfq_row.status IS DISTINCT FROM 'ISSUED' OR rfq_row.version IS DISTINCT FROM NEW.new_version
			OR rfq_row.issued_by IS DISTINCT FROM NEW.actor
			OR NEW.created_at IS DISTINCT FROM rfq_row.issued_at
			OR rfq_row.issued_at IS DISTINCT FROM transaction_timestamp()
			OR NEW.scope_digest IS DISTINCT FROM (
				SELECT prior_event.scope_digest FROM procurement_sourcing_events prior_event
				WHERE prior_event.rfq_id=NEW.rfq_id
					AND prior_event.event_type=CASE WHEN rfq_row.traceability_version=2 THEN 'RFQ_CREATED' ELSE 'RFQ_MAPPING_CONFIRMED' END
			)
		) THEN
			RAISE EXCEPTION 'RFQ_ISSUED credential does not match RFQ CAS' USING ERRCODE='23514';
		END IF;

		IF NEW.event_type IN ('RFQ_CREATED','RFQ_MAPPING_CONFIRMED') THEN
			SELECT count(*) INTO expected_binding_count
			FROM procurement_rfq_suppliers supplier_scope
			CROSS JOIN procurement_rfq_lines line_scope
			WHERE supplier_scope.rfq_id=NEW.rfq_id AND line_scope.rfq_id=NEW.rfq_id;
			SELECT count(*) INTO actual_binding_count
			FROM procurement_rfq_supplier_line_mapping_bindings binding
			WHERE binding.rfq_id=NEW.rfq_id;
			IF expected_binding_count=0 OR actual_binding_count<>expected_binding_count OR EXISTS (
				SELECT 1
				FROM procurement_rfq_suppliers supplier_scope
				CROSS JOIN procurement_rfq_lines line_scope
				WHERE supplier_scope.rfq_id=NEW.rfq_id AND line_scope.rfq_id=NEW.rfq_id
					AND NOT EXISTS (
						SELECT 1 FROM procurement_rfq_supplier_line_mapping_bindings binding
						WHERE binding.rfq_id=NEW.rfq_id
							AND binding.rfq_supplier_id=supplier_scope.id
							AND binding.rfq_line_id=line_scope.id
					)
			) THEN
				RAISE EXCEPTION 'RFQ lifecycle event requires exact Supplier x Line Mapping coverage' USING ERRCODE='23514';
			END IF;
			IF NEW.event_type='RFQ_CREATED' AND EXISTS (
				SELECT 1 FROM procurement_rfq_supplier_line_mapping_bindings binding
				WHERE binding.rfq_id=NEW.rfq_id AND (
					binding.binding_source IS DISTINCT FROM 'RFQ_CREATE'
					OR binding.bound_by IS DISTINCT FROM NEW.actor
						OR binding.request_id IS DISTINCT FROM NEW.request_id
						OR binding.bound_at IS DISTINCT FROM NEW.created_at
				)
			) THEN
				RAISE EXCEPTION 'RFQ_CREATED credential does not own every RFQ_CREATE Mapping binding' USING ERRCODE='23514';
			ELSIF NEW.event_type='RFQ_MAPPING_CONFIRMED' AND EXISTS (
				SELECT 1 FROM procurement_rfq_supplier_line_mapping_bindings binding
				WHERE binding.rfq_id=NEW.rfq_id AND (
					binding.binding_source IS DISTINCT FROM 'LEGACY_DRAFT_CONFIRMATION'
					OR binding.bound_by IS DISTINCT FROM NEW.actor
						OR binding.request_id IS DISTINCT FROM NEW.request_id
						OR binding.bound_at IS DISTINCT FROM NEW.created_at
				)
			) THEN
				RAISE EXCEPTION 'RFQ_MAPPING_CONFIRMED credential does not own every legacy Mapping binding' USING ERRCODE='23514';
			END IF;
		END IF;
	ELSIF NEW.credential_version<>1 THEN
		RAISE EXCEPTION 'legacy procurement event cannot claim a complete RFQ credential' USING ERRCODE='23514';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "procurement_sourcing_events_credential_guard"
	BEFORE INSERT ON "procurement_sourcing_events"
	FOR EACH ROW EXECUTE FUNCTION cyd_procurement_sourcing_event_credential_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION procurement_sourcing_projection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	expected_binding_count bigint;
	actual_binding_count bigint;
BEGIN
	IF TG_OP='DELETE' THEN RAISE EXCEPTION 'procurement sourcing records cannot be deleted'; END IF;
	IF current_setting('cyd.procurement_sourcing_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'procurement sourcing projections require service transaction'; END IF;
	IF TG_TABLE_NAME='procurement_rfqs' THEN
		IF OLD.updated_at=transaction_timestamp() THEN
			RAISE EXCEPTION 'RFQ projection can advance CAS only once per transaction';
		END IF;
		IF NEW.updated_at IS DISTINCT FROM transaction_timestamp() THEN
			RAISE EXCEPTION 'RFQ projection updated_at must mark the current transaction';
		END IF;
		IF (NEW.rfq_code,NEW.purchase_request_id,NEW.round_no,NEW.response_deadline,NEW.currency_code,NEW.source_purchase_request_version,NEW.source_digest,NEW.traceability_version,NEW.request_id,NEW.created_by,NEW.created_at)
			IS DISTINCT FROM (OLD.rfq_code,OLD.purchase_request_id,OLD.round_no,OLD.response_deadline,OLD.currency_code,OLD.source_purchase_request_version,OLD.source_digest,OLD.traceability_version,OLD.request_id,OLD.created_by,OLD.created_at) THEN
			RAISE EXCEPTION 'issued rfq scope is immutable';
		END IF;
		IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'invalid rfq CAS transition'; END IF;
		IF OLD.status<>'DRAFT' AND (NEW.issued_by,NEW.issued_at) IS DISTINCT FROM (OLD.issued_by,OLD.issued_at) THEN
			RAISE EXCEPTION 'RFQ issuance provenance is immutable';
		END IF;

		IF OLD.status='DRAFT' AND NEW.status IN ('DRAFT','ISSUED') THEN
			SELECT count(*) INTO expected_binding_count
			FROM procurement_rfq_suppliers supplier_scope
			CROSS JOIN procurement_rfq_lines line_scope
			WHERE supplier_scope.rfq_id=OLD.id AND line_scope.rfq_id=OLD.id;
			SELECT count(*) INTO actual_binding_count
			FROM procurement_rfq_supplier_line_mapping_bindings binding
			WHERE binding.rfq_id=OLD.id;
			IF expected_binding_count=0 OR actual_binding_count<>expected_binding_count OR EXISTS (
				SELECT 1 FROM procurement_rfq_suppliers supplier_scope
				CROSS JOIN procurement_rfq_lines line_scope
				WHERE supplier_scope.rfq_id=OLD.id AND line_scope.rfq_id=OLD.id
					AND NOT EXISTS (
						SELECT 1 FROM procurement_rfq_supplier_line_mapping_bindings binding
						WHERE binding.rfq_id=OLD.id AND binding.rfq_supplier_id=supplier_scope.id AND binding.rfq_line_id=line_scope.id
					)
			) THEN
				RAISE EXCEPTION 'RFQ Mapping bindings do not exactly cover Supplier x Line scope';
			END IF;
		END IF;

		IF OLD.status='DRAFT' AND NEW.status='DRAFT' THEN
			IF (NEW.issued_by,NEW.issued_at,NEW.closed_at)
				IS DISTINCT FROM (OLD.issued_by,OLD.issued_at,OLD.closed_at) THEN
				RAISE EXCEPTION 'legacy Mapping confirmation cannot change RFQ issuance or closure provenance';
			END IF;
			IF EXISTS (SELECT 1 FROM procurement_sourcing_events event WHERE event.rfq_id=OLD.id AND event.event_type='RFQ_MAPPING_CONFIRMED')
				OR EXISTS (SELECT 1 FROM procurement_rfq_supplier_line_mapping_bindings binding WHERE binding.rfq_id=OLD.id AND binding.binding_source<>'LEGACY_DRAFT_CONFIRMATION') THEN
				RAISE EXCEPTION 'DRAFT RFQ can only advance CAS once for explicit legacy Mapping confirmation';
			END IF;
		ELSIF OLD.status='DRAFT' AND NEW.status='ISSUED' THEN
			IF OLD.response_deadline<(statement_timestamp() AT TIME ZONE 'Asia/Shanghai')::date THEN RAISE EXCEPTION 'RFQ response deadline has expired'; END IF;
			IF OLD.traceability_version=1 AND (
				SELECT count(*) FROM audit_log audit
				WHERE audit.route_code='PROCUREMENT_SOURCING' AND audit.action='RFQ_CREATED'
					AND audit.result='success' AND audit.request_id=OLD.request_id AND audit.username=OLD.created_by
					AND audit.old_version is null AND audit.new_version=1
					AND audit.idempotency_key_digest is not null AND audit.operation_id is not null
					AND audit.detail->>'object_id'=OLD.id::text AND audit.created_at=OLD.created_at
			)<>1 THEN
				RAISE EXCEPTION 'historical RFQ issuance requires one exact RFQ_CREATED success Audit';
			END IF;
			IF (OLD.traceability_version=2 AND (
				EXISTS (SELECT 1 FROM procurement_rfq_supplier_line_mapping_bindings binding WHERE binding.rfq_id=OLD.id AND binding.binding_source<>'RFQ_CREATE')
				OR NOT EXISTS (SELECT 1 FROM procurement_sourcing_events event WHERE event.rfq_id=OLD.id AND event.event_type='RFQ_CREATED')
			)) OR (OLD.traceability_version=1 AND (
				EXISTS (SELECT 1 FROM procurement_rfq_supplier_line_mapping_bindings binding WHERE binding.rfq_id=OLD.id AND binding.binding_source<>'LEGACY_DRAFT_CONFIRMATION')
				OR NOT EXISTS (SELECT 1 FROM procurement_sourcing_events event WHERE event.rfq_id=OLD.id AND event.event_type='RFQ_MAPPING_CONFIRMED')
			)) THEN
				RAISE EXCEPTION 'RFQ issuance requires the exact prior Mapping lifecycle credential';
			END IF;
			PERFORM mapping.id
			FROM supplier_mappings mapping
			JOIN (SELECT DISTINCT mapping_uid FROM procurement_rfq_supplier_line_mapping_bindings WHERE rfq_id=OLD.id) binding_scope
				ON binding_scope.mapping_uid=mapping.mapping_uid
			ORDER BY mapping.id
			FOR SHARE OF mapping;
			PERFORM invitation.id
			FROM procurement_rfq_suppliers invitation
			WHERE invitation.rfq_id=OLD.id
			ORDER BY invitation.id
			FOR SHARE OF invitation;
			PERFORM supplier.id
			FROM suppliers supplier
			JOIN procurement_rfq_suppliers invitation ON invitation.supplier_id=supplier.id
			WHERE invitation.rfq_id=OLD.id
			ORDER BY supplier.id
			FOR SHARE OF supplier;
			PERFORM material.id
			FROM material_master material
			JOIN procurement_rfq_lines line ON line.material_id=material.id
			WHERE line.rfq_id=OLD.id
			ORDER BY material.id
			FOR SHARE OF material;
			PERFORM pg_advisory_xact_lock(hashtextextended('material-requirement-project:'||plan.project_id::text,0))
			FROM planning_purchase_requests request
			JOIN planning_material_requirement_plans plan ON plan.id=request.plan_id
			WHERE request.id=OLD.purchase_request_id;
			IF NOT EXISTS (
				SELECT 1 FROM planning_purchase_requests request
				JOIN planning_material_requirement_plans plan ON plan.id=request.plan_id
				WHERE request.id=OLD.purchase_request_id AND request.status='ACCEPTED' AND request.version=OLD.source_purchase_request_version
					AND NOT EXISTS (
						SELECT 1 FROM planning_purchase_requests newer_request
						JOIN planning_material_requirement_plans newer_plan ON newer_plan.id=newer_request.plan_id
						WHERE newer_plan.project_id=plan.project_id AND newer_plan.plan_version_no>plan.plan_version_no
					)
			) THEN RAISE EXCEPTION 'RFQ Purchase Request source is no longer current ACCEPTED'; END IF;
			IF EXISTS (
				SELECT 1 FROM procurement_rfq_suppliers invitation
				WHERE invitation.rfq_id=OLD.id AND invitation.status IS DISTINCT FROM 'INVITED'
			) THEN RAISE EXCEPTION 'RFQ Supplier invitation state drift blocks issuance'; END IF;
			IF EXISTS (
				SELECT 1
				FROM procurement_rfq_supplier_line_mapping_bindings binding
				JOIN supplier_mappings mapping ON mapping.id=binding.supplier_mapping_version_id
				JOIN suppliers supplier ON supplier.id=binding.supplier_id
				JOIN material_master material ON material.id=binding.material_id
				WHERE binding.rfq_id=OLD.id AND (
					supplier.status IS DISTINCT FROM 'ACTIVE' OR material.material_status IS DISTINCT FROM 'ACTIVE' OR mapping.status IS DISTINCT FROM 'ACTIVE'
					OR mapping.mapping_uid IS DISTINCT FROM binding.mapping_uid OR mapping.mapping_version_no IS DISTINCT FROM binding.mapping_version_no
					OR mapping.version IS DISTINCT FROM binding.mapping_row_version OR mapping.content_digest IS DISTINCT FROM binding.mapping_content_digest
					OR mapping.supplier_id IS DISTINCT FROM binding.supplier_id OR mapping.material_id IS DISTINCT FROM binding.material_id
					OR mapping.supplier_item_code IS DISTINCT FROM binding.supplier_part_number OR mapping.purchase_unit_id IS DISTINCT FROM binding.purchase_unit_id
					OR mapping.conversion_numerator IS DISTINCT FROM binding.conversion_numerator OR mapping.conversion_denominator IS DISTINCT FROM binding.conversion_denominator
					OR mapping.valid_from IS DISTINCT FROM binding.valid_from OR mapping.valid_to IS DISTINCT FROM binding.valid_to
					OR mapping.valid_from>statement_timestamp() OR (mapping.valid_to is not null AND mapping.valid_to<=statement_timestamp())
					OR (SELECT latest_mapping.id FROM supplier_mappings latest_mapping
						WHERE latest_mapping.mapping_uid=binding.mapping_uid
						ORDER BY latest_mapping.mapping_version_no DESC,latest_mapping.id DESC LIMIT 1)
						IS DISTINCT FROM binding.supplier_mapping_version_id
					OR (SELECT count(*) FROM supplier_mappings current_mapping
						WHERE current_mapping.supplier_id=binding.supplier_id AND current_mapping.material_id=binding.material_id
							AND current_mapping.purchase_unit_id=binding.purchase_unit_id AND current_mapping.status='ACTIVE'
							AND current_mapping.conversion_numerator=current_mapping.conversion_denominator
							AND current_mapping.valid_from<=statement_timestamp()
							AND (current_mapping.valid_to is null OR current_mapping.valid_to>statement_timestamp()))<>1
				)
			) THEN RAISE EXCEPTION 'RFQ Mapping binding drift or conflict blocks issuance'; END IF;
		ELSIF NOT ((OLD.status='DRAFT' AND NEW.status='CANCELLED') OR (OLD.status='ISSUED' AND NEW.status IN ('ISSUED','CLOSED','CANCELLED'))) THEN
			RAISE EXCEPTION 'invalid rfq transition';
		END IF;
	ELSIF TG_TABLE_NAME='procurement_rfq_suppliers' THEN
		IF (NEW.rfq_id,NEW.supplier_id,NEW.invited_by,NEW.invited_at,NEW.supplier_mapping_digest) IS DISTINCT FROM (OLD.rfq_id,OLD.supplier_id,OLD.invited_by,OLD.invited_at,OLD.supplier_mapping_digest) OR NOT (OLD.status='INVITED' AND NEW.status IN ('RESPONDED','DECLINED')) THEN RAISE EXCEPTION 'rfq supplier invitation is immutable'; END IF;
	ELSIF TG_TABLE_NAME='procurement_supplier_quotes' THEN
		IF NEW.version<>OLD.version+1 OR (NEW.rfq_id,NEW.supplier_id,NEW.quote_version_no,NEW.supplier_quote_reference,NEW.currency_code,NEW.valid_until,NEW.tax_included,NEW.freight_included,NEW.payment_terms,NEW.quote_digest,NEW.recorded_by,NEW.recorded_at,NEW.request_id) IS DISTINCT FROM (OLD.rfq_id,OLD.supplier_id,OLD.quote_version_no,OLD.supplier_quote_reference,OLD.currency_code,OLD.valid_until,OLD.tax_included,OLD.freight_included,OLD.payment_terms,OLD.quote_digest,OLD.recorded_by,OLD.recorded_at,OLD.request_id) OR NOT (OLD.status='SUBMITTED' AND NEW.status IN ('SUPERSEDED','WITHDRAWN')) THEN RAISE EXCEPTION 'submitted quote is immutable'; END IF;
	ELSIF TG_TABLE_NAME='procurement_sourcing_awards' THEN
		IF NEW.version<>OLD.version+1 OR (NEW.rfq_id,NEW.award_digest,NEW.selected_by,NEW.selected_at,NEW.reason_code,NEW.reason,NEW.request_id) IS DISTINCT FROM (OLD.rfq_id,OLD.award_digest,OLD.selected_by,OLD.selected_at,OLD.reason_code,OLD.reason,OLD.request_id) OR NOT (OLD.status='AWARDED' AND NEW.status='REVERSED') THEN RAISE EXCEPTION 'sourcing award is immutable'; END IF;
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint

-- Lifecycle rows are written in the same transaction as their RFQ projection.
-- These deferred checks run against the final transaction state, preventing a
-- service-GUC caller (or an older application image) from committing a header,
-- Mapping scope, or event only partially.
CREATE OR REPLACE FUNCTION cyd_procurement_rfq_traceability_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	target_rfq_id bigint;
	rfq_row procurement_rfqs%ROWTYPE;
	expected_binding_count bigint;
	actual_binding_count bigint;
	prior_event_count bigint;
	issued_event_count bigint;
BEGIN
	IF TG_TABLE_NAME='procurement_rfqs' THEN
		target_rfq_id := NEW.id;
		IF NOT (
			TG_OP='INSERT'
			OR (TG_OP='UPDATE' AND OLD.status='DRAFT' AND NEW.status IN ('DRAFT','ISSUED'))
		) THEN
			RETURN NULL;
		END IF;
	ELSIF TG_TABLE_NAME='procurement_rfq_supplier_line_mapping_bindings' THEN
		target_rfq_id := NEW.rfq_id;
	ELSE
		target_rfq_id := NEW.rfq_id;
		IF NEW.event_type NOT IN ('RFQ_CREATED','RFQ_MAPPING_CONFIRMED','RFQ_ISSUED') THEN
			RETURN NULL;
		END IF;
	END IF;
	SELECT * INTO rfq_row FROM procurement_rfqs WHERE id=target_rfq_id;
	IF NOT FOUND THEN RETURN NULL; END IF;

	SELECT count(*) INTO expected_binding_count
	FROM procurement_rfq_suppliers supplier_scope
	CROSS JOIN procurement_rfq_lines line_scope
	WHERE supplier_scope.rfq_id=target_rfq_id AND line_scope.rfq_id=target_rfq_id;
	SELECT count(*) INTO actual_binding_count
	FROM procurement_rfq_supplier_line_mapping_bindings binding
	WHERE binding.rfq_id=target_rfq_id;

	IF rfq_row.traceability_version=2 THEN
		IF expected_binding_count=0 OR actual_binding_count<>expected_binding_count OR EXISTS (
			SELECT 1 FROM procurement_rfq_supplier_line_mapping_bindings binding
			WHERE binding.rfq_id=target_rfq_id AND binding.binding_source<>'RFQ_CREATE'
		) OR EXISTS (
			SELECT 1 FROM procurement_rfq_suppliers supplier_scope
			CROSS JOIN procurement_rfq_lines line_scope
			WHERE supplier_scope.rfq_id=target_rfq_id AND line_scope.rfq_id=target_rfq_id
				AND NOT EXISTS (
					SELECT 1 FROM procurement_rfq_supplier_line_mapping_bindings binding
					WHERE binding.rfq_id=target_rfq_id
						AND binding.rfq_supplier_id=supplier_scope.id
						AND binding.rfq_line_id=line_scope.id
				)
		) THEN
			RAISE EXCEPTION 'generation-2 RFQ requires exact create-time Supplier x Line Mapping coverage' USING ERRCODE='23514';
		END IF;
		SELECT count(*) INTO prior_event_count
		FROM procurement_sourcing_events event
		WHERE event.rfq_id=target_rfq_id AND event.event_type='RFQ_CREATED'
			AND event.credential_version=2 AND event.result='SUCCESS'
			AND event.actor=rfq_row.created_by AND event.request_id=rfq_row.request_id
			AND event.created_at=rfq_row.created_at
			AND event.old_version is null AND event.new_version=1
			AND event.from_status is null AND event.to_status='DRAFT'
			AND event.idempotency_key_digest is not null AND event.scope_digest is not null
			AND NOT EXISTS (
				SELECT 1 FROM procurement_rfq_supplier_line_mapping_bindings binding
				WHERE binding.rfq_id=target_rfq_id AND (
					binding.bound_by IS DISTINCT FROM event.actor
					OR binding.request_id IS DISTINCT FROM event.request_id
					OR binding.bound_at IS DISTINCT FROM event.created_at
				)
			);
		IF prior_event_count<>1 THEN
			RAISE EXCEPTION 'generation-2 RFQ requires one exact immutable RFQ_CREATED credential' USING ERRCODE='23514';
		END IF;
	ELSE
		IF actual_binding_count=0 THEN
			IF EXISTS (
				SELECT 1 FROM procurement_sourcing_events event
				WHERE event.rfq_id=target_rfq_id AND event.event_type IN ('RFQ_CREATED','RFQ_MAPPING_CONFIRMED','RFQ_ISSUED')
			) OR rfq_row.issued_at is not null THEN
				RAISE EXCEPTION 'unbound historical RFQ cannot claim Mapping or issuance credentials' USING ERRCODE='23514';
			END IF;
		ELSE
			IF expected_binding_count=0 OR actual_binding_count<>expected_binding_count OR EXISTS (
				SELECT 1 FROM procurement_rfq_supplier_line_mapping_bindings binding
				WHERE binding.rfq_id=target_rfq_id AND binding.binding_source<>'LEGACY_DRAFT_CONFIRMATION'
			) OR EXISTS (
				SELECT 1 FROM procurement_rfq_suppliers supplier_scope
				CROSS JOIN procurement_rfq_lines line_scope
				WHERE supplier_scope.rfq_id=target_rfq_id AND line_scope.rfq_id=target_rfq_id
					AND NOT EXISTS (
						SELECT 1 FROM procurement_rfq_supplier_line_mapping_bindings binding
						WHERE binding.rfq_id=target_rfq_id
							AND binding.rfq_supplier_id=supplier_scope.id
							AND binding.rfq_line_id=line_scope.id
					)
			) THEN
				RAISE EXCEPTION 'historical RFQ confirmation requires exact Supplier x Line Mapping coverage' USING ERRCODE='23514';
			END IF;
			SELECT count(*) INTO prior_event_count
			FROM procurement_sourcing_events event
			WHERE event.rfq_id=target_rfq_id AND event.event_type='RFQ_MAPPING_CONFIRMED'
				AND event.credential_version=2 AND event.result='SUCCESS'
				AND event.old_version is not null AND event.new_version=event.old_version+1
				AND event.from_status='DRAFT' AND event.to_status='DRAFT'
				AND event.idempotency_key_digest is not null AND event.scope_digest is not null
				AND NOT EXISTS (
					SELECT 1 FROM procurement_rfq_supplier_line_mapping_bindings binding
					WHERE binding.rfq_id=target_rfq_id AND (
						binding.bound_by IS DISTINCT FROM event.actor
						OR binding.request_id IS DISTINCT FROM event.request_id
						OR binding.bound_at IS DISTINCT FROM event.created_at
					)
				);
			IF prior_event_count<>1 THEN
				RAISE EXCEPTION 'historical RFQ bindings require one exact RFQ_MAPPING_CONFIRMED credential' USING ERRCODE='23514';
			END IF;
		END IF;
	END IF;

	IF rfq_row.issued_at is not null THEN
		SELECT count(*) INTO issued_event_count
		FROM procurement_sourcing_events issued_event
		JOIN procurement_sourcing_events prior_event
			ON prior_event.rfq_id=issued_event.rfq_id
			AND prior_event.event_type=CASE WHEN rfq_row.traceability_version=2 THEN 'RFQ_CREATED' ELSE 'RFQ_MAPPING_CONFIRMED' END
		WHERE issued_event.rfq_id=target_rfq_id AND issued_event.event_type='RFQ_ISSUED'
			AND issued_event.credential_version=2 AND issued_event.result='SUCCESS'
			AND issued_event.actor=rfq_row.issued_by AND issued_event.created_at=rfq_row.issued_at
			AND issued_event.old_version is not null AND issued_event.new_version=issued_event.old_version+1
			AND issued_event.new_version<=rfq_row.version
			AND issued_event.from_status='DRAFT' AND issued_event.to_status='ISSUED'
			AND issued_event.idempotency_key_digest is not null
			AND issued_event.scope_digest=prior_event.scope_digest;
		IF issued_event_count<>1 THEN
			RAISE EXCEPTION 'issued RFQ requires one exact RFQ_ISSUED credential with the prior frozen scope' USING ERRCODE='23514';
		END IF;
	END IF;

	IF EXISTS (
		SELECT 1
		FROM procurement_sourcing_events lifecycle_event
		WHERE lifecycle_event.rfq_id=target_rfq_id
			AND lifecycle_event.event_type IN ('RFQ_CREATED','RFQ_MAPPING_CONFIRMED','RFQ_ISSUED')
			AND lifecycle_event.credential_version=2
			AND lifecycle_event.created_at=transaction_timestamp()
			AND (
				(SELECT count(*) FROM audit_log audit
					WHERE audit.route_code='PROCUREMENT_SOURCING'
						AND audit.action=lifecycle_event.event_type
						AND audit.result='success'
						AND audit.username=lifecycle_event.actor
						AND audit.request_id=lifecycle_event.request_id
						AND audit.idempotency_key_digest=lifecycle_event.idempotency_key_digest
						AND audit.old_version IS NOT DISTINCT FROM lifecycle_event.old_version
						AND audit.new_version IS NOT DISTINCT FROM lifecycle_event.new_version
						AND audit.operation_id is not null
						AND audit.detail->>'object_id'=target_rfq_id::text
						AND audit.created_at=lifecycle_event.created_at)<>1
				OR (SELECT count(*) FROM idempotency_keys idempotency
					WHERE idempotency.key_digest=lifecycle_event.idempotency_key_digest
						AND idempotency.username=lifecycle_event.actor
						AND idempotency.method='POST'
						AND idempotency.path=CASE lifecycle_event.event_type
							WHEN 'RFQ_CREATED' THEN '/api/procurement/rfqs'
							WHEN 'RFQ_MAPPING_CONFIRMED' THEN '/api/procurement/rfqs/'||target_rfq_id::text||'/mapping-bindings'
							ELSE '/api/procurement/rfqs/'||target_rfq_id::text||'/issue'
						END
						AND idempotency.request_digest ~ '^[0-9a-f]{64}$'
						AND idempotency.status_code=CASE WHEN lifecycle_event.event_type='RFQ_CREATED' THEN 201 ELSE 200 END
						AND idempotency.response->>'rfq_id'=target_rfq_id::text
						AND idempotency.response->>'request_id'=lifecycle_event.request_id::text
						AND idempotency.response->>'version'=lifecycle_event.new_version::text
						AND idempotency.response->>'result'='SUCCESS'
						AND idempotency.response->>'event'=CASE lifecycle_event.event_type
							WHEN 'RFQ_ISSUED' THEN 'ISSUED' ELSE lifecycle_event.event_type END
						AND idempotency.created_at=lifecycle_event.created_at
						AND idempotency.expires_at>idempotency.created_at)<>1
			)
	) THEN
		RAISE EXCEPTION 'RFQ lifecycle credential requires one exact success Audit and Idempotency result' USING ERRCODE='23514';
	END IF;
	RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "procurement_rfqs_traceability_commit_guard"
	AFTER INSERT OR UPDATE ON "procurement_rfqs"
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW EXECUTE FUNCTION cyd_procurement_rfq_traceability_commit_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "procurement_rfq_mapping_bindings_commit_guard"
	AFTER INSERT ON "procurement_rfq_supplier_line_mapping_bindings"
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW EXECUTE FUNCTION cyd_procurement_rfq_traceability_commit_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "procurement_sourcing_events_traceability_commit_guard"
	AFTER INSERT ON "procurement_sourcing_events"
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW EXECUTE FUNCTION cyd_procurement_rfq_traceability_commit_guard();
--> statement-breakpoint

-- Migration consistency guard: 0039 must not invent historical Mapping bindings
-- or RFQ creation/confirmation events. Existing lifecycle events remain v1.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM procurement_rfq_supplier_line_mapping_bindings) THEN
		RAISE EXCEPTION '0039 must not backfill historical RFQ Mapping bindings' USING ERRCODE='23514';
	END IF;
	IF EXISTS (SELECT 1 FROM procurement_sourcing_events WHERE event_type IN ('RFQ_CREATED','RFQ_MAPPING_CONFIRMED')) THEN
		RAISE EXCEPTION '0039 must not invent historical RFQ lifecycle events' USING ERRCODE='23514';
	END IF;
	IF EXISTS (SELECT 1 FROM procurement_sourcing_events WHERE credential_version<>1 OR result<>'SUCCESS') THEN
		RAISE EXCEPTION '0039 historical event compatibility checksum failed' USING ERRCODE='23514';
	END IF;
END $$;
