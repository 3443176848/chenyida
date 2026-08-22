\set ON_ERROR_STOP on
\set QUIET on

SET client_min_messages = warning;
SET DateStyle = 'ISO, YMD';
SET IntervalStyle = 'iso_8601';
SET TimeZone = 'UTC';
SET bytea_output = 'hex';
SET extra_float_digits = 3;
SET search_path = pg_catalog;
SET row_security = off;
SET lock_timeout = '5s';
SET statement_timeout = '60s';

\if :{?expected_database}
\else
DO $cyd_runtime_catalog_failure$
BEGIN
  RAISE EXCEPTION 'expected_database is required';
END
$cyd_runtime_catalog_failure$;
\endif
\if :{?migration_owner}
\else
DO $cyd_runtime_catalog_failure$
BEGIN
  RAISE EXCEPTION 'migration_owner is required';
END
$cyd_runtime_catalog_failure$;
\endif
\if :{?expected_marker}
\else
DO $cyd_runtime_catalog_failure$
BEGIN
  RAISE EXCEPTION 'expected_marker is required';
END
$cyd_runtime_catalog_failure$;
\endif
\if :{?expected_system_identifier}
\else
DO $cyd_runtime_catalog_failure$
BEGIN
  RAISE EXCEPTION 'expected_system_identifier is required';
END
$cyd_runtime_catalog_failure$;
\endif

\if :{?controlled_runtime_mode}
  SELECT (
    current_database()=:'expected_database'
    AND shobj_description(database.oid,'pg_database')=:'expected_marker'
    AND control.system_identifier::text=:'expected_system_identifier'
    AND current_user=session_user
    AND EXISTS (SELECT 1 FROM pg_roles role WHERE role.rolname=current_user AND role.rolsuper)
    AND current_setting('server_version_num')='170010'
    AND NOT pg_is_in_recovery()
    AND current_setting('listen_addresses')='*'
    AND pg_get_userbyid(database.datdba) IN (:'migration_owner',current_user)
  ) AS controlled_target_valid
  FROM pg_database database
  CROSS JOIN pg_control_system() control
  WHERE database.datname=current_database()
  \gset
  \if :controlled_target_valid
  \else
DO $cyd_runtime_catalog_failure$
BEGIN
  RAISE EXCEPTION 'RUNTIME_PRIVILEGE_CATALOG_CONTROLLED_TARGET_INVALID';
END
$cyd_runtime_catalog_failure$;
  \endif
\else
  SELECT (
    current_database()=:'expected_database'
    AND shobj_description(database.oid,'pg_database')=:'expected_marker'
    AND control.system_identifier::text=:'expected_system_identifier'
    AND current_user=session_user
    AND current_user='postgres'
    AND current_setting('server_version_num')='170010'
    AND NOT pg_is_in_recovery()
    AND current_setting('listen_addresses')=''
    AND pg_get_userbyid(database.datdba)=:'migration_owner'
  ) AS synthetic_target_valid
  FROM pg_database database
  CROSS JOIN pg_control_system() control
  WHERE database.datname=current_database()
  \gset
  \if :synthetic_target_valid
  \else
DO $cyd_runtime_catalog_failure$
BEGIN
  RAISE EXCEPTION 'RUNTIME_PRIVILEGE_CATALOG_SYNTHETIC_TARGET_INVALID';
END
$cyd_runtime_catalog_failure$;
  \endif
\endif

CREATE TEMP TABLE cyd_role_semantics ON COMMIT PRESERVE ROWS AS
SELECT role.oid AS role_oid,'MIGRATION_OWNER'::text AS semantic_name
FROM pg_roles role
WHERE role.rolname=:'migration_owner';

CREATE OR REPLACE FUNCTION pg_temp.cyd_owner_name(role_oid oid)
RETURNS text
LANGUAGE sql STABLE STRICT PARALLEL SAFE
AS $$
  SELECT coalesce(
    (SELECT semantic_name FROM pg_temp.cyd_role_semantics WHERE cyd_role_semantics.role_oid=cyd_owner_name.role_oid),
    CASE
      WHEN pg_get_userbyid(role_oid)='pg_database_owner' THEN 'pg_database_owner'
      WHEN pg_get_userbyid(role_oid)=current_user THEN 'PLATFORM_OWNER'
      ELSE pg_get_userbyid(role_oid)
    END
  )
$$;

