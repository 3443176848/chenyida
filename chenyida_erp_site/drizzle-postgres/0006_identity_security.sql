CREATE TABLE "identity_login_failures" (
	"username_digest" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_login_failures_digest_ck" CHECK ("identity_login_failures"."username_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "identity_login_failures_count_ck" CHECK ("identity_login_failures"."failure_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "identity_write_rate_limit_buckets" (
	"username" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"new_key_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_write_rate_limit_counts_ck" CHECK ("identity_write_rate_limit_buckets"."attempt_count" >= 0 and "identity_write_rate_limit_buckets"."new_key_count" >= 0 and "identity_write_rate_limit_buckets"."rejected_count" >= 0 and "identity_write_rate_limit_buckets"."new_key_count" <= "identity_write_rate_limit_buckets"."attempt_count")
);
--> statement-breakpoint
ALTER TABLE "app_sessions" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD COLUMN "revoked_reason" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "target_username" text;--> statement-breakpoint
ALTER TABLE "identity_write_rate_limit_buckets" ADD CONSTRAINT "identity_write_rate_limit_buckets_username_app_users_username_fk" FOREIGN KEY ("username") REFERENCES "public"."app_users"("username") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identity_login_failures_pk" ON "identity_login_failures" USING btree ("username_digest","window_start");--> statement-breakpoint
CREATE INDEX "identity_login_failures_window_idx" ON "identity_login_failures" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_write_rate_limit_buckets_pk" ON "identity_write_rate_limit_buckets" USING btree ("username","bucket_start");--> statement-breakpoint
CREATE INDEX "identity_write_rate_limit_bucket_idx" ON "identity_write_rate_limit_buckets" USING btree ("bucket_start");--> statement-breakpoint
CREATE INDEX "app_sessions_active_user_idx" ON "app_sessions" USING btree ("username","expires_at") WHERE "app_sessions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "audit_log_identity_created_idx" ON "audit_log" USING btree ("route_code","created_at","id");--> statement-breakpoint
CREATE INDEX "audit_log_identity_actor_created_idx" ON "audit_log" USING btree ("username","created_at") WHERE "audit_log"."route_code" = 'IDENTITY';--> statement-breakpoint
CREATE INDEX "audit_log_identity_target_created_idx" ON "audit_log" USING btree ("target_username","created_at") WHERE "audit_log"."route_code" = 'IDENTITY';--> statement-breakpoint
CREATE INDEX "audit_log_identity_action_result_created_idx" ON "audit_log" USING btree ("action","result","created_at") WHERE "audit_log"."route_code" = 'IDENTITY';--> statement-breakpoint
CREATE INDEX "idempotency_keys_identity_scope_idx" ON "idempotency_keys" USING btree ("username","method","path","created_at");--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_revocation_ck" CHECK (("app_sessions"."revoked_at" is null and "app_sessions"."revoked_reason" is null) or ("app_sessions"."revoked_at" is not null and "app_sessions"."revoked_reason" in ('LOGOUT','USER_INACTIVE','USER_DEACTIVATED','PASSWORD_RESET','PASSWORD_CHANGED')));--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_username_format_ck" CHECK ("app_users"."username" ~ '^[a-z][a-z0-9._-]{2,31}$');--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_display_name_ck" CHECK (char_length(btrim("app_users"."display_name")) between 1 and 128);--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_role_ck" CHECK ("app_users"."role" in ('admin','manager','purchase','engineering','production','warehouse','quality','sales','finance','operations'));