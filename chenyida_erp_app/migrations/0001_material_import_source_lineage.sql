CREATE TABLE material_import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_no TEXT NOT NULL UNIQUE,
    original_filename TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('CSV', 'XLSX', 'XLS')),
    selected_sheet_name TEXT NOT NULL,
    header_start_row INTEGER NOT NULL,
    header_end_row INTEGER NOT NULL,
    data_start_row INTEGER NOT NULL,
    structure_confidence REAL NOT NULL CHECK (structure_confidence >= 0 AND structure_confidence <= 1),
    mapping_json TEXT NOT NULL,
    total_source_rows INTEGER NOT NULL DEFAULT 0,
    data_row_count INTEGER NOT NULL DEFAULT 0,
    imported_row_count INTEGER NOT NULL DEFAULT 0,
    batch_status TEXT NOT NULL CHECK (batch_status IN ('PARSING', 'IMPORTED', 'FAILED')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE material_import_raw_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES material_import_batches(id),
    source_sheet_name TEXT NOT NULL,
    source_row_number INTEGER NOT NULL,
    raw_values_json TEXT NOT NULL,
    row_disposition TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(batch_id, source_sheet_name, source_row_number)
);

ALTER TABLE cleaning_rows ADD COLUMN source_batch_id INTEGER REFERENCES material_import_batches(id);
ALTER TABLE cleaning_rows ADD COLUMN source_sheet_name TEXT DEFAULT '';
ALTER TABLE cleaning_rows ADD COLUMN source_row_number INTEGER;
ALTER TABLE cleaning_rows ADD COLUMN mapped_values_json TEXT DEFAULT '{}';
ALTER TABLE cleaning_rows ADD COLUMN mapping_confidence REAL DEFAULT 0;
ALTER TABLE cleaning_rows ADD COLUMN specification_confidence REAL DEFAULT 0;
ALTER TABLE cleaning_rows ADD COLUMN mapping_status TEXT DEFAULT '';
ALTER TABLE cleaning_rows ADD COLUMN review_status TEXT DEFAULT '';

CREATE INDEX idx_material_import_batches_status
    ON material_import_batches(batch_status, created_at);
CREATE INDEX idx_material_import_raw_rows_batch
    ON material_import_raw_rows(batch_id, source_sheet_name, source_row_number);
CREATE INDEX idx_cleaning_rows_source
    ON cleaning_rows(source_batch_id, source_sheet_name, source_row_number);
