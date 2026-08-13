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
\if :{?runtime_login}
\else
  \echo 'runtime_login is required'
  \quit 3
\endif
\if :{?privilege_group}
\else
  \echo 'privilege_group is required'
  \quit 3
\endif
CREATE TEMP TABLE cyd_policy_roles(name text PRIMARY KEY, purpose text NOT NULL) ON COMMIT PRESERVE ROWS;
CREATE TEMP TABLE cyd_extension_members(classid oid NOT NULL,objid oid NOT NULL,objsubid integer NOT NULL,extname text NOT NULL) ON COMMIT PRESERVE ROWS;

CREATE OR REPLACE FUNCTION pg_temp.cyd_role_name(role_oid oid)
RETURNS text
LANGUAGE sql STABLE STRICT PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN role_oid=0 THEN 'PUBLIC'
    WHEN pg_get_userbyid(role_oid)=current_user THEN 'RESTORE_ADMIN'
    ELSE pg_get_userbyid(role_oid)
  END
$$;

CREATE OR REPLACE FUNCTION pg_temp.cyd_acl_state(value aclitem[])
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT CASE WHEN value IS NULL THEN 'NULL' WHEN cardinality(value)=0 THEN 'EMPTY' ELSE 'EXPLICIT' END $$;

CREATE OR REPLACE FUNCTION pg_temp.cyd_acl_json(value aclitem[])
RETURNS jsonb
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'grantor',pg_temp.cyd_role_name(grantor),
    'grantee',pg_temp.cyd_role_name(grantee),
    'privilege_type',privilege_type,
    'is_grantable',is_grantable
  ) ORDER BY pg_temp.cyd_role_name(grantor),pg_temp.cyd_role_name(grantee),privilege_type,is_grantable),'[]'::jsonb)
  FROM aclexplode(value)
$$;

