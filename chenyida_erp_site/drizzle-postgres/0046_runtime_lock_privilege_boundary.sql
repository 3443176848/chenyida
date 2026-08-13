CREATE FUNCTION "public"."cyd_web_lock_finance_ar_source"("target_source_id" bigint)
RETURNS TABLE(
	"entry_type" text,
	"active" boolean,
	"customer_id" bigint,
	"amount" numeric(48, 6),
	"currency_code" text
)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
	AS $$
BEGIN
	IF target_source_id IS NULL OR target_source_id <= 0 THEN
		RAISE EXCEPTION 'target_source_id must be a positive integer' USING ERRCODE = '22023';
	END IF;
	RETURN QUERY
	SELECT source.entry_type,
		NOT EXISTS(
			SELECT 1
			FROM public.sales_financial_source_entries AS reversal
			WHERE reversal.reversal_of_source_entry_id = source.id
		),
		source.customer_id,
		source.amount,
		source.currency_code
	FROM public.sales_financial_source_entries AS source
	JOIN public.sales_shipments AS shipment ON shipment.id = source.shipment_id
	WHERE source.id = target_source_id
	FOR UPDATE OF shipment;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_web_lock_finance_ar_source"(bigint) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "public"."cyd_web_lock_finance_settlement_reversal"("target_settlement_id" bigint, "target_document_id" bigint)
RETURNS TABLE(
	"id" bigint,
	"original_settlement_id" bigint,
	"settlement_type" text,
	"amount" numeric(24, 6),
	"account_name" text
)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
	AS $$
BEGIN
	IF target_settlement_id IS NULL OR target_settlement_id <= 0
		OR target_document_id IS NULL OR target_document_id <= 0 THEN
		RAISE EXCEPTION 'settlement and document identifiers must be positive integers' USING ERRCODE = '22023';
	END IF;
	RETURN QUERY
	SELECT settlement.id,
		settlement.original_settlement_id,
		settlement.settlement_type,
		settlement.amount,
		settlement.account_name
	FROM public.finance_settlements AS settlement
	WHERE settlement.id = target_settlement_id
		AND settlement.document_id = target_document_id
	FOR UPDATE OF settlement;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_web_lock_finance_settlement_reversal"(bigint, bigint) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "public"."cyd_web_lock_ncr_source"("target_inspection_id" bigint)
RETURNS TABLE(
	"version" integer,
	"run_report_id" bigint,
	"work_order_id" bigint,
	"snapshot_operation_id" bigint,
	"work_center_id" bigint,
	"work_center_code" text,
	"work_center_name" text,
	"material_id" bigint,
	"unit_id" bigint,
	"inspected_qty" numeric(24, 6),
	"passed_qty" numeric(24, 6),
	"failed_qty" numeric(24, 6)
)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
	AS $$
BEGIN
	IF target_inspection_id IS NULL OR target_inspection_id <= 0 THEN
		RAISE EXCEPTION 'target_inspection_id must be a positive integer' USING ERRCODE = '22023';
	END IF;
	RETURN QUERY
	SELECT inspection.version,
		run_report.id,
		run.work_order_id,
		run_report.snapshot_operation_id,
		operation.work_center_id,
		operation.work_center_code,
		operation.work_center_name,
		work_order.finished_material_id,
		work_order.finished_unit_id,
		inspection.inspected_qty,
		inspection.passed_qty,
		inspection.failed_qty
	FROM public.quality_inspections AS inspection
	JOIN public.production_operation_run_reports AS run_report
		ON run_report.id = inspection.production_operation_run_report_id
	JOIN public.production_operation_runs AS run ON run.id = run_report.run_id
	JOIN public.production_work_order_routing_snapshot_operations AS operation
		ON operation.id = run_report.snapshot_operation_id
	JOIN public.production_work_orders AS work_order ON work_order.id = run.work_order_id
	WHERE inspection.id = target_inspection_id
	FOR UPDATE OF inspection, run_report, run, operation, work_order;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_web_lock_ncr_source"(bigint) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "public"."cyd_web_lock_operation_upstream_sources"("target_snapshot_operation_id" bigint, "target_production_batch_id" bigint)
