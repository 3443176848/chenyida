import type { PoolClient, PoolConfig } from "pg";

import type { RuntimeConfig } from "../app/lib/infrastructure/config.ts";
import {
  isControlledDeployment,
  isolatedEnvironmentSecret,
  readControlledRuntimeSecret,
  runtimeServiceKind,
  type ControlledDeploymentClass,
  type RuntimeServiceKind,
} from "../app/lib/infrastructure/runtime-secret.ts";

const IDENTIFIER = /^[a-z_][a-z0-9_$-]{0,62}$/;
const DEPLOYMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

export type DatabaseRuntimePolicy = Readonly<{
  service: RuntimeServiceKind;
  role: string;
  privilegeGroup: string | null;
  ownerRole: "chenyida_erp_owner";
  database: "chenyida_erp";
  applicationName: string;
  poolMaximum: number;
  roleConnectionLimit: number;
  roleInherit: boolean;
  marker: string;
}>;

type RuntimePolicyTemplate = Omit<DatabaseRuntimePolicy, "marker">;

const POLICY_TEMPLATES: Readonly<Record<RuntimeServiceKind, RuntimePolicyTemplate>> = Object.freeze({
  WEB: Object.freeze({
    service: "WEB", role: "chenyida_erp_web", privilegeGroup: "chenyida_erp_web_acl",
    ownerRole: "chenyida_erp_owner", database: "chenyida_erp", applicationName: "chenyida-erp-web",
    poolMaximum: 10, roleConnectionLimit: 12, roleInherit: true,
  }),
  WORKER: Object.freeze({
    service: "WORKER", role: "chenyida_erp_worker", privilegeGroup: "chenyida_erp_worker_acl",
    ownerRole: "chenyida_erp_owner", database: "chenyida_erp", applicationName: "chenyida-erp-worker",
    poolMaximum: 4, roleConnectionLimit: 6, roleInherit: true,
  }),
  MIGRATION: Object.freeze({
    service: "MIGRATION", role: "chenyida_erp_owner", privilegeGroup: null,
    ownerRole: "chenyida_erp_owner", database: "chenyida_erp", applicationName: "chenyida-erp-migration",
    poolMaximum: 1, roleConnectionLimit: 1, roleInherit: false,
  }),
  ADMIN: Object.freeze({
    service: "ADMIN", role: "chenyida_erp_admin", privilegeGroup: "chenyida_erp_admin_acl",
    ownerRole: "chenyida_erp_owner", database: "chenyida_erp", applicationName: "chenyida-erp-admin",
    poolMaximum: 1, roleConnectionLimit: 1, roleInherit: true,
  }),
});

export class DatabaseRuntimeError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "DatabaseRuntimeError";
    this.code = code;
  }
}

function reject(code: string): never {
  throw new DatabaseRuntimeError(code);
}

function controlledPolicy(deploymentClass: ControlledDeploymentClass): DatabaseRuntimePolicy {
  const service = runtimeServiceKind(deploymentClass);
  if (!service) reject("DATABASE_RUNTIME_SERVICE_INVALID");
  const deploymentId = process.env.ERP_RELEASE_EXPECTED_DEPLOYMENT_ID || "";
  if (!DEPLOYMENT_ID.test(deploymentId)) reject("DATABASE_RUNTIME_DEPLOYMENT_ID_INVALID");
  const template = POLICY_TEMPLATES[service];
  return Object.freeze({
    ...template,
    marker: `chenyida-erp-deployment/v2:${deploymentClass.toUpperCase()}:${deploymentId}`,
  });
}

export function databaseRuntimePolicy(
  config: Pick<RuntimeConfig, "deploymentClass">,
): DatabaseRuntimePolicy | null {
  return isControlledDeployment(config.deploymentClass) ? controlledPolicy(config.deploymentClass) : null;
}

export function databasePoolConfiguration(
  config: Pick<RuntimeConfig, "environment" | "deploymentClass">,
): Readonly<{ pool: PoolConfig; policy: DatabaseRuntimePolicy | null }> {
  const policy = databaseRuntimePolicy(config);
  if (!policy) {
    const connectionString = isolatedEnvironmentSecret(config.deploymentClass, "DATABASE_URL");
    if (config.environment === "test" && !/(test|localhost|127\.0\.0\.1)/i.test(connectionString)) {
      reject("TEST_DATABASE_TARGET_INVALID");
    }
    const maximum = Number(process.env.DATABASE_POOL_MAX || 10);
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 32) reject("DATABASE_POOL_MAX_INVALID");
    return Object.freeze({
      policy: null,
      pool: Object.freeze({
        connectionString,
        max: maximum,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
        application_name: process.env.ERP_PROCESS_NAME || "chenyida-erp-test",
      }),
    });
  }
  if (!isControlledDeployment(config.deploymentClass)) reject("DATABASE_RUNTIME_POLICY_INVALID");
  const password = readControlledRuntimeSecret(config.deploymentClass, policy.service, "DATABASE_PASSWORD");
  return Object.freeze({
    policy,
    pool: Object.freeze({
      host: "postgres",
      port: 5_432,
      database: policy.database,
      user: policy.role,
      password,
      ssl: false,
      max: policy.poolMaximum,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: policy.applicationName,
    }),
  });
}