CREATE OR REPLACE FUNCTION pg_temp.cyd_sha256(value text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT encode(sha256(convert_to(value,'UTF8')),'hex') $$;

CREATE TEMP TABLE cyd_objects(
  classid oid NOT NULL,
  objid oid NOT NULL,
  objsubid integer NOT NULL,
  kind text NOT NULL,
  schema_name text,
  object_name text NOT NULL,
  identity_arguments text,
  parent_identity text,
  owner_oid oid NOT NULL,
  tablespace_name text,
  extension_name text,
  acl_state text NOT NULL,
  explicit_privileges jsonb NOT NULL,
  effective_privileges jsonb NOT NULL
) ON COMMIT PRESERVE ROWS;

SET default_transaction_read_only = on;
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;

INSERT INTO cyd_policy_roles VALUES
  (:'migration_owner', 'MIGRATION_OWNER'),
  (:'runtime_login', 'RUNTIME'),
  (:'privilege_group', 'PRIVILEGE_GROUP');

INSERT INTO cyd_extension_members
SELECT d.classid,d.objid,d.objsubid,e.extname
FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
WHERE d.refclassid='pg_extension'::regclass AND d.deptype='e';

INSERT INTO cyd_objects
SELECT 'pg_namespace'::regclass,n.oid,0,'SCHEMA',NULL,n.nspname,NULL,NULL,n.nspowner,NULL,em.extname,
  pg_temp.cyd_acl_state(n.nspacl),
  pg_temp.cyd_acl_json(coalesce(n.nspacl,'{}'::aclitem[])),
  pg_temp.cyd_acl_json(coalesce(n.nspacl,acldefault('n',n.nspowner)))
FROM pg_namespace n
LEFT JOIN cyd_extension_members em ON em.classid='pg_namespace'::regclass AND em.objid=n.oid AND em.objsubid=0
WHERE (n.nspname='public' OR (n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname<>'information_schema' AND em.objid IS NULL));

INSERT INTO cyd_objects
SELECT 'pg_class'::regclass,c.oid,0,
  CASE c.relkind WHEN 'r' THEN 'TABLE' WHEN 'p' THEN 'PARTITIONED_TABLE' WHEN 'v' THEN 'VIEW'
    WHEN 'm' THEN 'MATERIALIZED_VIEW' WHEN 'S' THEN 'SEQUENCE' WHEN 'i' THEN 'INDEX_PLACEMENT'
    WHEN 'I' THEN 'PARTITIONED_INDEX_PLACEMENT' ELSE 'UNSUPPORTED' END,
  n.nspname,c.relname,NULL,
  CASE WHEN c.relkind IN ('i','I') THEN tc.relname ELSE NULL END,
  c.relowner,coalesce(t.spcname,CASE WHEN c.reltablespace=0 THEN NULL END),em.extname,
  CASE WHEN c.relkind IN ('i','I') THEN 'NULL' ELSE pg_temp.cyd_acl_state(c.relacl) END,
  CASE WHEN c.relkind IN ('i','I') THEN '[]'::jsonb ELSE pg_temp.cyd_acl_json(coalesce(c.relacl,'{}'::aclitem[])) END,
  CASE WHEN c.relkind IN ('i','I') THEN '[]'::jsonb
    ELSE pg_temp.cyd_acl_json(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) END
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_tablespace t ON t.oid=c.reltablespace
LEFT JOIN pg_index i ON i.indexrelid=c.oid
LEFT JOIN pg_class tc ON tc.oid=i.indrelid
LEFT JOIN cyd_extension_members em ON em.classid='pg_class'::regclass AND em.objid=c.oid AND em.objsubid=0
WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname<>'information_schema'
  AND c.relkind IN ('r','p','v','m','S','i','I') AND em.objid IS NULL;

INSERT INTO cyd_objects
SELECT 'pg_class'::regclass,c.oid,a.attnum,'COLUMN',n.nspname,a.attname,NULL,c.relname,
  c.relowner,NULL,em.extname,pg_temp.cyd_acl_state(a.attacl),
  pg_temp.cyd_acl_json(coalesce(a.attacl,'{}'::aclitem[])),
  pg_temp.cyd_acl_json(coalesce(a.attacl,acldefault('c',c.relowner)))
FROM pg_attribute a
JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN cyd_extension_members em ON em.classid='pg_class'::regclass AND em.objid=c.oid AND em.objsubid=a.attnum
LEFT JOIN cyd_extension_members parent_em ON parent_em.classid='pg_class'::regclass AND parent_em.objid=c.oid AND parent_em.objsubid=0
WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname<>'information_schema'
  AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
  AND em.objid IS NULL AND parent_em.objid IS NULL;

INSERT INTO cyd_objects
SELECT 'pg_proc'::regclass,p.oid,0,'ROUTINE',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),NULL,
  p.proowner,NULL,em.extname,pg_temp.cyd_acl_state(p.proacl),
  pg_temp.cyd_acl_json(coalesce(p.proacl,'{}'::aclitem[])),
  pg_temp.cyd_acl_json(coalesce(p.proacl,acldefault('f',p.proowner)))
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
LEFT JOIN cyd_extension_members em ON em.classid='pg_proc'::regclass AND em.objid=p.oid AND em.objsubid=0
WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname<>'information_schema' AND em.objid IS NULL;

INSERT INTO cyd_objects
SELECT 'pg_type'::regclass,t.oid,0,'TYPE',n.nspname,t.typname,NULL,NULL,t.typowner,NULL,em.extname,
  pg_temp.cyd_acl_state(t.typacl),pg_temp.cyd_acl_json(coalesce(t.typacl,'{}'::aclitem[])),
  pg_temp.cyd_acl_json(coalesce(t.typacl,acldefault('T',t.typowner)))
FROM pg_type t
JOIN pg_namespace n ON n.oid=t.typnamespace
LEFT JOIN pg_class c ON c.oid=t.typrelid
LEFT JOIN cyd_extension_members em ON em.classid='pg_type'::regclass AND em.objid=t.oid AND em.objsubid=0
WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname<>'information_schema'
  AND ((t.typtype='b' AND t.typelem=0) OR t.typtype IN ('d','e','r','m') OR (t.typtype='c' AND t.typrelid<>0 AND c.relkind='c'))
  AND em.objid IS NULL;

