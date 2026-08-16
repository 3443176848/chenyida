\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset fieldsep '\t'

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '240s';
SET LOCAL idle_in_transaction_session_timeout = '15s';

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

-- Application migrations declare no large objects. The capture identity is
-- intentionally unable to read pg_largeobject pages; any unexpected metadata
-- row makes reconciliation fail before a backup can be accepted.
WITH large_object_inventory AS (
  SELECT count(*) AS object_count
  FROM pg_largeobject_metadata
), zero_large_object_assertion AS (
  SELECT 1 / CASE WHEN object_count = 0 THEN 1 ELSE 0 END AS checked
  FROM large_object_inventory
)
SELECT
  'LARGE_OBJECTS',
  object_count::text,
  '0',
  encode(digest(convert_to('0:0:0:0:0:0', 'UTF8'), 'sha256'), 'hex')
FROM large_object_inventory
CROSS JOIN zero_large_object_assertion
WHERE zero_large_object_assertion.checked = 1;

COMMIT;