export type RuntimeIdentityQuery = Pick<PoolClient, "query">;

type IdentityRow = {
  database_name: string;
  database_marker: string | null;
  database_owner: string;
  current_role_name: string;
  session_role_name: string;
  application_name: string;
  role_login: boolean;
  role_superuser: boolean;
  role_create_role: boolean;
  role_create_database: boolean;
  role_replication: boolean;
  role_bypass_rls: boolean;
  role_inherit: boolean;
  role_connection_limit: number;
  role_settings_absent: boolean;
  membership_valid: boolean;
  dangerous_membership_absent: boolean;
  owner_membership_absent: boolean;
  database_connect: boolean;
  database_create: boolean;
  database_temporary: boolean;
  schema_usage: boolean;
  schema_create: boolean;
  migration_select: boolean;
  migration_insert: boolean;
  migration_update: boolean;
  migration_delete: boolean;
  lease_select: boolean;
  lease_insert: boolean;
  lease_update: boolean;
  lease_delete: boolean;
  users_select: boolean;
  users_insert: boolean;
  users_update: boolean;
  users_delete: boolean;
};

function expectedCanaries(policy: DatabaseRuntimePolicy, row: IdentityRow): boolean {
  if (policy.service === "MIGRATION") return true;
  const migrationCanaryValid = policy.service === "ADMIN"
    ? !row.migration_select && !row.migration_insert && !row.migration_update && !row.migration_delete
    : row.migration_select && !row.migration_insert && !row.migration_update && !row.migration_delete;
  if (!migrationCanaryValid) return false;
  if (policy.service === "WEB") {
    return row.lease_select && !row.lease_insert && !row.lease_update && !row.lease_delete
      && row.users_select && row.users_insert && row.users_update && !row.users_delete;
  }
  if (policy.service === "WORKER") {
    return row.lease_select && row.lease_insert && row.lease_update && !row.lease_delete
      && !row.users_select && !row.users_insert && !row.users_update && !row.users_delete;
  }
  return !row.lease_select && !row.lease_insert && !row.lease_update && !row.lease_delete
    && row.users_select && row.users_insert && !row.users_update && !row.users_delete;
}