INSERT INTO cyd_objects
SELECT 'pg_largeobject_metadata'::regclass,l.oid,0,'LARGE_OBJECT',NULL,format('lo:%s',l.oid),NULL,NULL,l.lomowner,NULL,NULL,
  pg_temp.cyd_acl_state(l.lomacl),pg_temp.cyd_acl_json(coalesce(l.lomacl,'{}'::aclitem[])),
  pg_temp.cyd_acl_json(coalesce(l.lomacl,acldefault('L',l.lomowner)))
FROM pg_largeobject_metadata l;

WITH source AS (
  SELECT d.datname AS name,pg_get_userbyid(d.datdba) AS owner,t.spcname AS default_tablespace,
    d.datallowconn AS allow_connect,d.datconnlimit AS connection_limit,d.datacl,d.datdba
  FROM pg_database d JOIN pg_tablespace t ON t.oid=d.dattablespace WHERE d.datname=:'expected_database'
)
SELECT 'DATABASE' AS record_type,jsonb_build_object(
  'name',name,'owner',owner,'default_tablespace',default_tablespace,'allow_connect',allow_connect,'connection_limit',connection_limit,
  'acl_state',pg_temp.cyd_acl_state(datacl),
  'explicit_privileges',pg_temp.cyd_acl_json(coalesce(datacl,'{}'::aclitem[])),
  'effective_privileges',pg_temp.cyd_acl_json(coalesce(datacl,acldefault('d',datdba)))
)::text AS payload FROM source;

SELECT 'ROLE',jsonb_build_object(
  'name',r.rolname,'purpose',p.purpose,'superuser',r.rolsuper,'inherit',r.rolinherit,'create_role',r.rolcreaterole,
  'create_database',r.rolcreatedb,'can_login',r.rolcanlogin,'replication',r.rolreplication,'connection_limit',r.rolconnlimit,
  'valid_until',CASE WHEN r.rolvaliduntil IS NULL OR r.rolvaliduntil='infinity'::timestamptz THEN NULL ELSE to_char(r.rolvaliduntil AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
  'bypass_rls',r.rolbypassrls
)::text FROM pg_roles r JOIN cyd_policy_roles p ON p.name=r.rolname ORDER BY r.rolname;

SELECT 'MEMBERSHIP',jsonb_build_object(
  'role',pg_get_userbyid(m.roleid),'member',pg_get_userbyid(m.member),
  'grantor',pg_temp.cyd_role_name(m.grantor),
  'admin_option',m.admin_option,'inherit_option',m.inherit_option,'set_option',m.set_option
)::text FROM pg_auth_members m
WHERE m.roleid IN (SELECT oid FROM pg_roles WHERE rolname IN (SELECT name FROM cyd_policy_roles))
   OR m.member IN (SELECT oid FROM pg_roles WHERE rolname IN (SELECT name FROM cyd_policy_roles))
ORDER BY 2;

SELECT 'SETTING',jsonb_build_object(
  'role_scope',CASE WHEN s.setrole=0 THEN 'ALL' ELSE pg_get_userbyid(s.setrole) END,
  'database_scope',CASE WHEN s.setdatabase=0 THEN 'ALL' ELSE 'DATABASE' END,
  'key',split_part(v,'=',1),'value',substr(v,strpos(v,'=')+1)
)::text
FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) v
WHERE s.setrole IN (0,(SELECT oid FROM pg_roles WHERE rolname=:'migration_owner'),(SELECT oid FROM pg_roles WHERE rolname=:'runtime_login'),(SELECT oid FROM pg_roles WHERE rolname=:'privilege_group'))
  AND s.setdatabase IN (0,(SELECT oid FROM pg_database WHERE datname=:'expected_database'))
  AND split_part(v,'=',1) IN ('application_name','idle_in_transaction_session_timeout','lock_timeout','statement_timeout')
ORDER BY 2;

