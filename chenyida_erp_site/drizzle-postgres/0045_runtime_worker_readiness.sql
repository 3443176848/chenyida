CREATE TABLE "worker_runtime_leases" (
	"service_slot" text PRIMARY KEY NOT NULL,
	"instance_id" uuid NOT NULL,
	"generation" bigint DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"deployment_class" text NOT NULL,
	"deployment_id" text NOT NULL,
	"application_version" text NOT NULL,
	"git_commit" text NOT NULL,
	"migration_head" text NOT NULL,
	"migration_manifest_sha256" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "worker_runtime_leases_slot_ck" CHECK ("worker_runtime_leases"."service_slot" = 'background-jobs'),
	CONSTRAINT "worker_runtime_leases_generation_version_ck" CHECK ("worker_runtime_leases"."generation" > 0 and "worker_runtime_leases"."version" > 0),
	CONSTRAINT "worker_runtime_leases_status_ck" CHECK ("worker_runtime_leases"."status" in ('RUNNING','STOPPED')),
	CONSTRAINT "worker_runtime_leases_deployment_class_ck" CHECK ("worker_runtime_leases"."deployment_class" in ('development','test','uat','production')),
	CONSTRAINT "worker_runtime_leases_deployment_id_ck" CHECK ("worker_runtime_leases"."deployment_id" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'),
	CONSTRAINT "worker_runtime_leases_application_version_ck" CHECK ("worker_runtime_leases"."application_version" ~ '^0\.1\.0-alpha\.[0-9]+$'),
	CONSTRAINT "worker_runtime_leases_git_commit_ck" CHECK ("worker_runtime_leases"."git_commit" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "worker_runtime_leases_migration_identity_ck" CHECK ("worker_runtime_leases"."migration_head" ~ '^[0-9]{4}_[a-z0-9_]+\.sql$' and "worker_runtime_leases"."migration_manifest_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "worker_runtime_leases_time_ck" CHECK (
    ("worker_runtime_leases"."status"='RUNNING' and "worker_runtime_leases"."stopped_at" is null and "worker_runtime_leases"."started_at"<="worker_runtime_leases"."heartbeat_at"
      and "worker_runtime_leases"."heartbeat_at"<"worker_runtime_leases"."lease_expires_at" and "worker_runtime_leases"."lease_expires_at"<="worker_runtime_leases"."heartbeat_at"+interval '5 minutes')
    or
    ("worker_runtime_leases"."status"='STOPPED' and "worker_runtime_leases"."stopped_at" is not null and "worker_runtime_leases"."started_at"<="worker_runtime_leases"."heartbeat_at"
      and "worker_runtime_leases"."heartbeat_at"="worker_runtime_leases"."stopped_at" and "worker_runtime_leases"."lease_expires_at"="worker_runtime_leases"."stopped_at")
  )
);