RETURNS TABLE("id" bigint, "available" text)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
	AS $$
BEGIN
	IF target_snapshot_operation_id IS NULL OR target_snapshot_operation_id <= 0
		OR (target_production_batch_id IS NOT NULL AND target_production_batch_id <= 0) THEN
		RAISE EXCEPTION 'source identifiers must be positive integers' USING ERRCODE = '22023';
	END IF;
	RETURN QUERY
	SELECT run.id,
		(CASE
			WHEN operation.quality_gate_mode = 'IPQC' THEN coalesce(quality.released, 0)
			ELSE run.good_qty
		END - coalesce(allocation.used, 0))::text
	FROM public.production_operation_runs AS run
	JOIN public.production_work_order_routing_snapshot_operations AS operation
		ON operation.id = run.snapshot_operation_id
	LEFT JOIN LATERAL (
		SELECT sum(source_allocation.quantity) AS used
		FROM public.production_operation_run_input_allocations AS source_allocation
		JOIN public.production_operation_runs AS target_run ON target_run.id = source_allocation.run_id
		WHERE source_allocation.source_run_id = run.id
			AND target_run.status NOT IN ('CANCELLED', 'REVERSED')
	) AS allocation ON true
	LEFT JOIN LATERAL (
		SELECT sum(inspection.released_qty) AS released
		FROM public.quality_inspections AS inspection
		JOIN public.production_operation_run_reports AS report
			ON report.id = inspection.production_operation_run_report_id
		WHERE report.run_id = run.id
			AND inspection.lifecycle_status = 'CLOSED'
			AND inspection.decision_status = 'RELEASED'
	) AS quality ON true
	WHERE run.snapshot_operation_id = target_snapshot_operation_id
		AND run.production_batch_id IS NOT DISTINCT FROM target_production_batch_id
		AND run.status NOT IN ('CANCELLED', 'REVERSED')
		AND CASE
			WHEN operation.quality_gate_mode = 'IPQC' THEN coalesce(quality.released, 0)
			ELSE run.good_qty
		END - coalesce(allocation.used, 0) > 0
	ORDER BY run.id
	FOR UPDATE OF run, operation;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_web_lock_operation_upstream_sources"(bigint, bigint) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "public"."cyd_web_lock_final_output_sources"("target_report_ids" bigint[])
RETURNS TABLE(
	"id" bigint,
	"good_qty" numeric(24, 6),
	"work_order_id" bigint,
	"production_batch_id" bigint,
	"snapshot_operation_id" bigint,
	"run_snapshot_operation_id" bigint,
	"run_status" text,
	"quality_gate_mode" text,
	"consumed_qty" text,
	"quality_released_qty" text
)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
	AS $$
BEGIN
	IF target_report_ids IS NULL OR cardinality(target_report_ids) NOT BETWEEN 1 AND 100
		OR array_position(target_report_ids, NULL) IS NOT NULL
		OR EXISTS (SELECT 1 FROM unnest(target_report_ids) AS candidate(id) WHERE candidate.id <= 0)
		OR cardinality(target_report_ids) <> (SELECT count(DISTINCT candidate.id) FROM unnest(target_report_ids) AS candidate(id)) THEN
		RAISE EXCEPTION 'target_report_ids must contain 1 to 100 unique positive integers' USING ERRCODE = '22023';
	END IF;
	RETURN QUERY
	SELECT report.id,
		report.good_qty,
		run.work_order_id,
		run.production_batch_id,
		report.snapshot_operation_id,
		run.snapshot_operation_id,
		run.status,
		operation.quality_gate_mode,
		coalesce((
			SELECT sum(allocation.quantity)
			FROM public.production_report_operation_allocations AS allocation
			JOIN public.production_report_receipt_projections AS projection
				ON projection.report_id = allocation.production_report_id
			WHERE allocation.operation_run_report_id = report.id AND NOT projection.reversed
		), 0)::text,
		coalesce((
			SELECT sum(inspection.released_qty)
			FROM public.quality_inspections AS inspection
			WHERE inspection.production_operation_run_report_id = report.id
				AND inspection.lifecycle_status = 'CLOSED'
				AND inspection.decision_status = 'RELEASED'
		), 0)::text
	FROM public.production_operation_run_reports AS report
	JOIN public.production_operation_runs AS run ON run.id = report.run_id
	JOIN public.production_work_order_routing_snapshot_operations AS operation
		ON operation.id = report.snapshot_operation_id
	WHERE report.id = ANY(target_report_ids)
	ORDER BY report.id
	FOR UPDATE OF run, report, operation;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_web_lock_final_output_sources"(bigint[]) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "public"."cyd_web_lock_production_reports"("target_report_ids" bigint[])