SELECT 'OBJECT',jsonb_build_object(
  'kind',kind,'schema',schema_name,'name',object_name,'identity_arguments',identity_arguments,'parent_identity',parent_identity,
  'owner',CASE WHEN owner_oid=(SELECT oid FROM pg_roles WHERE rolname='pg_database_owner') THEN 'pg_database_owner' ELSE pg_get_userbyid(owner_oid) END,
  'tablespace',tablespace_name,'extension',extension_name,'acl_state',acl_state,
  'explicit_privileges',explicit_privileges,'effective_privileges',effective_privileges
)::text FROM cyd_objects ORDER BY kind,schema_name NULLS FIRST,object_name,identity_arguments NULLS FIRST,parent_identity NULLS FIRST;

SELECT 'DEFAULT_PRIVILEGE',jsonb_build_object(
  'owner',pg_get_userbyid(d.defaclrole),'schema',CASE WHEN d.defaclnamespace=0 THEN NULL ELSE n.nspname END,
  'object_kind',CASE d.defaclobjtype WHEN 'r' THEN 'TABLE' WHEN 'S' THEN 'SEQUENCE' WHEN 'f' THEN 'ROUTINE' WHEN 'T' THEN 'TYPE' WHEN 'n' THEN 'SCHEMA' WHEN 'L' THEN 'LARGE_OBJECT' ELSE 'UNSUPPORTED' END,
  'acl_state',pg_temp.cyd_acl_state(d.defaclacl),
  'explicit_privileges',pg_temp.cyd_acl_json(coalesce(d.defaclacl,'{}'::aclitem[])),
  'effective_privileges',pg_temp.cyd_acl_json(coalesce(d.defaclacl,'{}'::aclitem[]))
)::text FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace ORDER BY 2;

SELECT 'TABLESPACE',jsonb_build_object(
  'name',t.spcname,'owner',pg_get_userbyid(t.spcowner),'options',coalesce(to_jsonb(t.spcoptions),'[]'::jsonb),
  'source_location_sha256',pg_temp.cyd_sha256(pg_tablespace_location(t.oid)),
  'acl_state',pg_temp.cyd_acl_state(t.spcacl),
  'explicit_privileges',pg_temp.cyd_acl_json(coalesce(t.spcacl,'{}'::aclitem[])),
  'effective_privileges',pg_temp.cyd_acl_json(coalesce(t.spcacl,acldefault('t',t.spcowner)))
)::text FROM pg_tablespace t WHERE t.spcname NOT IN ('pg_default','pg_global') ORDER BY t.spcname;

SELECT 'EXTENSION',jsonb_build_object(
  'name',e.extname,'version',e.extversion,'schema',n.nspname,'owner',pg_temp.cyd_role_name(e.extowner),
  'member_fingerprint',pg_temp.cyd_sha256(coalesce((
    SELECT string_agg(format('%s:%s:%s',address.type,to_jsonb(address.object_names)::text,to_jsonb(address.object_args)::text),E'\n'
      ORDER BY address.type,to_jsonb(address.object_names)::text,to_jsonb(address.object_args)::text)
    FROM pg_depend d
    CROSS JOIN LATERAL pg_identify_object_as_address(d.classid,d.objid,d.objsubid) address
    WHERE d.refclassid='pg_extension'::regclass AND d.refobjid=e.oid AND d.deptype='e'
  ),''))
)::text FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY e.extname;

SELECT 'PUBLICATION',jsonb_build_object(
  'name',p.pubname,'owner',pg_get_userbyid(p.pubowner),'all_tables',p.puballtables,'publish_insert',p.pubinsert,
  'publish_update',p.pubupdate,'publish_delete',p.pubdelete,'publish_truncate',p.pubtruncate,'publish_via_partition_root',p.pubviaroot,
  'table_fingerprint',pg_temp.cyd_sha256(coalesce((
    SELECT string_agg(
      format('%I.%I:%s:%s',n.nspname,c.relname,
        coalesce((SELECT string_agg(a.attname,',' ORDER BY position) FROM unnest(r.prattrs::smallint[]) WITH ORDINALITY selected(attnum,position) JOIN pg_attribute a ON a.attrelid=r.prrelid AND a.attnum=selected.attnum),'*'),
        coalesce(pg_get_expr(r.prqual,r.prrelid),'TRUE')),
      E'\n' ORDER BY n.nspname,c.relname,r.oid)
    FROM pg_publication_rel r JOIN pg_class c ON c.oid=r.prrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE r.prpubid=p.oid
  ),'') || E'\n' || coalesce((
    SELECT string_agg(format('SCHEMA:%I',n.nspname),E'\n' ORDER BY n.nspname)
    FROM pg_publication_namespace pn JOIN pg_namespace n ON n.oid=pn.pnnspid WHERE pn.pnpubid=p.oid
  ),''))
)::text FROM pg_publication p ORDER BY p.pubname;