export async function assertDatabaseRuntimeIdentity(
  client: RuntimeIdentityQuery,
  policy: DatabaseRuntimePolicy,
): Promise<void> {
  if (!IDENTIFIER.test(policy.role) || !IDENTIFIER.test(policy.ownerRole)
    || (policy.privilegeGroup !== null && !IDENTIFIER.test(policy.privilegeGroup))) {
    reject("DATABASE_RUNTIME_POLICY_INVALID");
  }
  try {
    const result = await client.query<IdentityRow>(`
      select pg_catalog.current_database()::text as database_name,
             pg_catalog.shobj_description(d.oid,'pg_database') as database_marker,
             pg_catalog.pg_get_userbyid(d.datdba)::text as database_owner,
             current_user::text as current_role_name,
             session_user::text as session_role_name,
             pg_catalog.current_setting('application_name')::text as application_name,
             r.rolcanlogin as role_login,
             r.rolsuper as role_superuser,
             r.rolcreaterole as role_create_role,
             r.rolcreatedb as role_create_database,
             r.rolreplication as role_replication,
             r.rolbypassrls as role_bypass_rls,
             r.rolinherit as role_inherit,
             r.rolconnlimit as role_connection_limit,
             r.rolconfig is null and not exists (
               select 1 from pg_catalog.pg_db_role_setting s where s.setrole=r.oid
             ) as role_settings_absent,
             case when $2::text is null then
               not exists (select 1 from pg_catalog.pg_auth_members m where m.member=r.oid or m.roleid=r.oid)
             else
               exists (
                 select 1 from pg_catalog.pg_auth_members m join pg_catalog.pg_roles g on g.oid=m.roleid
                  where m.member=r.oid and g.rolname=$2 and not m.admin_option and m.inherit_option and not m.set_option
               )
               and not exists (
                 select 1 from pg_catalog.pg_auth_members m
                  where (m.member=r.oid or m.roleid=r.oid)
                    and not (m.member=r.oid and m.roleid=(select g.oid from pg_catalog.pg_roles g where g.rolname=$2))
               )
               and exists (
                 select 1 from pg_catalog.pg_roles g where g.rolname=$2 and not g.rolcanlogin and not g.rolsuper
                  and not g.rolcreaterole and not g.rolcreatedb and not g.rolreplication and not g.rolbypassrls
               )
               and not exists (
                 select 1 from pg_catalog.pg_auth_members m
                  where (m.member=(select g.oid from pg_catalog.pg_roles g where g.rolname=$2)
                     or m.roleid=(select g.oid from pg_catalog.pg_roles g where g.rolname=$2))
                    and not (m.member=r.oid and m.roleid=(select g.oid from pg_catalog.pg_roles g where g.rolname=$2))
               )
             end as membership_valid,
             not (pg_catalog.pg_has_role(r.rolname,'pg_monitor','MEMBER')
               or pg_catalog.pg_has_role(r.rolname,'pg_read_all_data','MEMBER')
               or pg_catalog.pg_has_role(r.rolname,'pg_write_all_data','MEMBER')
               or pg_catalog.pg_has_role(r.rolname,'pg_signal_backend','MEMBER')) as dangerous_membership_absent,
             case when r.rolname=$3 then true else not pg_catalog.pg_has_role(r.rolname,$3,'MEMBER') end as owner_membership_absent,
             pg_catalog.has_database_privilege(r.oid,d.oid,'CONNECT') as database_connect,
             pg_catalog.has_database_privilege(r.oid,d.oid,'CREATE') as database_create,
             pg_catalog.has_database_privilege(r.oid,d.oid,'TEMPORARY') as database_temporary,
             pg_catalog.has_schema_privilege(r.oid,'public','USAGE') as schema_usage,
             pg_catalog.has_schema_privilege(r.oid,'public','CREATE') as schema_create,
             coalesce(pg_catalog.has_table_privilege(r.oid,pg_catalog.to_regclass('public.schema_migrations'),'SELECT'),false) as migration_select,
             coalesce(pg_catalog.has_table_privilege(r.oid,pg_catalog.to_regclass('public.schema_migrations'),'INSERT'),false) as migration_insert,
             coalesce(pg_catalog.has_table_privilege(r.oid,pg_catalog.to_regclass('public.schema_migrations'),'UPDATE'),false) as migration_update,
             coalesce(pg_catalog.has_table_privilege(r.oid,pg_catalog.to_regclass('public.schema_migrations'),'DELETE'),false) as migration_delete,
             coalesce(pg_catalog.has_table_privilege(r.oid,pg_catalog.to_regclass('public.worker_runtime_leases'),'SELECT'),false) as lease_select,
             coalesce(pg_catalog.has_table_privilege(r.oid,pg_catalog.to_regclass('public.worker_runtime_leases'),'INSERT'),false) as lease_insert,
             coalesce(pg_catalog.has_table_privilege(r.oid,pg_catalog.to_regclass('public.worker_runtime_leases'),'UPDATE'),false) as lease_update,
             coalesce(pg_catalog.has_table_privilege(r.oid,pg_catalog.to_regclass('public.worker_runtime_leases'),'DELETE'),false) as lease_delete,
             coalesce(pg_catalog.has_table_privilege(r.oid,pg_catalog.to_regclass('public.app_users'),'SELECT'),false) as users_select,
             coalesce(pg_catalog.has_table_privilege(r.oid,pg_catalog.to_regclass('public.app_users'),'INSERT'),false) as users_insert,
             coalesce(pg_catalog.has_table_privilege(r.oid,pg_catalog.to_regclass('public.app_users'),'UPDATE'),false) as users_update,
             coalesce(pg_catalog.has_table_privilege(r.oid,pg_catalog.to_regclass('public.app_users'),'DELETE'),false) as users_delete
        from pg_catalog.pg_database d
        join pg_catalog.pg_roles r on r.rolname=current_user
       where d.datname=pg_catalog.current_database() and r.rolname=$1
    `, [policy.role, policy.privilegeGroup, policy.ownerRole]);
    if (result.rows.length !== 1) reject("DATABASE_RUNTIME_IDENTITY_INVALID");
    const row = result.rows[0];
    if (row.database_name !== policy.database || row.database_marker !== policy.marker
      || row.database_owner !== policy.ownerRole || row.current_role_name !== policy.role
      || row.session_role_name !== policy.role || row.application_name !== policy.applicationName
      || row.role_login !== true || row.role_superuser !== false || row.role_create_role !== false
      || row.role_create_database !== false || row.role_replication !== false || row.role_bypass_rls !== false
      || row.role_inherit !== policy.roleInherit || row.role_connection_limit !== policy.roleConnectionLimit
      || row.role_settings_absent !== true || row.membership_valid !== true
      || row.dangerous_membership_absent !== true || row.owner_membership_absent !== true
      || row.database_connect !== true || row.schema_usage !== true
      || (policy.service === "MIGRATION"
        ? row.database_create !== true || row.database_temporary !== true || row.schema_create !== true
        : row.database_create !== false || row.database_temporary !== false || row.schema_create !== false)
      || !expectedCanaries(policy, row)) {
      reject("DATABASE_RUNTIME_IDENTITY_INVALID");
    }
  } catch (error) {
    if (error instanceof DatabaseRuntimeError) throw error;
    reject("DATABASE_RUNTIME_IDENTITY_INVALID");
  }
}