RETURNS TABLE(
	"id" bigint,
	"work_order_id" bigint,
	"reported_qty" numeric(24, 6),
	"good_qty" numeric(24, 6),
	"scrap_qty" numeric(24, 6),
	"created_by" text,
	"allocated_good_qty" numeric(24, 6),
	"reversed" boolean,
	"report_version" integer,
	"production_batch_id" bigint
)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
	AS $$
BEGIN
	IF target_report_ids IS NULL OR cardinality(target_report_ids) NOT BETWEEN 1 AND 100
		OR array_position(target_report_ids, NULL) IS NOT NULL
		OR EXISTS (SELECT 1 FROM unnest(target_report_ids) AS candidate(id) WHERE candidate.id <= 0)
		OR cardinality(target_report_ids) <> (SELECT count(DISTINCT candidate.id) FROM unnest(target_report_ids) AS candidate(id)) THEN
		RAISE EXCEPTION 'target_report_ids must contain 1 to 100 unique positive integers' USING ERRCODE = '22023';
	END IF;
	RETURN QUERY
	SELECT report.id,
		report.work_order_id,
		report.reported_qty,
		report.good_qty,
		report.scrap_qty,
		report.created_by,
		projection.allocated_good_qty,
		projection.reversed,
		projection.version,
		batch.production_batch_id
	FROM public.production_reports AS report
	JOIN public.production_report_receipt_projections AS projection ON projection.report_id = report.id
	LEFT JOIN public.production_report_batches AS batch ON batch.production_report_id = report.id
	WHERE report.id = ANY(target_report_ids)
	ORDER BY report.id
	FOR UPDATE OF report, projection;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_web_lock_production_reports"(bigint[]) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "public"."cyd_web_lock_report_operation_sources"("target_report_id" bigint) RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
	AS $$
BEGIN
	IF target_report_id IS NULL OR target_report_id <= 0 THEN
		RAISE EXCEPTION 'target_report_id must be a positive integer' USING ERRCODE = '22023';
	END IF;
	PERFORM run_report.id
	FROM public.production_report_operation_allocations AS allocation
	JOIN public.production_operation_run_reports AS run_report
		ON run_report.id = allocation.operation_run_report_id
	JOIN public.production_operation_runs AS run ON run.id = run_report.run_id
	WHERE allocation.production_report_id = target_report_id
	ORDER BY run_report.id
	FOR UPDATE OF run, run_report;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_web_lock_report_operation_sources"(bigint) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "public"."cyd_web_lock_production_completion"("target_completion_id" bigint)
RETURNS TABLE(
	"id" bigint,
	"work_order_id" bigint,
	"inventory_adjustment_id" bigint,
	"completion_version" integer,
	"reversed" boolean
)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
	AS $$
BEGIN
	IF target_completion_id IS NULL OR target_completion_id <= 0 THEN
		RAISE EXCEPTION 'target_completion_id must be a positive integer' USING ERRCODE = '22023';
	END IF;
	RETURN QUERY
	SELECT completion.id,
		completion.work_order_id,
		completion.inventory_adjustment_id,
		projection.version,
		projection.reversed
	FROM public.production_completions AS completion
	JOIN public.production_completion_receipt_projections AS projection
		ON projection.completion_id = completion.id
	WHERE completion.id = target_completion_id
	FOR UPDATE OF completion, projection;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_web_lock_production_completion"(bigint) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "public"."cyd_web_lock_production_completion_lines"("target_completion_id" bigint)
RETURNS TABLE("id" bigint)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
	AS $$
