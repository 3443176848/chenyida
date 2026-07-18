ALTER TABLE cleaning_rows ADD COLUMN raw_model TEXT DEFAULT '';
ALTER TABLE cleaning_rows ADD COLUMN raw_category TEXT DEFAULT '';
ALTER TABLE cleaning_rows ADD COLUMN parsed_tolerance TEXT DEFAULT '';
ALTER TABLE cleaning_rows ADD COLUMN parsed_material TEXT DEFAULT '';

CREATE INDEX idx_cleaning_rows_structured_spec
    ON cleaning_rows(parsed_category, parsed_package, parsed_value, parsed_voltage, parsed_tolerance);