CREATE OR REPLACE FUNCTION pg_temp.cyd_sha256(value text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT encode(sha256(convert_to(value,'UTF8')),'hex') $$;

CREATE OR REPLACE FUNCTION pg_temp.cyd_object_identity(class_id oid,object_id oid)
RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT CASE WHEN object_id=0 THEN 'NONE' ELSE coalesce((pg_identify_object(class_id,object_id,0)).identity,'MISSING') END $$;

CREATE TEMP TABLE cyd_extension_members(
  classid oid NOT NULL,
  objid oid NOT NULL,
  objsubid integer NOT NULL,
  extension_name text NOT NULL
) ON COMMIT PRESERVE ROWS;

SET default_transaction_read_only = on;
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;

INSERT INTO cyd_extension_members
SELECT dependency.classid,dependency.objid,dependency.objsubid,extension.extname
FROM pg_depend dependency
JOIN pg_extension extension ON extension.oid=dependency.refobjid
WHERE dependency.refclassid='pg_extension'::regclass AND dependency.deptype='e';

SELECT 'META' AS record_type,jsonb_build_object(
  'contract','chenyida-erp-postgresql-runtime-privilege-catalog-report/v1',
  'database',current_database(),
  'schema','public',
  'server_major',(current_setting('server_version_num')::integer/10000)::text,
  'server_version_num',current_setting('server_version_num'),
  'encoding',pg_encoding_to_char(database.encoding),
  'locale_provider',CASE database.datlocprovider WHEN 'c' THEN 'libc' WHEN 'i' THEN 'icu' WHEN 'b' THEN 'builtin' ELSE 'unknown' END,
  'collate',database.datcollate,
  'ctype',database.datctype,
  'collation_version',database.datcollversion,
  'database_owner',pg_temp.cyd_owner_name(database.datdba),
  'schema_owner',pg_temp.cyd_owner_name(namespace.nspowner)
)::text AS payload
FROM pg_database database
JOIN pg_namespace namespace ON namespace.nspname='public'
WHERE database.datname=current_database();

SELECT 'MIGRATION',jsonb_build_object(
  'version',migration.version,
  'checksum',migration.checksum
)::text
FROM public.schema_migrations migration
ORDER BY migration.version COLLATE "C";

SELECT 'TABLE',jsonb_build_object(
  'name',relation.relname,
  'kind',CASE relation.relkind WHEN 'r' THEN 'TABLE' WHEN 'p' THEN 'PARTITIONED_TABLE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED_VIEW' WHEN 'f' THEN 'FOREIGN_TABLE' ELSE 'UNSUPPORTED' END,
  'owner',pg_temp.cyd_owner_name(relation.relowner),
  'persistence',CASE relation.relpersistence WHEN 'p' THEN 'PERMANENT' WHEN 'u' THEN 'UNLOGGED' WHEN 't' THEN 'TEMPORARY' ELSE 'UNSUPPORTED' END,
  'row_security',relation.relrowsecurity,
  'force_row_security',relation.relforcerowsecurity,
  'replica_identity',CASE relation.relreplident WHEN 'd' THEN 'DEFAULT' WHEN 'n' THEN 'NOTHING' WHEN 'f' THEN 'FULL' WHEN 'i' THEN 'INDEX' ELSE 'UNSUPPORTED' END,
  'access_method',access_method.amname,
  'tablespace',tablespace.spcname,
  'is_partition',relation.relispartition,
  'partition_parent',parent.relname,
  'relation_options',to_jsonb(coalesce((SELECT array_agg(option ORDER BY option) FROM unnest(relation.reloptions) option),ARRAY[]::text[])),
  'toast_options',to_jsonb(coalesce((SELECT array_agg(option ORDER BY option) FROM unnest(toast_relation.reloptions) option),ARRAY[]::text[]))
)::text
FROM pg_class relation
JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace AND namespace.nspname='public'
LEFT JOIN pg_am access_method ON access_method.oid=relation.relam
LEFT JOIN pg_tablespace tablespace ON tablespace.oid=relation.reltablespace
LEFT JOIN pg_inherits inheritance ON inheritance.inhrelid=relation.oid
LEFT JOIN pg_class parent ON parent.oid=inheritance.inhparent
LEFT JOIN pg_class toast_relation ON toast_relation.oid=relation.reltoastrelid
LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_class'::regclass AND extension_member.objid=relation.oid AND extension_member.objsubid=0
WHERE relation.relkind IN ('r','p','v','m','f') AND extension_member.objid IS NULL
ORDER BY relation.relname;

SELECT 'SEQUENCE',jsonb_build_object(
  'name',relation.relname,
  'owner',pg_temp.cyd_owner_name(relation.relowner),
  'data_type',format_type(sequence.seqtypid,NULL),
  'start_value',sequence.seqstart::text,
  'minimum_value',sequence.seqmin::text,
  'maximum_value',sequence.seqmax::text,
  'increment_by',sequence.seqincrement::text,
  'cache_size',sequence.seqcache::text,
  'cycle',sequence.seqcycle,
  'persistence',CASE relation.relpersistence WHEN 'p' THEN 'PERMANENT' WHEN 'u' THEN 'UNLOGGED' WHEN 't' THEN 'TEMPORARY' ELSE 'UNSUPPORTED' END,
  'tablespace',tablespace.spcname,
  'owned_table',owned_relation.relname,
  'owned_column',owned_attribute.attname
)::text
FROM pg_class relation
JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace AND namespace.nspname='public'
JOIN pg_sequence sequence ON sequence.seqrelid=relation.oid
LEFT JOIN pg_tablespace tablespace ON tablespace.oid=relation.reltablespace
LEFT JOIN pg_depend ownership ON ownership.classid='pg_class'::regclass AND ownership.objid=relation.oid AND ownership.objsubid=0
  AND ownership.refclassid='pg_class'::regclass AND ownership.deptype IN ('a','i')
LEFT JOIN pg_class owned_relation ON owned_relation.oid=ownership.refobjid
LEFT JOIN pg_attribute owned_attribute ON owned_attribute.attrelid=ownership.refobjid AND owned_attribute.attnum=ownership.refobjsubid
LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_class'::regclass AND extension_member.objid=relation.oid AND extension_member.objsubid=0
WHERE relation.relkind='S' AND extension_member.objid IS NULL
ORDER BY relation.relname;

SELECT 'ROUTINE',jsonb_build_object(
  'identity','public.'||routine.proname||'('||replace(oidvectortypes(routine.proargtypes),', ',',')||')',
  'name',routine.proname,
  'kind',CASE routine.prokind WHEN 'f' THEN 'FUNCTION' WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' WHEN 'w' THEN 'WINDOW' ELSE 'UNSUPPORTED' END,
  'owner',pg_temp.cyd_owner_name(routine.proowner),
  'language',language.lanname,
  'result',pg_get_function_result(routine.oid),
  'security_definer',routine.prosecdef,
  'leakproof',routine.proleakproof,
  'volatility',CASE routine.provolatile WHEN 'i' THEN 'IMMUTABLE' WHEN 's' THEN 'STABLE' WHEN 'v' THEN 'VOLATILE' ELSE 'UNSUPPORTED' END,
  'parallel',CASE routine.proparallel WHEN 's' THEN 'SAFE' WHEN 'r' THEN 'RESTRICTED' WHEN 'u' THEN 'UNSAFE' ELSE 'UNSUPPORTED' END,
  'strict',routine.proisstrict,
  'returns_set',routine.proretset,
  'configuration',CASE
    WHEN routine.proconfig IS NULL THEN '[]'::jsonb
    WHEN routine.proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']::text[] THEN to_jsonb(routine.proconfig)
    ELSE '["UNSUPPORTED"]'::jsonb
  END,
  'extension',extension_member.extension_name,
  'definition_sha256',pg_temp.cyd_sha256(pg_get_functiondef(routine.oid))
)::text
FROM pg_proc routine
JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace AND namespace.nspname='public'
JOIN pg_language language ON language.oid=routine.prolang
LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_proc'::regclass AND extension_member.objid=routine.oid AND extension_member.objsubid=0
ORDER BY routine.proname,oidvectortypes(routine.proargtypes);

SELECT 'TYPE',jsonb_build_object(
  'identity','public.'||type.typname,
  'name',type.typname,
  'kind',CASE type.typtype WHEN 'b' THEN 'BASE' WHEN 'c' THEN 'COMPOSITE' WHEN 'd' THEN 'DOMAIN' WHEN 'e' THEN 'ENUM' WHEN 'm' THEN 'MULTIRANGE' WHEN 'r' THEN 'RANGE' WHEN 'p' THEN 'PSEUDO' ELSE 'UNSUPPORTED' END,
  'owner',pg_temp.cyd_owner_name(type.typowner),
  'extension',extension_member.extension_name,
  'category',type.typcategory,
  'preferred',type.typispreferred,
  'collatable',type.typcollation<>0,
  'passed_by_value',type.typbyval,
  'alignment',type.typalign,
  'storage',type.typstorage
)::text
FROM pg_type type
JOIN pg_namespace namespace ON namespace.oid=type.typnamespace AND namespace.nspname='public'
LEFT JOIN pg_class relation ON relation.oid=type.typrelid
LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_type'::regclass AND extension_member.objid=type.oid AND extension_member.objsubid=0
WHERE ((type.typtype='b' AND type.typelem=0) OR type.typtype IN ('d','e','r','m') OR (type.typtype='c' AND type.typrelid<>0 AND relation.relkind='c'))
ORDER BY type.typname;

SELECT 'EXTENSION',jsonb_build_object(
  'name',extension.extname,
  'version',extension.extversion,
  'schema',namespace.nspname,
  'owner',pg_temp.cyd_owner_name(extension.extowner),
  'member_count',(SELECT count(*)::integer FROM pg_depend dependency WHERE dependency.refclassid='pg_extension'::regclass AND dependency.refobjid=extension.oid AND dependency.deptype='e'),
  'member_fingerprint',pg_temp.cyd_sha256(coalesce((
    SELECT string_agg(format('%s:%s:%s:%s',address.type,to_jsonb(address.object_names)::text,to_jsonb(address.object_args)::text,
      CASE dependency.classid
        WHEN 'pg_proc'::regclass THEN (SELECT concat_ws('|',pg_temp.cyd_owner_name(routine.proowner),pg_get_functiondef(routine.oid)) FROM pg_proc routine WHERE routine.oid=dependency.objid)
        WHEN 'pg_type'::regclass THEN (SELECT concat_ws('|',pg_temp.cyd_owner_name(type.typowner),type.typtype,type.typcategory,type.typispreferred,type.typisdefined,type.typdelim,type.typlen,type.typbyval,type.typalign,type.typstorage,type.typnotnull,pg_temp.cyd_object_identity('pg_type'::regclass,type.typbasetype),type.typtypmod,type.typndims,pg_temp.cyd_object_identity('pg_collation'::regclass,type.typcollation),pg_temp.cyd_object_identity('pg_proc'::regclass,type.typsubscript),pg_temp.cyd_object_identity('pg_type'::regclass,type.typelem),pg_temp.cyd_object_identity('pg_type'::regclass,type.typarray),pg_temp.cyd_object_identity('pg_proc'::regclass,type.typinput),pg_temp.cyd_object_identity('pg_proc'::regclass,type.typoutput),pg_temp.cyd_object_identity('pg_proc'::regclass,type.typreceive),pg_temp.cyd_object_identity('pg_proc'::regclass,type.typsend),pg_temp.cyd_object_identity('pg_proc'::regclass,type.typmodin),pg_temp.cyd_object_identity('pg_proc'::regclass,type.typmodout),pg_temp.cyd_object_identity('pg_proc'::regclass,type.typanalyze),type.typdefaultbin,type.typdefault) FROM pg_type type WHERE type.oid=dependency.objid)
        WHEN 'pg_operator'::regclass THEN (SELECT concat_ws('|',pg_temp.cyd_owner_name(operator.oprowner),operator.oprkind,operator.oprcanmerge,operator.oprcanhash,pg_temp.cyd_object_identity('pg_type'::regclass,operator.oprleft),pg_temp.cyd_object_identity('pg_type'::regclass,operator.oprright),pg_temp.cyd_object_identity('pg_type'::regclass,operator.oprresult),pg_temp.cyd_object_identity('pg_operator'::regclass,operator.oprcom),pg_temp.cyd_object_identity('pg_operator'::regclass,operator.oprnegate),pg_temp.cyd_object_identity('pg_proc'::regclass,operator.oprcode),pg_temp.cyd_object_identity('pg_proc'::regclass,operator.oprrest),pg_temp.cyd_object_identity('pg_proc'::regclass,operator.oprjoin)) FROM pg_operator operator WHERE operator.oid=dependency.objid)
        WHEN 'pg_opclass'::regclass THEN (SELECT concat_ws('|',pg_temp.cyd_owner_name(operator_class.opcowner),pg_temp.cyd_object_identity('pg_am'::regclass,operator_class.opcmethod),pg_temp.cyd_object_identity('pg_type'::regclass,operator_class.opcintype),operator_class.opcdefault,pg_temp.cyd_object_identity('pg_type'::regclass,operator_class.opckeytype),pg_temp.cyd_object_identity('pg_opfamily'::regclass,operator_class.opcfamily),coalesce((SELECT string_agg(concat_ws('|','amop',operator_member.amopstrategy,operator_member.amoppurpose,pg_temp.cyd_object_identity('pg_type'::regclass,operator_member.amoplefttype),pg_temp.cyd_object_identity('pg_type'::regclass,operator_member.amoprighttype),pg_temp.cyd_object_identity('pg_am'::regclass,operator_member.amopmethod),pg_temp.cyd_object_identity('pg_operator'::regclass,operator_member.amopopr),pg_temp.cyd_object_identity('pg_opfamily'::regclass,operator_member.amopsortfamily)),E'\n' ORDER BY operator_member.amopstrategy,operator_member.amoppurpose,pg_temp.cyd_object_identity('pg_type'::regclass,operator_member.amoplefttype),pg_temp.cyd_object_identity('pg_type'::regclass,operator_member.amoprighttype),pg_temp.cyd_object_identity('pg_operator'::regclass,operator_member.amopopr)) FROM pg_amop operator_member WHERE operator_member.amopfamily=operator_class.opcfamily),''),coalesce((SELECT string_agg(concat_ws('|','amproc',pg_temp.cyd_object_identity('pg_type'::regclass,procedure_member.amproclefttype),pg_temp.cyd_object_identity('pg_type'::regclass,procedure_member.amprocrighttype),procedure_member.amprocnum,pg_temp.cyd_object_identity('pg_proc'::regclass,procedure_member.amproc)),E'\n' ORDER BY pg_temp.cyd_object_identity('pg_type'::regclass,procedure_member.amproclefttype),pg_temp.cyd_object_identity('pg_type'::regclass,procedure_member.amprocrighttype),procedure_member.amprocnum,pg_temp.cyd_object_identity('pg_proc'::regclass,procedure_member.amproc)) FROM pg_amproc procedure_member WHERE procedure_member.amprocfamily=operator_class.opcfamily),'')) FROM pg_opclass operator_class WHERE operator_class.oid=dependency.objid)
        WHEN 'pg_opfamily'::regclass THEN (SELECT concat_ws('|',pg_temp.cyd_owner_name(operator_family.opfowner),pg_temp.cyd_object_identity('pg_am'::regclass,operator_family.opfmethod),coalesce((SELECT string_agg(concat_ws('|','amop',operator_member.amopstrategy,operator_member.amoppurpose,pg_temp.cyd_object_identity('pg_type'::regclass,operator_member.amoplefttype),pg_temp.cyd_object_identity('pg_type'::regclass,operator_member.amoprighttype),pg_temp.cyd_object_identity('pg_am'::regclass,operator_member.amopmethod),pg_temp.cyd_object_identity('pg_operator'::regclass,operator_member.amopopr),pg_temp.cyd_object_identity('pg_opfamily'::regclass,operator_member.amopsortfamily)),E'\n' ORDER BY operator_member.amopstrategy,operator_member.amoppurpose,pg_temp.cyd_object_identity('pg_type'::regclass,operator_member.amoplefttype),pg_temp.cyd_object_identity('pg_type'::regclass,operator_member.amoprighttype),pg_temp.cyd_object_identity('pg_operator'::regclass,operator_member.amopopr)) FROM pg_amop operator_member WHERE operator_member.amopfamily=operator_family.oid),''),coalesce((SELECT string_agg(concat_ws('|','amproc',pg_temp.cyd_object_identity('pg_type'::regclass,procedure_member.amproclefttype),pg_temp.cyd_object_identity('pg_type'::regclass,procedure_member.amprocrighttype),procedure_member.amprocnum,pg_temp.cyd_object_identity('pg_proc'::regclass,procedure_member.amproc)),E'\n' ORDER BY pg_temp.cyd_object_identity('pg_type'::regclass,procedure_member.amproclefttype),pg_temp.cyd_object_identity('pg_type'::regclass,procedure_member.amprocrighttype),procedure_member.amprocnum,pg_temp.cyd_object_identity('pg_proc'::regclass,procedure_member.amproc)) FROM pg_amproc procedure_member WHERE procedure_member.amprocfamily=operator_family.oid),'')) FROM pg_opfamily operator_family WHERE operator_family.oid=dependency.objid)
        WHEN 'pg_language'::regclass THEN (SELECT concat_ws('|',pg_temp.cyd_owner_name(language.lanowner),language.lanispl,language.lanpltrusted,pg_temp.cyd_object_identity('pg_proc'::regclass,language.lanplcallfoid),pg_temp.cyd_object_identity('pg_proc'::regclass,language.laninline),pg_temp.cyd_object_identity('pg_proc'::regclass,language.lanvalidator)) FROM pg_language language WHERE language.oid=dependency.objid)
        ELSE 'UNSUPPORTED_EXTENSION_MEMBER_CLASS'
      END),E'\n'
      ORDER BY address.type,to_jsonb(address.object_names)::text,to_jsonb(address.object_args)::text)
    FROM pg_depend dependency
    CROSS JOIN LATERAL pg_identify_object_as_address(dependency.classid,dependency.objid,dependency.objsubid) address
    WHERE dependency.refclassid='pg_extension'::regclass AND dependency.refobjid=extension.oid AND dependency.deptype='e'
  ),''))
)::text
FROM pg_extension extension
JOIN pg_namespace namespace ON namespace.oid=extension.extnamespace
ORDER BY extension.extname;

SELECT 'COLUMN',jsonb_build_object(
  'table',relation.relname,
  'ordinal',attribute.attnum,
  'name',attribute.attname,
  'data_type',format_type(attribute.atttypid,attribute.atttypmod),
  'not_null',attribute.attnotnull,
  'identity',nullif(attribute.attidentity::text,''),
  'generated',nullif(attribute.attgenerated::text,''),
  'collation',CASE WHEN attribute.attcollation=0 THEN NULL ELSE collation_namespace.nspname||'.'||collation_record.collname END,
  'storage',attribute.attstorage::text,
  'compression',nullif(attribute.attcompression::text,''),
  'statistics_target',attribute.attstattarget,
  'default_expression',pg_get_expr(attribute_default.adbin,attribute_default.adrelid,true)
)::text
FROM pg_attribute attribute
JOIN pg_class relation ON relation.oid=attribute.attrelid
JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace AND namespace.nspname='public'
LEFT JOIN pg_attrdef attribute_default ON attribute_default.adrelid=attribute.attrelid AND attribute_default.adnum=attribute.attnum
LEFT JOIN pg_collation collation_record ON collation_record.oid=attribute.attcollation
LEFT JOIN pg_namespace collation_namespace ON collation_namespace.oid=collation_record.collnamespace
LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_class'::regclass AND extension_member.objid=relation.oid AND extension_member.objsubid=0
WHERE relation.relkind IN ('r','p','v','m','f') AND attribute.attnum>0 AND NOT attribute.attisdropped AND extension_member.objid IS NULL
ORDER BY relation.relname,attribute.attnum;

SELECT 'CONSTRAINT',jsonb_build_object(
  'table',relation.relname,
  'name',constraint_record.conname,
  'kind',constraint_record.contype,
  'deferrable',constraint_record.condeferrable,
  'initially_deferred',constraint_record.condeferred,
  'validated',constraint_record.convalidated,
  'no_inherit',constraint_record.connoinherit,
  'parent_constraint',parent_constraint.conname,
  'definition',pg_get_constraintdef(constraint_record.oid,true)
)::text
FROM pg_constraint constraint_record
JOIN pg_class relation ON relation.oid=constraint_record.conrelid
JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace AND namespace.nspname='public'
LEFT JOIN pg_constraint parent_constraint ON parent_constraint.oid=constraint_record.conparentid
LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_constraint'::regclass AND extension_member.objid=constraint_record.oid AND extension_member.objsubid=0
WHERE extension_member.objid IS NULL
ORDER BY relation.relname,constraint_record.conname;

SELECT 'INDEX',jsonb_build_object(
  'table',relation.relname,
  'name',index_relation.relname,
  'owner',pg_temp.cyd_owner_name(index_relation.relowner),
  'access_method',access_method.amname,
  'unique',index_record.indisunique,
  'primary',index_record.indisprimary,
  'valid',index_record.indisvalid,
  'ready',index_record.indisready,
  'live',index_record.indislive,
  'replica_identity',index_record.indisreplident,
  'clustered',index_record.indisclustered,
  'immediate',index_record.indimmediate,
  'exclusion',index_record.indisexclusion,
  'tablespace',tablespace.spcname,
  'definition',pg_get_indexdef(index_record.indexrelid)
)::text
FROM pg_index index_record
JOIN pg_class index_relation ON index_relation.oid=index_record.indexrelid
JOIN pg_class relation ON relation.oid=index_record.indrelid
JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace AND namespace.nspname='public'
JOIN pg_am access_method ON access_method.oid=index_relation.relam
LEFT JOIN pg_tablespace tablespace ON tablespace.oid=index_relation.reltablespace
LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_class'::regclass AND extension_member.objid=index_relation.oid AND extension_member.objsubid=0
WHERE extension_member.objid IS NULL
ORDER BY relation.relname,index_relation.relname;

SELECT 'TRIGGER',jsonb_build_object(
  'table',relation.relname,
  'name',trigger_record.tgname,
  'enabled',trigger_record.tgenabled,
  'deferrable',trigger_record.tgdeferrable,
  'initially_deferred',trigger_record.tginitdeferred,
  'function_identity','public.'||routine.proname||'('||replace(oidvectortypes(routine.proargtypes),', ',',')||')',
  'definition',pg_get_triggerdef(trigger_record.oid,true)
)::text
FROM pg_trigger trigger_record
JOIN pg_class relation ON relation.oid=trigger_record.tgrelid
JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace AND namespace.nspname='public'
JOIN pg_proc routine ON routine.oid=trigger_record.tgfoid
LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_trigger'::regclass AND extension_member.objid=trigger_record.oid AND extension_member.objsubid=0
WHERE NOT trigger_record.tgisinternal AND extension_member.objid IS NULL
ORDER BY relation.relname,trigger_record.tgname;

SELECT 'UNSUPPORTED',jsonb_build_object(
  'unexpected_schema_count',(SELECT count(*)::integer FROM pg_namespace namespace WHERE namespace.nspname NOT IN ('public','information_schema') AND namespace.nspname NOT LIKE 'pg\_%' ESCAPE '\'),
  'unsupported_relation_count',(SELECT count(*)::integer FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_class'::regclass AND extension_member.objid=relation.oid AND extension_member.objsubid=0 WHERE namespace.nspname='public' AND relation.relkind NOT IN ('r','S','i','I','t') AND extension_member.objid IS NULL),
  'partition_count',(SELECT count(*)::integer FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='public' AND relation.relispartition),
  'row_security_relation_count',(SELECT count(*)::integer FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='public' AND (relation.relrowsecurity OR relation.relforcerowsecurity)),
  'policy_count',(SELECT count(*)::integer FROM pg_policy policy JOIN pg_class relation ON relation.oid=policy.polrelid JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='public'),
  'large_object_count',(SELECT count(*)::integer FROM pg_largeobject_metadata),
  'publication_count',(SELECT count(*)::integer FROM pg_publication),
  'subscription_count',(SELECT count(*)::integer FROM pg_subscription),
  'event_trigger_count',(SELECT count(*)::integer FROM pg_event_trigger),
  'foreign_data_wrapper_count',(SELECT count(*)::integer FROM pg_foreign_data_wrapper),
  'foreign_server_count',(SELECT count(*)::integer FROM pg_foreign_server),
  'user_mapping_count',(SELECT count(*)::integer FROM pg_user_mapping),
  'application_collation_count',(SELECT count(*)::integer FROM pg_collation collation_record JOIN pg_namespace namespace ON namespace.oid=collation_record.collnamespace LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_collation'::regclass AND extension_member.objid=collation_record.oid AND extension_member.objsubid=0 WHERE namespace.nspname='public' AND extension_member.objid IS NULL),
  'application_conversion_count',(SELECT count(*)::integer FROM pg_conversion conversion JOIN pg_namespace namespace ON namespace.oid=conversion.connamespace LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_conversion'::regclass AND extension_member.objid=conversion.oid AND extension_member.objsubid=0 WHERE namespace.nspname='public' AND extension_member.objid IS NULL),
  'application_operator_count',(SELECT count(*)::integer FROM pg_operator operator JOIN pg_namespace namespace ON namespace.oid=operator.oprnamespace LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_operator'::regclass AND extension_member.objid=operator.oid AND extension_member.objsubid=0 WHERE namespace.nspname='public' AND extension_member.objid IS NULL),
  'application_operator_class_count',(SELECT count(*)::integer FROM pg_opclass operator_class JOIN pg_namespace namespace ON namespace.oid=operator_class.opcnamespace LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_opclass'::regclass AND extension_member.objid=operator_class.oid AND extension_member.objsubid=0 WHERE namespace.nspname='public' AND extension_member.objid IS NULL),
  'application_operator_family_count',(SELECT count(*)::integer FROM pg_opfamily operator_family JOIN pg_namespace namespace ON namespace.oid=operator_family.opfnamespace LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_opfamily'::regclass AND extension_member.objid=operator_family.oid AND extension_member.objsubid=0 WHERE namespace.nspname='public' AND extension_member.objid IS NULL),
  'application_statistics_count',(SELECT count(*)::integer FROM pg_statistic_ext statistic JOIN pg_namespace namespace ON namespace.oid=statistic.stxnamespace LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_statistic_ext'::regclass AND extension_member.objid=statistic.oid AND extension_member.objsubid=0 WHERE namespace.nspname='public' AND extension_member.objid IS NULL),
  'column_acl_count',(SELECT count(*)::integer FROM pg_attribute attribute JOIN pg_class relation ON relation.oid=attribute.attrelid JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='public' AND attribute.attnum>0 AND NOT attribute.attisdropped AND attribute.attacl IS NOT NULL),
  'default_privilege_count',(SELECT count(*)::integer FROM pg_default_acl),
  'custom_tablespace_count',(SELECT count(*)::integer FROM pg_tablespace WHERE spcname NOT IN ('pg_default','pg_global')),
  'parameter_acl_count',(SELECT count(*)::integer FROM pg_parameter_acl),
  'user_rule_count',(SELECT count(*)::integer FROM pg_rewrite rewrite_record JOIN pg_class relation ON relation.oid=rewrite_record.ev_class JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='public' AND NOT (relation.relkind IN ('v','m') AND rewrite_record.rulename='_RETURN' AND rewrite_record.ev_type='1' AND rewrite_record.is_instead)),
  'access_method_count',(SELECT count(*)::integer FROM pg_am access_method LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_am'::regclass AND extension_member.objid=access_method.oid AND extension_member.objsubid=0 WHERE access_method.oid>=16384 AND extension_member.objid IS NULL),
  'cast_count',(SELECT count(*)::integer FROM pg_cast cast_record LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_cast'::regclass AND extension_member.objid=cast_record.oid AND extension_member.objsubid=0 WHERE cast_record.oid>=16384 AND extension_member.objid IS NULL),
  'replication_origin_count',(SELECT count(*)::integer FROM pg_replication_origin),
  'security_label_count',((SELECT count(*)::integer FROM pg_seclabel)+(SELECT count(*)::integer FROM pg_shseclabel)),
  'text_search_object_count',(
    (SELECT count(*)::integer FROM pg_ts_config object JOIN pg_namespace namespace ON namespace.oid=object.cfgnamespace LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_ts_config'::regclass AND extension_member.objid=object.oid AND extension_member.objsubid=0 WHERE namespace.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND namespace.nspname<>'information_schema' AND extension_member.objid IS NULL)+
    (SELECT count(*)::integer FROM pg_ts_dict object JOIN pg_namespace namespace ON namespace.oid=object.dictnamespace LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_ts_dict'::regclass AND extension_member.objid=object.oid AND extension_member.objsubid=0 WHERE namespace.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND namespace.nspname<>'information_schema' AND extension_member.objid IS NULL)+
    (SELECT count(*)::integer FROM pg_ts_parser object JOIN pg_namespace namespace ON namespace.oid=object.prsnamespace LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_ts_parser'::regclass AND extension_member.objid=object.oid AND extension_member.objsubid=0 WHERE namespace.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND namespace.nspname<>'information_schema' AND extension_member.objid IS NULL)+
    (SELECT count(*)::integer FROM pg_ts_template object JOIN pg_namespace namespace ON namespace.oid=object.tmplnamespace LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_ts_template'::regclass AND extension_member.objid=object.oid AND extension_member.objsubid=0 WHERE namespace.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND namespace.nspname<>'information_schema' AND extension_member.objid IS NULL)
  ),
  'transform_count',(SELECT count(*)::integer FROM pg_transform transform_record LEFT JOIN cyd_extension_members extension_member ON extension_member.classid='pg_transform'::regclass AND extension_member.objid=transform_record.oid AND extension_member.objsubid=0 WHERE extension_member.objid IS NULL),
  'unapproved_language_count',(SELECT count(*)::integer FROM pg_language language WHERE language.lanname NOT IN ('internal','c','sql','plpgsql'))
  ,'unsupported_extension_member_class_count',(SELECT count(*)::integer FROM pg_depend dependency WHERE dependency.refclassid='pg_extension'::regclass AND dependency.deptype='e' AND dependency.classid NOT IN ('pg_proc'::regclass,'pg_type'::regclass,'pg_operator'::regclass,'pg_opclass'::regclass,'pg_opfamily'::regclass,'pg_language'::regclass))
)::text;

COMMIT;