BEGIN
	IF target_completion_id IS NULL OR target_completion_id <= 0 THEN
		RAISE EXCEPTION 'target_completion_id must be a positive integer' USING ERRCODE = '22023';
	END IF;
	RETURN QUERY
	SELECT line.id
	FROM public.production_completion_lines AS line
	WHERE line.completion_id = target_completion_id
	ORDER BY line.id
	FOR UPDATE OF line;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_web_lock_production_completion_lines"(bigint) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "public"."cyd_web_lock_quality_completion_allocation_source"("target_completion_line_id" bigint)
RETURNS TABLE(
	"completion_qty" numeric(24, 6),
	"completion_version" integer,
	"reversed" boolean,
	"inventory_lot_id" bigint,
	"work_customer" bigint,
	"work_product" bigint,
	"work_product_version" bigint,
	"work_material" bigint,
	"work_unit" bigint
)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
	AS $$
BEGIN
	IF target_completion_line_id IS NULL OR target_completion_line_id <= 0 THEN
		RAISE EXCEPTION 'target_completion_line_id must be a positive integer' USING ERRCODE = '22023';
	END IF;
	RETURN QUERY
	SELECT line.quantity,
		projection.version,
		projection.reversed,
		lot_link.inventory_lot_id,
		product.customer_id,
		work_order.product_id,
		work_order.product_version_id,
		work_order.finished_material_id,
		work_order.finished_unit_id
	FROM public.production_completion_lines AS line
	JOIN public.production_completions AS completion ON completion.id = line.completion_id
	JOIN public.production_completion_receipt_projections AS projection
		ON projection.completion_id = completion.id
	LEFT JOIN public.production_completion_inventory_lots AS lot_link
		ON lot_link.production_completion_id = completion.id
	JOIN public.production_work_orders AS work_order ON work_order.id = completion.work_order_id
	JOIN public.products AS product ON product.id = work_order.product_id
	WHERE line.id = target_completion_line_id
	FOR UPDATE OF line, projection;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_web_lock_quality_completion_allocation_source"(bigint) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "public"."cyd_web_lock_quality_completion_capacity"("target_completion_line_id" bigint)
RETURNS TABLE("id" bigint, "quantity" numeric(24, 6))
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
	AS $$
BEGIN
	IF target_completion_line_id IS NULL OR target_completion_line_id <= 0 THEN
		RAISE EXCEPTION 'target_completion_line_id must be a positive integer' USING ERRCODE = '22023';
	END IF;
	RETURN QUERY
	SELECT line.id, line.quantity
	FROM public.production_completion_lines AS line
	WHERE line.id = target_completion_line_id
	FOR UPDATE OF line;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_web_lock_quality_completion_capacity"(bigint) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "public"."cyd_web_lock_quality_operation_source"("target_report_id" bigint)
RETURNS TABLE(
	"material_id" text,
	"unit_id" text,
	"source_qty" text,
	"work_order_id" bigint,
	"snapshot_operation_id" bigint,
	"sequence_no" integer,
	"operation_code" text,
	"operation_name" text,
	"work_center_id" bigint,
	"work_center_code" text,
	"work_center_name" text,
	"quality_gate_mode" text
)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
	AS $$
BEGIN
	IF target_report_id IS NULL OR target_report_id <= 0 THEN
		RAISE EXCEPTION 'target_report_id must be a positive integer' USING ERRCODE = '22023';
	END IF;
	RETURN QUERY
	SELECT work_order.finished_material_id::text,
		work_order.finished_unit_id::text,
		report.good_qty::text,
		run.work_order_id,
		report.snapshot_operation_id,
		operation.sequence_no,
		operation.operation_code,
		operation.operation_name,
		operation.work_center_id,
		operation.work_center_code,
		operation.work_center_name,
		operation.quality_gate_mode
	FROM public.production_operation_run_reports AS report
	JOIN public.production_operation_runs AS run
		ON run.id = report.run_id AND run.status NOT IN ('CANCELLED', 'REVERSED')
	JOIN public.production_work_order_routing_snapshot_operations AS operation
		ON operation.id = report.snapshot_operation_id
		AND operation.id = run.snapshot_operation_id
		AND operation.quality_gate_mode = 'IPQC'
	JOIN public.production_work_order_routing_snapshots AS snapshot
		ON snapshot.id = operation.snapshot_id AND snapshot.work_order_id = run.work_order_id
	JOIN public.production_work_orders AS work_order ON work_order.id = run.work_order_id
	WHERE report.id = target_report_id AND report.good_qty > 0
	FOR UPDATE OF report, run, operation, snapshot, work_order;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_web_lock_quality_operation_source"(bigint) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "public"."cyd_web_lock_quality_legacy_report_source"("target_report_id" bigint)
