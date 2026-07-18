ALTER TABLE material_import_batches ADD COLUMN archived_file_key TEXT DEFAULT '';
ALTER TABLE material_import_batches ADD COLUMN file_size_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE material_import_batches ADD COLUMN parse_warnings_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX idx_material_import_batches_file_sha
    ON material_import_batches(source_sha256);