SELECT 'PARAMETER_PRIVILEGE',jsonb_build_object(
  'parameter',p.parname,'grantor',pg_temp.cyd_role_name(a.grantor),'grantee',pg_temp.cyd_role_name(a.grantee),
  'privilege_type',a.privilege_type,'is_grantable',a.is_grantable
)::text FROM pg_parameter_acl p CROSS JOIN LATERAL aclexplode(p.paracl) a ORDER BY 2;

WITH policy_role_oids AS (SELECT oid FROM pg_roles WHERE rolname IN (SELECT name FROM cyd_policy_roles)),
counts(name,value) AS (
  VALUES
    ('access_methods',(SELECT count(*) FROM pg_am a LEFT JOIN cyd_extension_members e ON e.classid='pg_am'::regclass AND e.objid=a.oid WHERE a.oid>=16384 AND e.objid IS NULL)),
    ('casts',(SELECT count(*) FROM pg_cast c LEFT JOIN cyd_extension_members e ON e.classid='pg_cast'::regclass AND e.objid=c.oid WHERE c.oid>=16384 AND e.objid IS NULL)),
    ('capture_role_conflicts',(SELECT count(*) FROM cyd_policy_roles WHERE name=current_user)),
    ('collations',(SELECT count(*) FROM pg_collation c JOIN pg_namespace n ON n.oid=c.collnamespace LEFT JOIN cyd_extension_members e ON e.classid='pg_collation'::regclass AND e.objid=c.oid WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname<>'information_schema' AND e.objid IS NULL)),
    ('conversions',(SELECT count(*) FROM pg_conversion c JOIN pg_namespace n ON n.oid=c.connamespace LEFT JOIN cyd_extension_members e ON e.classid='pg_conversion'::regclass AND e.objid=c.oid WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname<>'information_schema' AND e.objid IS NULL)),
    ('event_triggers',(SELECT count(*) FROM pg_event_trigger)),
    ('external_database_settings',(SELECT count(*) FROM pg_db_role_setting WHERE setdatabase NOT IN (0,(SELECT oid FROM pg_database WHERE datname=:'expected_database')) AND (setrole=0 OR setrole IN (SELECT oid FROM policy_role_oids)))),
    ('foreign_data_wrappers',(SELECT count(*) FROM pg_foreign_data_wrapper)),
    ('foreign_servers',(SELECT count(*) FROM pg_foreign_server)),
    ('foreign_tables',(SELECT count(*) FROM pg_foreign_table)),
    ('operator_classes',(SELECT count(*) FROM pg_opclass o JOIN pg_namespace n ON n.oid=o.opcnamespace LEFT JOIN cyd_extension_members e ON e.classid='pg_opclass'::regclass AND e.objid=o.oid WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname<>'information_schema' AND e.objid IS NULL)),
    ('operator_families',(SELECT count(*) FROM pg_opfamily o JOIN pg_namespace n ON n.oid=o.opfnamespace LEFT JOIN cyd_extension_members e ON e.classid='pg_opfamily'::regclass AND e.objid=o.oid WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname<>'information_schema' AND e.objid IS NULL)),
    ('operators',(SELECT count(*) FROM pg_operator o JOIN pg_namespace n ON n.oid=o.oprnamespace LEFT JOIN cyd_extension_members e ON e.classid='pg_operator'::regclass AND e.objid=o.oid WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname<>'information_schema' AND e.objid IS NULL)),
    ('parameter_acl_entries',(SELECT count(*) FROM pg_parameter_acl p CROSS JOIN LATERAL aclexplode(p.paracl))),
    ('policy_role_endpoints',(SELECT count(*) FROM (
      SELECT r.oid FROM pg_roles r WHERE r.rolname IN (SELECT name FROM cyd_policy_roles)
      UNION ALL SELECT m.roleid FROM pg_auth_members m WHERE m.member IN (SELECT oid FROM policy_role_oids) AND m.roleid NOT IN (SELECT oid FROM policy_role_oids)
      UNION ALL SELECT m.member FROM pg_auth_members m WHERE m.roleid IN (SELECT oid FROM policy_role_oids) AND m.member NOT IN (SELECT oid FROM policy_role_oids)
    ) q WHERE q.oid NOT IN (SELECT oid FROM policy_role_oids))),
    ('replication_origins',(SELECT count(*) FROM pg_replication_origin)),
    ('row_security_policies',(SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname<>'information_schema')),
    ('security_labels',((SELECT count(*) FROM pg_seclabel)+(SELECT count(*) FROM pg_shseclabel))),
    ('statistics_extensions',(SELECT count(*) FROM pg_statistic_ext s JOIN pg_namespace n ON n.oid=s.stxnamespace LEFT JOIN cyd_extension_members e ON e.classid='pg_statistic_ext'::regclass AND e.objid=s.oid WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname<>'information_schema' AND e.objid IS NULL)),
    ('subscriptions',(SELECT count(*) FROM pg_subscription)),
    ('text_search_objects',(
      (SELECT count(*) FROM pg_ts_config c JOIN pg_namespace n ON n.oid=c.cfgnamespace LEFT JOIN cyd_extension_members e ON e.classid='pg_ts_config'::regclass AND e.objid=c.oid WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname<>'information_schema' AND e.objid IS NULL)+
      (SELECT count(*) FROM pg_ts_dict d JOIN pg_namespace n ON n.oid=d.dictnamespace LEFT JOIN cyd_extension_members e ON e.classid='pg_ts_dict'::regclass AND e.objid=d.oid WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname<>'information_schema' AND e.objid IS NULL)+
      (SELECT count(*) FROM pg_ts_parser p JOIN pg_namespace n ON n.oid=p.prsnamespace LEFT JOIN cyd_extension_members e ON e.classid='pg_ts_parser'::regclass AND e.objid=p.oid WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname<>'information_schema' AND e.objid IS NULL)+
      (SELECT count(*) FROM pg_ts_template t JOIN pg_namespace n ON n.oid=t.tmplnamespace LEFT JOIN cyd_extension_members e ON e.classid='pg_ts_template'::regclass AND e.objid=t.oid WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname<>'information_schema' AND e.objid IS NULL))),
    ('transforms',(SELECT count(*) FROM pg_transform t LEFT JOIN cyd_extension_members e ON e.classid='pg_transform'::regclass AND e.objid=t.oid WHERE e.objid IS NULL)),
    ('unapproved_languages',(SELECT count(*) FROM pg_language l WHERE l.lanname NOT IN ('internal','c','sql','plpgsql'))),
    ('unapproved_settings',(SELECT count(*) FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) v
      WHERE s.setrole IN (0,(SELECT oid FROM pg_roles WHERE rolname=:'migration_owner'),(SELECT oid FROM pg_roles WHERE rolname=:'runtime_login'),(SELECT oid FROM pg_roles WHERE rolname=:'privilege_group'))
        AND s.setdatabase IN (0,(SELECT oid FROM pg_database WHERE datname=:'expected_database'))
        AND split_part(v,'=',1) NOT IN ('application_name','idle_in_transaction_session_timeout','lock_timeout','statement_timeout'))),
    ('unsupported_relations',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN cyd_extension_members e ON e.classid='pg_class'::regclass AND e.objid=c.oid AND e.objsubid=0 WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname<>'information_schema' AND c.relkind NOT IN ('r','p','v','m','S','i','I','c') AND e.objid IS NULL)),
    ('user_mappings',(SELECT count(*) FROM pg_user_mapping))
)
SELECT 'UNSUPPORTED',jsonb_object_agg(name,value ORDER BY name)::text FROM counts;

COMMIT;