RETURNS TABLE("material_id" text, "unit_id" text, "source_qty" text)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
	AS $$
BEGIN
	IF target_report_id IS NULL OR target_report_id <= 0 THEN
		RAISE EXCEPTION 'target_report_id must be a positive integer' USING ERRCODE = '22023';
	END IF;
	RETURN QUERY
	SELECT work_order.finished_material_id::text,
		work_order.finished_unit_id::text,
		report.reported_qty::text
	FROM public.production_reports AS report
	JOIN public.production_report_receipt_projections AS projection
		ON projection.report_id = report.id AND NOT projection.reversed
	JOIN public.production_work_orders AS work_order ON work_order.id = report.work_order_id
	WHERE report.id = target_report_id
	FOR UPDATE OF report, projection;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_web_lock_quality_legacy_report_source"(bigint) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "public"."cyd_web_lock_quality_fqc_source"("target_allocation_id" bigint)
RETURNS TABLE(
	"id" bigint,
	"allocation_qty" text,
	"completion_line_id" bigint,
	"sales_order_line_id" bigint,
	"inventory_lot_id" bigint,
	"material_id" text,
	"unit_id" text,
	"completion_qty" text,
	"order_qty" text
)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
	AS $$
BEGIN
	IF target_allocation_id IS NULL OR target_allocation_id <= 0 THEN
		RAISE EXCEPTION 'target_allocation_id must be a positive integer' USING ERRCODE = '22023';
	END IF;
	RETURN QUERY
	SELECT allocation.id,
		allocation.quantity::text,
		allocation.completion_line_id,
		allocation.sales_order_line_id,
		allocation.inventory_lot_id,
		completion_line.material_id::text,
		completion_line.unit_id::text,
		completion_line.quantity::text,
		order_line.ordered_qty::text
	FROM public.finished_goods_sales_allocations AS allocation
	JOIN public.production_completion_lines AS completion_line
		ON completion_line.id = allocation.completion_line_id
	JOIN public.production_completions AS completion ON completion.id = completion_line.completion_id
	JOIN public.production_completion_receipt_projections AS completion_projection
		ON completion_projection.completion_id = completion.id AND NOT completion_projection.reversed
	JOIN public.sales_order_lines AS order_line ON order_line.id = allocation.sales_order_line_id
	JOIN public.sales_order_versions AS order_version ON order_version.id = order_line.sales_order_version_id
	JOIN public.sales_orders AS sales_order
		ON sales_order.id = order_version.sales_order_id
		AND sales_order.current_version_no = order_version.version_no
		AND sales_order.status IN ('OPEN', 'PARTIALLY_SHIPPED')
	WHERE allocation.id = target_allocation_id AND allocation.status = 'ACTIVE'
	FOR UPDATE OF allocation, completion_line, completion_projection, order_line, sales_order;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_web_lock_quality_fqc_source"(bigint) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "public"."cyd_web_lock_sales_shipment_reversal"("target_shipment_id" bigint)
RETURNS TABLE(
	"shipment_type" text,
	"inventory_adjustment_id" bigint,
	"sales_order_id" bigint,
	"receiver" text,
	"order_status" text,
	"order_version" integer,
	"customer_id" bigint,
	"current_version_no" integer,
	"financial_source_entry_id" bigint,
	"financial_amount" numeric(48, 6),
	"currency_code" text
)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
	AS $$
