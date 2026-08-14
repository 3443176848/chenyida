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
  \echo 'expected_database is required'
  \quit 3
\endif
\if :{?migration_owner}
\else
  \echo 'migration_owner is required'
  \quit 3
\endif
\if :{?expected_marker}
\else
  \echo 'expected_marker is required'
  \quit 3
\endif
\if :{?expected_system_identifier}
\else
  \echo 'expected_system_identifier is required'
  \quit 3
\endif

\if :{?controlled_runtime_mode}
  SELECT (
    current_database()=:'expected_database'
    AND shobj_description(database.oid,'pg_database')=:'expected_marker'
    AND control.system_identifier::text=:'expected_system_identifier'
    AND current_user=session_user
    AND EXISTS (SELECT 1 FROM pg_roles role WHERE role.rolname=current_user AND role.rolsuper)
    AND current_setting('server_version_num')='170010'
    AND current_setting('default_transaction_read_only')='off'
    AND NOT EXISTS (
      SELECT 1 FROM pg_db_role_setting setting
      CROSS JOIN LATERAL unnest(setting.setconfig) item
      WHERE (setting.setrole=0 OR setting.setrole IN (SELECT oid FROM pg_roles WHERE rolname LIKE 'chenyida\_erp\_%' ESCAPE '\'))
        AND (setting.setdatabase=0 OR setting.setdatabase=database.oid)
        AND item='default_transaction_read_only=on'
    )
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
    \echo 'RUNTIME_PRIVILEGE_STATE_CONTROLLED_TARGET_INVALID'
    \quit 3
  \endif
\else
  SELECT (
    current_database()=:'expected_database'
    AND shobj_description(database.oid,'pg_database')=:'expected_marker'
    AND control.system_identifier::text=:'expected_system_identifier'
    AND current_user=session_user
    AND current_user='postgres'
    AND current_setting('server_version_num')='170010'
    AND current_setting('default_transaction_read_only')='off'
    AND NOT EXISTS (
      SELECT 1 FROM pg_db_role_setting setting
      CROSS JOIN LATERAL unnest(setting.setconfig) item
      WHERE (setting.setrole=0 OR setting.setrole IN (SELECT oid FROM pg_roles WHERE rolname LIKE 'chenyida\_erp\_%' ESCAPE '\'))
        AND (setting.setdatabase=0 OR setting.setdatabase=database.oid)
        AND item='default_transaction_read_only=on'
    )
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
    \echo 'RUNTIME_PRIVILEGE_STATE_SYNTHETIC_TARGET_INVALID'
    \quit 3
  \endif
\endif

CREATE TEMP TABLE cyd_runtime_role_semantics ON COMMIT PRESERVE ROWS AS
SELECT role.oid AS role_oid,:'migration_owner'::text AS semantic_name
FROM pg_roles role
WHERE role.rolname=:'migration_owner';

CREATE OR REPLACE FUNCTION pg_temp.cyd_runtime_role_name(role_oid oid)
RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE coalesce(
    (SELECT semantic_name FROM pg_temp.cyd_runtime_role_semantics WHERE cyd_runtime_role_semantics.role_oid=cyd_runtime_role_name.role_oid),
    CASE
      WHEN pg_get_userbyid(role_oid)=current_user THEN 'PLATFORM_OWNER'
      WHEN pg_get_userbyid(role_oid)='pg_database_owner' THEN 'pg_database_owner'
      ELSE pg_get_userbyid(role_oid)
    END
  ) END
$$;

CREATE OR REPLACE FUNCTION pg_temp.cyd_runtime_sha256(value text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT encode(sha256(convert_to(value,'UTF8')),'hex') $$;

SET default_transaction_read_only = on;
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;

WITH
managed_roles AS (
  SELECT role.oid,role.rolname,role.rolsuper,role.rolinherit,role.rolcreaterole,role.rolcreatedb,
    role.rolcanlogin,role.rolreplication,role.rolconnlimit,role.rolvaliduntil,role.rolbypassrls
  FROM pg_roles role
  WHERE role.rolname LIKE 'chenyida\_erp\_%' ESCAPE '\'
),
role_records AS (
  SELECT jsonb_build_object(
    'name',role.rolname,
    'superuser',role.rolsuper,
    'inherit',role.rolinherit,
    'create_role',role.rolcreaterole,
    'create_database',role.rolcreatedb,
    'can_login',role.rolcanlogin,
    'replication',role.rolreplication,
    'connection_limit',role.rolconnlimit,
    'valid_until',CASE WHEN role.rolvaliduntil IS NULL THEN NULL ELSE to_char(role.rolvaliduntil AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'bypass_rls',role.rolbypassrls
  ) AS record,role.rolname AS sort_key
  FROM managed_roles role
),
membership_records AS (
  SELECT jsonb_build_object(
    'role',granted.rolname,
    'member',member.rolname,
    'grantor',pg_temp.cyd_runtime_role_name(membership.grantor),
    'admin_option',membership.admin_option,
    'inherit_option',membership.inherit_option,
    'set_option',membership.set_option
  ) AS record,granted.rolname||chr(1)||member.rolname||chr(1)||pg_temp.cyd_runtime_role_name(membership.grantor) AS sort_key
  FROM pg_auth_members membership
  JOIN pg_roles granted ON granted.oid=membership.roleid
  JOIN pg_roles member ON member.oid=membership.member
  WHERE granted.rolname LIKE 'chenyida\_erp\_%' ESCAPE '\' OR member.rolname LIKE 'chenyida\_erp\_%' ESCAPE '\'
),
setting_records AS (
  SELECT jsonb_build_object(
    'role_scope',CASE WHEN setting.setrole=0 THEN 'ALL' ELSE role.rolname END,
    'database_scope',CASE WHEN setting.setdatabase=0 THEN 'ALL' ELSE database.datname END,
    'settings',to_jsonb(ARRAY(SELECT item FROM unnest(setting.setconfig) item ORDER BY item COLLATE "C"))
  ) AS record,
  coalesce(role.rolname,'ALL')||chr(1)||coalesce(database.datname,'ALL') AS sort_key
  FROM pg_db_role_setting setting
  LEFT JOIN pg_roles role ON role.oid=setting.setrole
  LEFT JOIN pg_database database ON database.oid=setting.setdatabase
  WHERE setting.setrole=0 OR role.rolname LIKE 'chenyida\_erp\_%' ESCAPE '\' OR setting.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())
),
object_acl_records AS (
  SELECT 'DATABASE'::text AS kind,database.datname::text AS identity,pg_temp.cyd_runtime_role_name(database.datdba) AS owner,
    pg_temp.cyd_runtime_role_name(privilege.grantor) AS grantor,pg_temp.cyd_runtime_role_name(privilege.grantee) AS grantee,
    privilege.privilege_type,privilege.is_grantable
  FROM pg_database database
  CROSS JOIN LATERAL aclexplode(coalesce(database.datacl,acldefault('d',database.datdba))) privilege
  WHERE database.datname=current_database() AND privilege.grantee<>database.datdba
  UNION ALL
  SELECT 'SCHEMA',namespace.nspname,pg_temp.cyd_runtime_role_name(namespace.nspowner),
    pg_temp.cyd_runtime_role_name(privilege.grantor),pg_temp.cyd_runtime_role_name(privilege.grantee),privilege.privilege_type,privilege.is_grantable
  FROM pg_namespace namespace
  CROSS JOIN LATERAL aclexplode(coalesce(namespace.nspacl,acldefault('n',namespace.nspowner))) privilege
  WHERE namespace.nspname='public' AND privilege.grantee<>namespace.nspowner
  UNION ALL
  SELECT 'TABLE','public.'||relation.relname,pg_temp.cyd_runtime_role_name(relation.relowner),
    pg_temp.cyd_runtime_role_name(privilege.grantor),pg_temp.cyd_runtime_role_name(privilege.grantee),privilege.privilege_type,privilege.is_grantable
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace AND namespace.nspname='public'
  CROSS JOIN LATERAL aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) privilege
  WHERE relation.relkind='r' AND privilege.grantee<>relation.relowner
  UNION ALL
  SELECT 'SEQUENCE','public.'||relation.relname,pg_temp.cyd_runtime_role_name(relation.relowner),
    pg_temp.cyd_runtime_role_name(privilege.grantor),pg_temp.cyd_runtime_role_name(privilege.grantee),privilege.privilege_type,privilege.is_grantable
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace AND namespace.nspname='public'
  CROSS JOIN LATERAL aclexplode(coalesce(relation.relacl,acldefault('S',relation.relowner))) privilege
  WHERE relation.relkind='S' AND privilege.grantee<>relation.relowner
  UNION ALL
  SELECT 'ROUTINE','public.'||routine.proname||'('||replace(oidvectortypes(routine.proargtypes),', ',',')||')',pg_temp.cyd_runtime_role_name(routine.proowner),
    pg_temp.cyd_runtime_role_name(privilege.grantor),pg_temp.cyd_runtime_role_name(privilege.grantee),privilege.privilege_type,privilege.is_grantable
  FROM pg_proc routine
  JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace AND namespace.nspname='public'
  CROSS JOIN LATERAL aclexplode(coalesce(routine.proacl,acldefault('f',routine.proowner))) privilege
  WHERE privilege.grantee<>routine.proowner
  UNION ALL
  SELECT 'TYPE','public.'||type.typname,pg_temp.cyd_runtime_role_name(type.typowner),
    pg_temp.cyd_runtime_role_name(privilege.grantor),pg_temp.cyd_runtime_role_name(privilege.grantee),privilege.privilege_type,privilege.is_grantable
  FROM pg_type type
  JOIN pg_namespace namespace ON namespace.oid=type.typnamespace AND namespace.nspname='public'
  LEFT JOIN pg_class relation ON relation.oid=type.typrelid
  CROSS JOIN LATERAL aclexplode(coalesce(type.typacl,acldefault('T',type.typowner))) privilege
  WHERE ((type.typtype='b' AND type.typelem=0) OR type.typtype IN ('d','e','r','m') OR (type.typtype='c' AND type.typrelid<>0 AND relation.relkind='c'))
    AND privilege.grantee<>type.typowner
  UNION ALL
  SELECT 'TABLESPACE',tablespace.spcname,pg_temp.cyd_runtime_role_name(tablespace.spcowner),
    pg_temp.cyd_runtime_role_name(privilege.grantor),pg_temp.cyd_runtime_role_name(privilege.grantee),privilege.privilege_type,privilege.is_grantable
  FROM pg_tablespace tablespace
  CROSS JOIN LATERAL aclexplode(coalesce(tablespace.spcacl,acldefault('t',tablespace.spcowner))) privilege
  WHERE privilege.grantee<>tablespace.spcowner
  UNION ALL
  SELECT 'LARGE_OBJECT',large_object.oid::text,pg_temp.cyd_runtime_role_name(large_object.lomowner),
    pg_temp.cyd_runtime_role_name(privilege.grantor),pg_temp.cyd_runtime_role_name(privilege.grantee),privilege.privilege_type,privilege.is_grantable
  FROM pg_largeobject_metadata large_object
  CROSS JOIN LATERAL aclexplode(coalesce(large_object.lomacl,acldefault('L',large_object.lomowner))) privilege
  WHERE privilege.grantee<>large_object.lomowner
),
object_acl_json AS (
  SELECT jsonb_build_object(
    'kind',acl.kind,'identity',acl.identity,'owner',acl.owner,'grantor',acl.grantor,'grantee',acl.grantee,
    'privilege_type',acl.privilege_type,'is_grantable',acl.is_grantable
  ) AS record,acl.kind||chr(1)||acl.identity||chr(1)||acl.grantee||chr(1)||acl.privilege_type||chr(1)||acl.grantor AS sort_key
  FROM object_acl_records acl
),
object_acl_storage_sources AS (
  SELECT 'DATABASE'::text AS kind,database.datname::text AS identity,database.datdba AS owner_oid,database.datacl AS acl,'d'::"char" AS acl_kind
  FROM pg_database database WHERE database.datname=current_database()
  UNION ALL
  SELECT 'SCHEMA',namespace.nspname,namespace.nspowner,namespace.nspacl,'n'::"char"
  FROM pg_namespace namespace WHERE namespace.nspname='public'
  UNION ALL
  SELECT 'TABLE','public.'||relation.relname,relation.relowner,relation.relacl,'r'::"char"
  FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace AND namespace.nspname='public'
  WHERE relation.relkind='r'
  UNION ALL
  SELECT 'SEQUENCE','public.'||relation.relname,relation.relowner,relation.relacl,'S'::"char"
  FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace AND namespace.nspname='public'
  WHERE relation.relkind='S'
  UNION ALL
  SELECT 'ROUTINE','public.'||routine.proname||'('||replace(oidvectortypes(routine.proargtypes),', ',',')||')',routine.proowner,routine.proacl,'f'::"char"
  FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace AND namespace.nspname='public'
  UNION ALL
  SELECT 'TYPE','public.'||type.typname,type.typowner,type.typacl,'T'::"char"
  FROM pg_type type
  JOIN pg_namespace namespace ON namespace.oid=type.typnamespace AND namespace.nspname='public'
  LEFT JOIN pg_class relation ON relation.oid=type.typrelid
  WHERE ((type.typtype='b' AND type.typelem=0) OR type.typtype IN ('d','e','r','m') OR (type.typtype='c' AND type.typrelid<>0 AND relation.relkind='c'))
  UNION ALL
  SELECT 'TABLESPACE',tablespace.spcname,tablespace.spcowner,tablespace.spcacl,'t'::"char"
  FROM pg_tablespace tablespace
  UNION ALL
  SELECT 'LARGE_OBJECT',large_object.oid::text,large_object.lomowner,large_object.lomacl,'L'::"char"
  FROM pg_largeobject_metadata large_object
),
object_acl_storage_records AS (
  SELECT jsonb_build_object(
    'kind',source.kind,
    'identity',source.identity,
    'owner',pg_temp.cyd_runtime_role_name(source.owner_oid),
    'acl_state',CASE WHEN source.acl IS NULL THEN 'NULL' WHEN cardinality(source.acl)=0 THEN 'EMPTY' ELSE 'EXPLICIT' END,
    'acl_item_count',cardinality(coalesce(source.acl,acldefault(source.acl_kind,source.owner_oid))),
    'owner_privileges',coalesce((
      SELECT jsonb_agg(jsonb_build_object('privilege_type',privilege.privilege_type,'is_grantable',privilege.is_grantable) ORDER BY privilege.privilege_type COLLATE "C")
      FROM aclexplode(coalesce(source.acl,acldefault(source.acl_kind,source.owner_oid))) privilege
      WHERE privilege.grantee=source.owner_oid
    ),'[]'::jsonb)
  ) AS record,source.kind||chr(1)||source.identity AS sort_key
  FROM object_acl_storage_sources source
),
column_acl_records AS (
  SELECT jsonb_build_object(
    'kind','COLUMN','identity','public.'||relation.relname||'.'||attribute.attname,
    'owner',pg_temp.cyd_runtime_role_name(relation.relowner),
    'grantor',pg_temp.cyd_runtime_role_name(privilege.grantor),
    'grantee',pg_temp.cyd_runtime_role_name(privilege.grantee),
    'privilege_type',privilege.privilege_type,'is_grantable',privilege.is_grantable
  ) AS record,
  relation.relname||chr(1)||attribute.attnum::text||chr(1)||pg_temp.cyd_runtime_role_name(privilege.grantee)||chr(1)||privilege.privilege_type AS sort_key
  FROM pg_attribute attribute
  JOIN pg_class relation ON relation.oid=attribute.attrelid
  JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace AND namespace.nspname='public'
  CROSS JOIN LATERAL aclexplode(attribute.attacl) privilege
  WHERE attribute.attnum>0 AND NOT attribute.attisdropped AND attribute.attacl IS NOT NULL AND privilege.grantee<>relation.relowner
),
default_acl_scopes AS (
  SELECT jsonb_build_object(
    'owner',pg_temp.cyd_runtime_role_name(default_acl.defaclrole),
    'schema',coalesce(namespace.nspname,'ALL'),
    'object_kind',CASE default_acl.defaclobjtype WHEN 'r' THEN 'TABLE' WHEN 'S' THEN 'SEQUENCE' WHEN 'f' THEN 'ROUTINE' WHEN 'T' THEN 'TYPE' WHEN 'n' THEN 'SCHEMA' ELSE 'UNSUPPORTED' END
  ) AS record,
  pg_temp.cyd_runtime_role_name(default_acl.defaclrole)||chr(1)||coalesce(namespace.nspname,'ALL')||chr(1)||CASE default_acl.defaclobjtype WHEN 'r' THEN 'TABLE' WHEN 'S' THEN 'SEQUENCE' WHEN 'f' THEN 'ROUTINE' WHEN 'T' THEN 'TYPE' WHEN 'n' THEN 'SCHEMA' ELSE 'UNSUPPORTED' END AS sort_key
  FROM pg_default_acl default_acl
  LEFT JOIN pg_namespace namespace ON namespace.oid=default_acl.defaclnamespace
),
default_acl_records AS (
  SELECT jsonb_build_object(
    'owner',pg_temp.cyd_runtime_role_name(default_acl.defaclrole),
    'schema',coalesce(namespace.nspname,'ALL'),
    'object_kind',CASE default_acl.defaclobjtype WHEN 'r' THEN 'TABLE' WHEN 'S' THEN 'SEQUENCE' WHEN 'f' THEN 'ROUTINE' WHEN 'T' THEN 'TYPE' WHEN 'n' THEN 'SCHEMA' ELSE 'UNSUPPORTED' END,
    'grantor',pg_temp.cyd_runtime_role_name(privilege.grantor),
    'grantee',pg_temp.cyd_runtime_role_name(privilege.grantee),
    'privilege_type',privilege.privilege_type,
    'is_grantable',privilege.is_grantable
  ) AS record,
  pg_temp.cyd_runtime_role_name(default_acl.defaclrole)||chr(1)||coalesce(namespace.nspname,'ALL')||chr(1)||CASE default_acl.defaclobjtype WHEN 'r' THEN 'TABLE' WHEN 'S' THEN 'SEQUENCE' WHEN 'f' THEN 'ROUTINE' WHEN 'T' THEN 'TYPE' WHEN 'n' THEN 'SCHEMA' ELSE 'UNSUPPORTED' END||chr(1)||pg_temp.cyd_runtime_role_name(privilege.grantee)||chr(1)||privilege.privilege_type AS sort_key
  FROM pg_default_acl default_acl
  LEFT JOIN pg_namespace namespace ON namespace.oid=default_acl.defaclnamespace
  CROSS JOIN LATERAL aclexplode(default_acl.defaclacl) privilege
  WHERE privilege.grantee<>default_acl.defaclrole
),
parameter_acl_records AS (
  SELECT jsonb_build_object(
    'parameter',parameter.parname,
    'grantor',pg_temp.cyd_runtime_role_name(privilege.grantor),
    'grantee',pg_temp.cyd_runtime_role_name(privilege.grantee),
    'privilege_type',privilege.privilege_type,
    'is_grantable',privilege.is_grantable
  ) AS record,
  parameter.parname||chr(1)||pg_temp.cyd_runtime_role_name(privilege.grantee)||chr(1)||privilege.privilege_type||chr(1)||pg_temp.cyd_runtime_role_name(privilege.grantor) AS sort_key
  FROM pg_parameter_acl parameter
  CROSS JOIN LATERAL aclexplode(parameter.paracl) privilege
),
custom_tablespace_records AS (
  SELECT jsonb_build_object(
    'name',tablespace.spcname,
    'owner',pg_temp.cyd_runtime_role_name(tablespace.spcowner),
    'options',to_jsonb(coalesce((SELECT array_agg(option ORDER BY option COLLATE "C") FROM unnest(tablespace.spcoptions) option),ARRAY[]::text[])),
    'location_sha256',pg_temp.cyd_runtime_sha256(pg_tablespace_location(tablespace.oid))
  ) AS record,tablespace.spcname AS sort_key
  FROM pg_tablespace tablespace
  WHERE tablespace.spcname NOT IN ('pg_default','pg_global')
)
SELECT jsonb_build_object(
  'schema_version',2,
  'contract','chenyida-erp-postgresql-runtime-privilege-state/v2',
  'target',(
    SELECT jsonb_build_object(
      'database_oid',database.oid::text,
      'system_identifier_sha256',pg_temp.cyd_runtime_sha256(control.system_identifier::text),
      'marker_sha256',pg_temp.cyd_runtime_sha256(shobj_description(database.oid,'pg_database'))
    )
    FROM pg_database database CROSS JOIN pg_control_system() control WHERE database.datname=current_database()
  ),
  'engine',(
    SELECT jsonb_build_object(
      'server_version_num',current_setting('server_version_num'),
      'encoding',pg_encoding_to_char(database.encoding),
      'locale_provider',CASE database.datlocprovider WHEN 'c' THEN 'libc' WHEN 'i' THEN 'icu' WHEN 'b' THEN 'builtin' ELSE 'unknown' END,
      'collate',database.datcollate,'ctype',database.datctype,'collation_version',database.datcollversion
    )
    FROM pg_database database WHERE database.datname=current_database()
  ),
  'database',(
    SELECT jsonb_build_object(
      'name',database.datname,'owner',pg_temp.cyd_runtime_role_name(database.datdba),
      'allow_connect',database.datallowconn,'connection_limit',database.datconnlimit,
      'default_tablespace',tablespace.spcname
    )
    FROM pg_database database JOIN pg_tablespace tablespace ON tablespace.oid=database.dattablespace
    WHERE database.datname=current_database()
  ),
  'schema',(
    SELECT jsonb_build_object('name',namespace.nspname,'owner',pg_temp.cyd_runtime_role_name(namespace.nspowner))
    FROM pg_namespace namespace WHERE namespace.nspname='public'
  ),
  'roles',coalesce((SELECT jsonb_agg(record ORDER BY sort_key COLLATE "C") FROM role_records),'[]'::jsonb),
  'memberships',coalesce((SELECT jsonb_agg(record ORDER BY sort_key COLLATE "C") FROM membership_records),'[]'::jsonb),
  'role_settings',coalesce((SELECT jsonb_agg(record ORDER BY sort_key COLLATE "C") FROM setting_records),'[]'::jsonb),
  'object_acl',coalesce((SELECT jsonb_agg(record ORDER BY sort_key COLLATE "C") FROM object_acl_json),'[]'::jsonb),
  'object_acl_storage',coalesce((SELECT jsonb_agg(record ORDER BY sort_key COLLATE "C") FROM object_acl_storage_records),'[]'::jsonb),
  'column_acl',coalesce((SELECT jsonb_agg(record ORDER BY sort_key COLLATE "C") FROM column_acl_records),'[]'::jsonb),
  'column_acl_object_count',(
    SELECT count(*)::integer FROM pg_attribute attribute
    JOIN pg_class relation ON relation.oid=attribute.attrelid
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace AND namespace.nspname='public'
    WHERE attribute.attnum>0 AND NOT attribute.attisdropped AND attribute.attacl IS NOT NULL
  ),
  'default_privilege_scopes',coalesce((SELECT jsonb_agg(record ORDER BY sort_key COLLATE "C") FROM default_acl_scopes),'[]'::jsonb),
  'default_privileges',coalesce((SELECT jsonb_agg(record ORDER BY sort_key COLLATE "C") FROM default_acl_records),'[]'::jsonb),
  'default_privilege_row_count',(SELECT count(*)::integer FROM pg_default_acl),
  'parameter_acl',coalesce((SELECT jsonb_agg(record ORDER BY sort_key COLLATE "C") FROM parameter_acl_records),'[]'::jsonb),
  'parameter_acl_row_count',(SELECT count(*)::integer FROM pg_parameter_acl),
  'custom_tablespaces',coalesce((SELECT jsonb_agg(record ORDER BY sort_key COLLATE "C") FROM custom_tablespace_records),'[]'::jsonb),
  'custom_tablespace_count',(SELECT count(*)::integer FROM pg_tablespace WHERE spcname NOT IN ('pg_default','pg_global')),
  'large_object_count',(SELECT count(*)::integer FROM pg_largeobject_metadata)
)::text;

COMMIT;
