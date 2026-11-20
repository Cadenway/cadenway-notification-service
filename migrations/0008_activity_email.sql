CREATE TABLE "activity_email_authorization_attempts" (
	"organization_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"valid_until" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_email_authorization_attempts_pkey" PRIMARY KEY("organization_id","id"),
	CONSTRAINT "activity_email_authorization_attempts_item_unique" UNIQUE("organization_id","candidate_id","recipient_id","occurrence_id","generation"),
	CONSTRAINT "activity_email_authorization_attempts_generation_check" CHECK ("activity_email_authorization_attempts"."generation" >= 1),
	CONSTRAINT "activity_email_authorization_attempts_outcome_check" CHECK (("activity_email_authorization_attempts"."outcome" = 'pending' and "activity_email_authorization_attempts"."valid_until" is null)
        or ("activity_email_authorization_attempts"."outcome" in ('permitted', 'denied', 'expired') and "activity_email_authorization_attempts"."valid_until" is not null and "activity_email_authorization_attempts"."valid_until" <= "activity_email_authorization_attempts"."expires_at")),
	CONSTRAINT "activity_email_authorization_attempts_expiry_check" CHECK ("activity_email_authorization_attempts"."expires_at" > "activity_email_authorization_attempts"."created_at")
);
--> statement-breakpoint
ALTER TABLE "activity_email_authorization_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_email_authorization_attempts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "activity_email_candidates" (
	"organization_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"kind" text NOT NULL,
	"task_key" text NOT NULL,
	"comment_id" uuid,
	"status" text,
	"occurrence_id" uuid,
	"generation" integer,
	"settled_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_email_candidates_pkey" PRIMARY KEY("organization_id","id","recipient_id"),
	CONSTRAINT "activity_email_candidates_recipient_id_unique" UNIQUE("recipient_id","id"),
	CONSTRAINT "activity_email_candidates_source_recipient_unique" UNIQUE("organization_id","recipient_id","source_event_id"),
	CONSTRAINT "activity_email_candidates_kind_check" CHECK ("activity_email_candidates"."kind" in ('assignment', 'comment', 'mention', 'status-change', 'approval', 'access')),
	CONSTRAINT "activity_email_candidates_actor_check" CHECK ("activity_email_candidates"."actor_user_id" is distinct from "activity_email_candidates"."recipient_id"),
	CONSTRAINT "activity_email_candidates_assignment_check" CHECK (("activity_email_candidates"."occurrence_id" is null and "activity_email_candidates"."generation" is null and "activity_email_candidates"."settled_at" is null)
        or ("activity_email_candidates"."occurrence_id" is not null and "activity_email_candidates"."generation" is not null and "activity_email_candidates"."generation" >= 1))
);
--> statement-breakpoint
ALTER TABLE "activity_email_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_email_candidates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "activity_email_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"cadence" text NOT NULL,
	"local_date" date,
	"batch_number" integer,
	"individual_candidate_id" uuid,
	"due_at" timestamp (3) with time zone NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"preference_version" integer NOT NULL,
	"profile_version" integer NOT NULL,
	"state" text DEFAULT 'scheduled' NOT NULL,
	"lease_id" uuid,
	"lease_until" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_email_occurrences_recipient_id_unique" UNIQUE("recipient_id","id"),
	CONSTRAINT "activity_email_occurrences_epoch_batch_unique" UNIQUE("recipient_id","cadence","local_date","batch_number"),
	CONSTRAINT "activity_email_occurrences_individual_unique" UNIQUE("recipient_id","individual_candidate_id"),
	CONSTRAINT "activity_email_occurrences_identity_check" CHECK (("activity_email_occurrences"."cadence" = 'each' and "activity_email_occurrences"."individual_candidate_id" is not null and "activity_email_occurrences"."local_date" is null and "activity_email_occurrences"."batch_number" is null)
        or ("activity_email_occurrences"."cadence" in ('daily', 'weekly') and "activity_email_occurrences"."individual_candidate_id" is null and "activity_email_occurrences"."local_date" is not null and "activity_email_occurrences"."batch_number" is not null and "activity_email_occurrences"."batch_number" >= 1)),
	CONSTRAINT "activity_email_occurrences_versions_check" CHECK ("activity_email_occurrences"."generation" >= 1 and "activity_email_occurrences"."preference_version" >= 1 and "activity_email_occurrences"."profile_version" >= 1),
	CONSTRAINT "activity_email_occurrences_lease_check" CHECK ("activity_email_occurrences"."state" in ('scheduled', 'superseded', 'completed')
        and ("activity_email_occurrences"."lease_id" is null) = ("activity_email_occurrences"."lease_until" is null)
        and ("activity_email_occurrences"."state" = 'scheduled' or "activity_email_occurrences"."lease_id" is null))
);
--> statement-breakpoint
ALTER TABLE "activity_email_occurrences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_email_occurrences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_email_authorization_attempts" ADD CONSTRAINT "activity_email_authorization_attempts_candidate_fk" FOREIGN KEY ("organization_id","candidate_id","recipient_id") REFERENCES "public"."activity_email_candidates"("organization_id","id","recipient_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_email_authorization_attempts" ADD CONSTRAINT "activity_email_authorization_attempts_occurrence_fk" FOREIGN KEY ("recipient_id","occurrence_id") REFERENCES "public"."activity_email_occurrences"("recipient_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_email_candidates" ADD CONSTRAINT "activity_email_candidates_occurrence_fk" FOREIGN KEY ("recipient_id","occurrence_id") REFERENCES "public"."activity_email_occurrences"("recipient_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_email_candidates_pending_recipient_idx" ON "activity_email_candidates" USING btree ("recipient_id","created_at","id") WHERE "activity_email_candidates"."occurrence_id" is null and "activity_email_candidates"."settled_at" is null;--> statement-breakpoint
CREATE INDEX "activity_email_candidates_account_occurrence_idx" ON "activity_email_candidates" USING btree ("recipient_id","occurrence_id","generation","id");--> statement-breakpoint
CREATE INDEX "activity_email_candidates_tenant_occurrence_idx" ON "activity_email_candidates" USING btree ("organization_id","recipient_id","occurrence_id","generation","id");--> statement-breakpoint
CREATE INDEX "activity_email_occurrences_superseded_idx" ON "activity_email_occurrences" USING btree ("recipient_id","cadence","local_date","batch_number") WHERE "activity_email_occurrences"."state" = 'superseded';--> statement-breakpoint
CREATE POLICY "activity_email_authorization_attempts_tenant_isolation" ON "activity_email_authorization_attempts" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');--> statement-breakpoint
CREATE POLICY "activity_email_candidates_tenant_isolation" ON "activity_email_candidates" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');--> statement-breakpoint
CREATE POLICY "activity_email_occurrences_system_access" ON "activity_email_occurrences" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.system_access', true) = 'on') WITH CHECK (current_setting('app.system_access', true) = 'on');
