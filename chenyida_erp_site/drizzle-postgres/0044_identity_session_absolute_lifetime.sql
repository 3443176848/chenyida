ALTER TABLE "app_sessions" ADD COLUMN "absolute_expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "app_sessions"
SET "absolute_expires_at"="created_at"+interval '24 hours',
	"expires_at"=least("expires_at","created_at"+interval '24 hours');--> statement-breakpoint
ALTER TABLE "app_sessions" ALTER COLUMN "absolute_expires_at" SET DEFAULT now()+interval '24 hours';--> statement-breakpoint
ALTER TABLE "app_sessions" ALTER COLUMN "absolute_expires_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "app_sessions" DROP CONSTRAINT "app_sessions_revocation_ck";--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_revocation_ck" CHECK (("app_sessions"."revoked_at" is null and "app_sessions"."revoked_reason" is null) or ("app_sessions"."revoked_at" is not null and "app_sessions"."revoked_reason" in ('LOGOUT','USER_INACTIVE','USER_DEACTIVATED','PASSWORD_RESET','PASSWORD_CHANGED','IDLE_TIMEOUT','ABSOLUTE_TIMEOUT')));--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_deadline_ck" CHECK ("app_sessions"."absolute_expires_at" = "app_sessions"."created_at"+interval '24 hours' and "app_sessions"."expires_at" <= "app_sessions"."absolute_expires_at");--> statement-breakpoint
CREATE INDEX "app_sessions_active_absolute_expiry_idx" ON "app_sessions" USING btree ("absolute_expires_at") WHERE "app_sessions"."revoked_at" is null;--> statement-breakpoint
CREATE FUNCTION "cyd_app_sessions_identity_immutable_guard"() RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
	IF NEW."token_hash" IS DISTINCT FROM OLD."token_hash"
		OR NEW."username" IS DISTINCT FROM OLD."username"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
		OR NEW."absolute_expires_at" IS DISTINCT FROM OLD."absolute_expires_at" THEN
		RAISE EXCEPTION USING
			ERRCODE='23514',
			MESSAGE='APP_SESSION_IDENTITY_IMMUTABLE',
			CONSTRAINT='app_sessions_identity_immutable_ck';
	END IF;
	RETURN NEW;
END;
$function$;--> statement-breakpoint
CREATE TRIGGER "cyd_app_sessions_identity_immutable_guard"
BEFORE UPDATE ON "app_sessions"
FOR EACH ROW EXECUTE FUNCTION "cyd_app_sessions_identity_immutable_guard"();