BEGIN
	IF target_shipment_id IS NULL OR target_shipment_id <= 0 THEN
		RAISE EXCEPTION 'target_shipment_id must be a positive integer' USING ERRCODE = '22023';
	END IF;
	RETURN QUERY
	SELECT shipment.shipment_type,
		shipment.inventory_adjustment_id,
		shipment.sales_order_id,
		shipment.receiver,
		sales_order.status,
		sales_order.version,
		sales_order.customer_id,
		sales_order.current_version_no,
		financial_source.id,
		financial_source.amount,
		financial_source.currency_code
	FROM public.sales_shipments AS shipment
	JOIN public.sales_orders AS sales_order ON sales_order.id = shipment.sales_order_id
	JOIN public.sales_financial_source_entries AS financial_source
		ON financial_source.shipment_id = shipment.id
	WHERE shipment.id = target_shipment_id
	FOR UPDATE OF shipment, sales_order;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_web_lock_sales_shipment_reversal"(bigint) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "public"."cyd_web_lock_sales_fqc_reversal_sources"("target_shipment_line_ids" bigint[])
RETURNS TABLE(
	"id" bigint,
	"shipment_line_id" bigint,
	"quality_inspection_id" bigint,
	"fqc_allocation_id" bigint,
	"inventory_lot_id" bigint,
	"quantity" numeric(24, 6)
)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
	AS $$
BEGIN
	IF target_shipment_line_ids IS NULL OR cardinality(target_shipment_line_ids) NOT BETWEEN 1 AND 100
		OR array_position(target_shipment_line_ids, NULL) IS NOT NULL
		OR EXISTS (SELECT 1 FROM unnest(target_shipment_line_ids) AS candidate(id) WHERE candidate.id <= 0)
		OR cardinality(target_shipment_line_ids) <> (SELECT count(DISTINCT candidate.id) FROM unnest(target_shipment_line_ids) AS candidate(id)) THEN
		RAISE EXCEPTION 'target_shipment_line_ids must contain 1 to 100 unique positive integers' USING ERRCODE = '22023';
	END IF;
	RETURN QUERY
	SELECT allocation.id,
		allocation.shipment_line_id,
		allocation.quality_inspection_id,
		allocation.fqc_allocation_id,
		allocation.inventory_lot_id,
		allocation.quantity
	FROM public.sales_shipment_line_fqc_allocations AS allocation
	WHERE allocation.shipment_line_id = ANY(target_shipment_line_ids)
		AND allocation.entry_type = 'SHIPMENT'
	ORDER BY allocation.id
	FOR UPDATE OF allocation;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_web_lock_sales_fqc_reversal_sources"(bigint[]) FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_finance_document_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_finance_document_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_finance_document_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_finance_settlement_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_finance_settlement_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_finance_settlement_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_finance_source_reversal_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_finance_source_reversal_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_finance_source_reversal_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_finished_goods_allocation_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_finished_goods_allocation_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_finished_goods_allocation_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_inventory_lot_fact_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_inventory_lot_fact_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_inventory_lot_fact_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_nonconformance_allocation_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_nonconformance_allocation_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_nonconformance_allocation_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_nonconformance_header_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_nonconformance_header_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_nonconformance_header_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_production_batch_set_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_production_batch_set_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_production_batch_set_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_production_completion_batch_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_production_completion_batch_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_production_completion_batch_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_production_final_output_allocation_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_production_final_output_allocation_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_production_final_output_allocation_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_production_operation_allocation_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_production_operation_allocation_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_production_operation_allocation_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_production_operation_run_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_production_operation_run_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_production_operation_run_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_production_report_batch_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_production_report_batch_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_production_report_batch_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_quality_source_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_quality_source_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_quality_source_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_rework_request_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_rework_request_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_rework_request_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_sales_delivery_execution_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_sales_delivery_execution_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_sales_delivery_execution_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_sales_fqc_allocation_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_sales_fqc_allocation_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_sales_fqc_allocation_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_sales_fqc_lot_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_sales_fqc_lot_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_sales_fqc_lot_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_sales_shipment_line_lot_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_sales_shipment_line_lot_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_sales_shipment_line_lot_guard"() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_warehouse_receipt_evidence_guard"() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION "public"."cyd_warehouse_receipt_evidence_guard"() SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cyd_warehouse_receipt_evidence_guard"() FROM PUBLIC;
