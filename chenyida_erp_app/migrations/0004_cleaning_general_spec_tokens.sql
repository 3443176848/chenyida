ALTER TABLE cleaning_rows ADD COLUMN specification_source TEXT DEFAULT '';
ALTER TABLE cleaning_rows ADD COLUMN source_spec_tokens_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE cleaning_rows ADD COLUMN candidate_spec_tokens_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE cleaning_rows ADD COLUMN specification_match_evidence_json TEXT NOT NULL DEFAULT '{}';
