CREATE TABLE "production_handoffs" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "handoff_code" text NOT NULL,
  "planning_package_id" bigint NOT NULL,
  "handoff_version_no" integer NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "source_package_version" integer NOT NULL,
  "source_package_digest" text NOT NULL,
  "source_digest" text NOT NULL,
  "prepared_by" text NOT NULL,
  "submitted_by" text,
  "submitted_at" timestamp with time zone,
  "accepted_by" text,
  "accepted_at" timestamp with time zone,
  "returned_by" text,
  "returned_at" timestamp with time zone,
  "return_reason" text DEFAULT '' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "request_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "production_handoffs_status_ck" CHECK (status in ('DRAFT','SUBMITTED','RETURNED','ACCEPTED')),
  CONSTRAINT "production_handoffs_version_ck" CHECK (version>0 and handoff_version_no>0 and source_package_version>0),
  CONSTRAINT "production_handoffs_digest_ck" CHECK (source_package_digest ~ '^[0-9a-f]{64}$' and source_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "production_handoffs_return_ck" CHECK ((status='RETURNED' and returned_by is not null and returned_at is not null and char_length(btrim(return_reason)) between 1 and 1000 and accepted_by is null and accepted_at is null) or status<>'RETURNED')
);
--> statement-breakpoint
CREATE TABLE "production_handoff_items" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "handoff_id" bigint NOT NULL,
  "planning_package_item_id" bigint NOT NULL,
  "product_id" bigint NOT NULL,
  "product_version_id" bigint NOT NULL,
  "bom_version_id" bigint NOT NULL,
  "finished_material_id" bigint NOT NULL,
  "finished_unit_id" bigint NOT NULL,
  "planned_quantity" numeric(24,6) NOT NULL,
  "line_no" integer NOT NULL,
  "source_digest" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "production_handoff_items_quantity_ck" CHECK (planned_quantity>0 and line_no>0),
  CONSTRAINT "production_handoff_items_digest_ck" CHECK (source_digest ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "production_handoff_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "handoff_id" bigint NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "event_type" text NOT NULL,
  "reason" text DEFAULT '' NOT NULL,
  "actor" text NOT NULL,
  "request_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "production_handoff_events_status_ck" CHECK (to_status in ('DRAFT','SUBMITTED','RETURNED','ACCEPTED'))
);
--> statement-breakpoint
CREATE TABLE "production_handoff_work_order_links" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "handoff_item_id" bigint NOT NULL,
  "work_order_id" bigint NOT NULL,
  "source_digest" text NOT NULL,
  "operation_id" uuid NOT NULL,
  "created_by" text NOT NULL,
  "request_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "production_handoff_work_order_links_digest_ck" CHECK (source_digest ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "production_inventory_reservations" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "work_order_id" bigint NOT NULL,
  "requirement_id" bigint NOT NULL,
  "balance_id" bigint NOT NULL,
  "material_id" bigint NOT NULL,
  "unit_id" bigint NOT NULL,
  "reserved_qty" numeric(24,6) NOT NULL,
  "net_issued_qty" numeric(24,6) DEFAULT 0 NOT NULL,
  "returned_qty" numeric(24,6) DEFAULT 0 NOT NULL,
  "released_qty" numeric(24,6) DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "source_digest" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_by" text NOT NULL,
  "request_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "production_inventory_reservations_status_ck" CHECK (status in ('ACTIVE','PARTIAL','CONSUMED','RELEASED')),
  CONSTRAINT "production_inventory_reservations_quantity_ck" CHECK (reserved_qty>0 and net_issued_qty>=0 and returned_qty>=0 and released_qty>=0 and net_issued_qty+released_qty<=reserved_qty),
  CONSTRAINT "production_inventory_reservations_digest_ck" CHECK (source_digest ~ '^[0-9a-f]{64}$' and version>0)
);
--> statement-breakpoint
CREATE TABLE "production_inventory_reservation_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "reservation_id" bigint NOT NULL,
  "event_type" text NOT NULL,
  "quantity" numeric(24,6) NOT NULL,
  "inventory_ledger_entry_id" bigint,
  "reason" text DEFAULT '' NOT NULL,
  "actor" text NOT NULL,
  "request_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "production_inventory_reservation_events_type_ck" CHECK (event_type in ('RESERVED','ISSUED','RETURNED','RELEASED')),
  CONSTRAINT "production_inventory_reservation_events_quantity_ck" CHECK (quantity>0)
);
--> statement-breakpoint
ALTER TABLE production_handoffs ADD CONSTRAINT production_handoffs_package_fk FOREIGN KEY (planning_package_id) REFERENCES project_planning_packages(id) ON DELETE restrict;
ALTER TABLE production_handoffs ADD CONSTRAINT production_handoffs_prepared_fk FOREIGN KEY (prepared_by) REFERENCES app_users(username) ON DELETE restrict;
ALTER TABLE production_handoffs ADD CONSTRAINT production_handoffs_submitted_fk FOREIGN KEY (submitted_by) REFERENCES app_users(username) ON DELETE restrict;
ALTER TABLE production_handoffs ADD CONSTRAINT production_handoffs_accepted_fk FOREIGN KEY (accepted_by) REFERENCES app_users(username) ON DELETE restrict;
ALTER TABLE production_handoffs ADD CONSTRAINT production_handoffs_returned_fk FOREIGN KEY (returned_by) REFERENCES app_users(username) ON DELETE restrict;
ALTER TABLE production_handoff_items ADD CONSTRAINT production_handoff_items_handoff_fk FOREIGN KEY (handoff_id) REFERENCES production_handoffs(id) ON DELETE restrict;
ALTER TABLE production_handoff_items ADD CONSTRAINT production_handoff_items_package_item_fk FOREIGN KEY (planning_package_item_id) REFERENCES project_planning_package_items(id) ON DELETE restrict;
ALTER TABLE production_handoff_items ADD CONSTRAINT production_handoff_items_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE restrict;
ALTER TABLE production_handoff_items ADD CONSTRAINT production_handoff_items_product_version_fk FOREIGN KEY (product_version_id) REFERENCES product_versions(id) ON DELETE restrict;
ALTER TABLE production_handoff_items ADD CONSTRAINT production_handoff_items_bom_version_fk FOREIGN KEY (bom_version_id) REFERENCES bom_versions(id) ON DELETE restrict;
ALTER TABLE production_handoff_items ADD CONSTRAINT production_handoff_items_finished_material_fk FOREIGN KEY (finished_material_id) REFERENCES material_master(id) ON DELETE restrict;
ALTER TABLE production_handoff_items ADD CONSTRAINT production_handoff_items_finished_unit_fk FOREIGN KEY (finished_unit_id) REFERENCES units(id) ON DELETE restrict;
ALTER TABLE production_handoff_events ADD CONSTRAINT production_handoff_events_handoff_fk FOREIGN KEY (handoff_id) REFERENCES production_handoffs(id) ON DELETE restrict;
ALTER TABLE production_handoff_events ADD CONSTRAINT production_handoff_events_actor_fk FOREIGN KEY (actor) REFERENCES app_users(username) ON DELETE restrict;
ALTER TABLE production_handoff_work_order_links ADD CONSTRAINT production_handoff_links_item_fk FOREIGN KEY (handoff_item_id) REFERENCES production_handoff_items(id) ON DELETE restrict;
ALTER TABLE production_handoff_work_order_links ADD CONSTRAINT production_handoff_links_work_order_fk FOREIGN KEY (work_order_id) REFERENCES production_work_orders(id) ON DELETE restrict;
ALTER TABLE production_handoff_work_order_links ADD CONSTRAINT production_handoff_links_created_by_fk FOREIGN KEY (created_by) REFERENCES app_users(username) ON DELETE restrict;
ALTER TABLE production_inventory_reservations ADD CONSTRAINT production_reservations_work_order_fk FOREIGN KEY (work_order_id) REFERENCES production_work_orders(id) ON DELETE restrict;
ALTER TABLE production_inventory_reservations ADD CONSTRAINT production_reservations_requirement_fk FOREIGN KEY (requirement_id) REFERENCES production_material_requirements(id) ON DELETE restrict;
ALTER TABLE production_inventory_reservations ADD CONSTRAINT production_reservations_balance_fk FOREIGN KEY (balance_id) REFERENCES inventory_stock_balances(id) ON DELETE restrict;
ALTER TABLE production_inventory_reservations ADD CONSTRAINT production_reservations_material_fk FOREIGN KEY (material_id) REFERENCES material_master(id) ON DELETE restrict;
ALTER TABLE production_inventory_reservations ADD CONSTRAINT production_reservations_unit_fk FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE restrict;
ALTER TABLE production_inventory_reservations ADD CONSTRAINT production_reservations_created_by_fk FOREIGN KEY (created_by) REFERENCES app_users(username) ON DELETE restrict;
ALTER TABLE production_inventory_reservation_events ADD CONSTRAINT production_reservation_events_reservation_fk FOREIGN KEY (reservation_id) REFERENCES production_inventory_reservations(id) ON DELETE restrict;
ALTER TABLE production_inventory_reservation_events ADD CONSTRAINT production_reservation_events_ledger_fk FOREIGN KEY (inventory_ledger_entry_id) REFERENCES inventory_ledger_entries(id) ON DELETE restrict;
ALTER TABLE production_inventory_reservation_events ADD CONSTRAINT production_reservation_events_actor_fk FOREIGN KEY (actor) REFERENCES app_users(username) ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX production_handoffs_code_uq ON production_handoffs(handoff_code);
CREATE UNIQUE INDEX production_handoffs_package_version_uq ON production_handoffs(planning_package_id,handoff_version_no);
CREATE UNIQUE INDEX production_handoffs_active_uq ON production_handoffs(planning_package_id) WHERE status in ('DRAFT','SUBMITTED','ACCEPTED');
CREATE INDEX production_handoffs_queue_idx ON production_handoffs(status,submitted_at,id);
CREATE UNIQUE INDEX production_handoff_items_line_uq ON production_handoff_items(handoff_id,line_no);
CREATE UNIQUE INDEX production_handoff_items_package_item_uq ON production_handoff_items(handoff_id,planning_package_item_id);
CREATE UNIQUE INDEX production_handoff_links_item_uq ON production_handoff_work_order_links(handoff_item_id);
CREATE UNIQUE INDEX production_handoff_links_work_order_uq ON production_handoff_work_order_links(work_order_id);
CREATE UNIQUE INDEX production_handoff_links_operation_uq ON production_handoff_work_order_links(operation_id);
CREATE UNIQUE INDEX production_reservations_requirement_uq ON production_inventory_reservations(requirement_id);
CREATE INDEX production_reservations_work_order_idx ON production_inventory_reservations(work_order_id,status,id);
CREATE INDEX production_reservations_material_idx ON production_inventory_reservations(material_id,status,id);
CREATE INDEX production_reservation_events_reservation_idx ON production_inventory_reservation_events(reservation_id,id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_production_handoff_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF current_setting('cyd.production_handoff_service_write',true)<>'allowed' THEN RAISE EXCEPTION 'production handoff service write required' USING ERRCODE='55000'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'production handoff facts are immutable' USING ERRCODE='55000'; END IF;
  IF TG_TABLE_NAME IN ('production_handoff_items','production_handoff_events','production_handoff_work_order_links','production_inventory_reservation_events') AND TG_OP='UPDATE' THEN RAISE EXCEPTION 'production handoff facts are immutable' USING ERRCODE='55000'; END IF;
  IF TG_TABLE_NAME='production_handoffs' AND TG_OP='UPDATE' AND jsonb_build_array(to_jsonb(NEW)->'handoff_code',to_jsonb(NEW)->'planning_package_id',to_jsonb(NEW)->'handoff_version_no',to_jsonb(NEW)->'source_package_version',to_jsonb(NEW)->'source_package_digest',to_jsonb(NEW)->'source_digest',to_jsonb(NEW)->'prepared_by',to_jsonb(NEW)->'created_at') IS DISTINCT FROM jsonb_build_array(to_jsonb(OLD)->'handoff_code',to_jsonb(OLD)->'planning_package_id',to_jsonb(OLD)->'handoff_version_no',to_jsonb(OLD)->'source_package_version',to_jsonb(OLD)->'source_package_digest',to_jsonb(OLD)->'source_digest',to_jsonb(OLD)->'prepared_by',to_jsonb(OLD)->'created_at') THEN RAISE EXCEPTION 'production handoff source facts are immutable' USING ERRCODE='55000'; END IF;
  IF TG_TABLE_NAME='production_handoffs' AND TG_OP='UPDATE' AND NOT (((to_jsonb(OLD)->>'status')='DRAFT' AND (to_jsonb(NEW)->>'status')='SUBMITTED') OR ((to_jsonb(OLD)->>'status')='SUBMITTED' AND (to_jsonb(NEW)->>'status') IN ('RETURNED','ACCEPTED'))) THEN RAISE EXCEPTION 'invalid production handoff state transition' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='production_inventory_reservations' AND TG_OP='UPDATE' AND jsonb_build_array(to_jsonb(NEW)->'work_order_id',to_jsonb(NEW)->'requirement_id',to_jsonb(NEW)->'balance_id',to_jsonb(NEW)->'material_id',to_jsonb(NEW)->'unit_id',to_jsonb(NEW)->'reserved_qty',to_jsonb(NEW)->'source_digest',to_jsonb(NEW)->'created_by',to_jsonb(NEW)->'created_at') IS DISTINCT FROM jsonb_build_array(to_jsonb(OLD)->'work_order_id',to_jsonb(OLD)->'requirement_id',to_jsonb(OLD)->'balance_id',to_jsonb(OLD)->'material_id',to_jsonb(OLD)->'unit_id',to_jsonb(OLD)->'reserved_qty',to_jsonb(OLD)->'source_digest',to_jsonb(OLD)->'created_by',to_jsonb(OLD)->'created_at') THEN RAISE EXCEPTION 'production reservation source facts are immutable' USING ERRCODE='55000'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER production_handoffs_guard BEFORE INSERT OR UPDATE OR DELETE ON production_handoffs FOR EACH ROW EXECUTE FUNCTION cyd_production_handoff_guard();
CREATE TRIGGER production_handoff_items_guard BEFORE INSERT OR UPDATE OR DELETE ON production_handoff_items FOR EACH ROW EXECUTE FUNCTION cyd_production_handoff_guard();
CREATE TRIGGER production_handoff_events_guard BEFORE INSERT OR UPDATE OR DELETE ON production_handoff_events FOR EACH ROW EXECUTE FUNCTION cyd_production_handoff_guard();
CREATE TRIGGER production_handoff_links_guard BEFORE INSERT OR UPDATE OR DELETE ON production_handoff_work_order_links FOR EACH ROW EXECUTE FUNCTION cyd_production_handoff_guard();
CREATE TRIGGER production_reservations_guard BEFORE INSERT OR UPDATE OR DELETE ON production_inventory_reservations FOR EACH ROW EXECUTE FUNCTION cyd_production_handoff_guard();
CREATE TRIGGER production_reservation_events_guard BEFORE INSERT OR UPDATE OR DELETE ON production_inventory_reservation_events FOR EACH ROW EXECUTE FUNCTION cyd_production_handoff_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_production_handoff_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM project_planning_packages p WHERE p.id=NEW.planning_package_id AND p.status='ACCEPTED' AND p.version=NEW.source_package_version AND p.package_digest=NEW.source_package_digest) THEN RAISE EXCEPTION 'production handoff package source is inconsistent' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER production_handoffs_source_guard BEFORE INSERT ON production_handoffs FOR EACH ROW EXECUTE FUNCTION cyd_production_handoff_source_guard();
CREATE OR REPLACE FUNCTION cyd_production_handoff_item_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM production_handoffs h JOIN project_planning_package_items i ON i.package_id=h.planning_package_id JOIN product_versions pv ON pv.id=i.product_version_id AND pv.product_id=NEW.product_id JOIN bom_versions bv ON bv.id=i.bom_version_id AND bv.product_version_id=i.product_version_id WHERE h.id=NEW.handoff_id AND i.id=NEW.planning_package_item_id AND i.product_version_id=NEW.product_version_id AND i.bom_version_id=NEW.bom_version_id AND i.unit_id=NEW.finished_unit_id AND i.required_quantity=NEW.planned_quantity) THEN RAISE EXCEPTION 'production handoff item source is inconsistent' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER production_handoff_items_source_guard BEFORE INSERT ON production_handoff_items FOR EACH ROW EXECUTE FUNCTION cyd_production_handoff_item_source_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_production_handoff_link_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM production_handoff_items i JOIN production_handoffs h ON h.id=i.handoff_id JOIN production_work_orders w ON w.id=NEW.work_order_id WHERE i.id=NEW.handoff_item_id AND h.status='ACCEPTED' AND w.status='DRAFT' AND (w.product_id,w.product_version_id,w.bom_version_id,w.finished_material_id,w.finished_unit_id,w.planned_qty)=(i.product_id,i.product_version_id,i.bom_version_id,i.finished_material_id,i.finished_unit_id,i.planned_quantity)) THEN RAISE EXCEPTION 'production handoff work order source is inconsistent' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER production_handoff_links_source_guard BEFORE INSERT ON production_handoff_work_order_links FOR EACH ROW EXECUTE FUNCTION cyd_production_handoff_link_source_guard();
CREATE OR REPLACE FUNCTION cyd_production_reservation_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM production_material_requirements r JOIN inventory_stock_balances b ON b.id=NEW.balance_id WHERE r.id=NEW.requirement_id AND r.work_order_id=NEW.work_order_id AND r.material_id=NEW.material_id AND r.unit_id=NEW.unit_id AND b.material_id=NEW.material_id AND b.unit_id=NEW.unit_id AND b.location_code='MAIN' AND b.lot_code='') THEN RAISE EXCEPTION 'production reservation source is inconsistent' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER production_reservations_source_guard BEFORE INSERT OR UPDATE ON production_inventory_reservations FOR EACH ROW EXECUTE FUNCTION cyd_production_reservation_source_guard();
