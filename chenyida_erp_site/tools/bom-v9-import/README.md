# BOM V9 explicit-field staging tool

This task-local tool only prepares and stages a single SHA-bound XLSX. It does not write any `public` business table and is not a main-database importer.

`prepare.py` requires the fixed `ERP编码版` header contract, rejects formulas, external links, hidden/extra sheets, duplicate headers and unrecognised columns, and writes only to a root-owned `0700` output directory. ERP code, category, name and unit are validated from explicit cells. `使用次数` is retained as source trace only and is never interpreted as BOM quantity. Missing unit or exact-identity duplication is routed to `NEEDS_REVIEW`; names are never used for fuzzy merging.

`stage-postgres.mjs` accepts only `ERP_ENV=test`, a database named `chenyida_erp_bom_v9_stage_YYYYMMDD`, migration head `0034_supplier_receipt_lot_iqc.sql`, a valid payload digest and the explicit confirmation phrase. It creates two tables under `migration_tool`, stores immutable source-row snapshots, and replays the same file/rule without adding rows. It cannot target `chenyida_erp`.

Product, product-version, BOM-version and BOM-line fields require a separate explicit contract. This tool fails closed if such columns are supplied and never infers them from `项目来源`, `原始描述` or usage counts.
