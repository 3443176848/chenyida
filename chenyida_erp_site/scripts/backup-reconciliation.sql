\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset fieldsep '\t'

-- Canonical, plaintext-free but content-sensitive logical reconciliation for
-- the application database dump. Object names are UTF-8 hex so tabs/newlines
-- in identifiers cannot alter rows. Session rendering is fixed explicitly so
-- equivalent values hash identically across clusters with different defaults.
SET TimeZone = 'UTC';
SET DateStyle = 'ISO, YMD';
SET IntervalStyle = 'iso_8601';
SET extra_float_digits = 3;
SET bytea_output = 'hex';
SELECT format(
  $statement$
  WITH row_hashes AS (
    SELECT encode(digest(convert_to(to_jsonb(source_row)::text, 'UTF8'), 'sha256'), 'hex') AS value
    FROM %I.%I AS source_row
  ), aggregate_hash AS (
    SELECT
      count(*)::text AS row_count,
      coalesce(sum((('x' || substr(value, 1, 16))::bit(64)::bigint)::numeric), 0)::text AS h1,
      coalesce(sum((('x' || substr(value, 17, 16))::bit(64)::bigint)::numeric), 0)::text AS h2,
      coalesce(sum((('x' || substr(value, 33, 16))::bit(64)::bigint)::numeric), 0)::text AS h3,
      coalesce(sum((('x' || substr(value, 49, 16))::bit(64)::bigint)::numeric), 0)::text AS h4
    FROM row_hashes
  )
  SELECT %L::text,%L::text,row_count,
    encode(digest(convert_to(concat_ws(':', row_count, h1, h2, h3, h4), 'UTF8'), 'sha256'), 'hex')
  FROM aggregate_hash;
  $statement$,
  n.nspname,
  c.relname,
  'RELATION',
  encode(convert_to(n.nspname || '.' || c.relname, 'UTF8'), 'hex')
)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'm')
  AND NOT c.relispartition
  AND n.nspname <> 'information_schema'
  AND n.nspname !~ '^pg_'
ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"
\gexec

SELECT format(
  'SELECT %L::text,%L::text,last_value::text,is_called::text FROM %I.%I;',
  'SEQUENCE',
  encode(convert_to(n.nspname || '.' || c.relname, 'UTF8'), 'hex'),
  n.nspname,
  c.relname
)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'S'
  AND n.nspname <> 'information_schema'
  AND n.nspname !~ '^pg_'
ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"
\gexec

SELECT
  'EXTENSION',
  encode(convert_to(e.extname, 'UTF8'), 'hex'),
  encode(convert_to(e.extversion, 'UTF8'), 'hex'),
  encode(convert_to(n.nspname, 'UTF8'), 'hex')
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname <> 'plpgsql'
ORDER BY e.extname COLLATE "C";

WITH large_object_page_hashes AS (
  SELECT
    encode(digest(int8send(loid::bigint) || int4send(pageno) || data, 'sha256'), 'hex') AS value,
    octet_length(data) AS bytes
  FROM pg_largeobject
), aggregate_hash AS (
  SELECT
    count(*)::text AS page_count,
    coalesce(sum(bytes), 0)::text AS total_bytes,
    coalesce(sum((('x' || substr(value, 1, 16))::bit(64)::bigint)::numeric), 0)::text AS h1,
    coalesce(sum((('x' || substr(value, 17, 16))::bit(64)::bigint)::numeric), 0)::text AS h2,
    coalesce(sum((('x' || substr(value, 33, 16))::bit(64)::bigint)::numeric), 0)::text AS h3,
    coalesce(sum((('x' || substr(value, 49, 16))::bit(64)::bigint)::numeric), 0)::text AS h4
  FROM large_object_page_hashes
)
SELECT
  'LARGE_OBJECTS',
  page_count,
  total_bytes,
  encode(digest(convert_to(concat_ws(':', page_count, total_bytes, h1, h2, h3, h4), 'UTF8'), 'sha256'), 'hex')
FROM aggregate_hash;
