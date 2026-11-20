CREATE TABLE "inbox_delivery_authorization_attempts" (
	"organization_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"kind" text NOT NULL,
	"task_key" text NOT NULL,
	"comment_id" uuid,
	"status" text,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_delivery_authorization_attempts_pkey" PRIMARY KEY("organization_id","id"),
	CONSTRAINT "inbox_delivery_attempts_source_recipient_unique" UNIQUE("organization_id","recipient_id","source_event_id"),
	CONSTRAINT "inbox_delivery_attempts_outcome_check" CHECK ("inbox_delivery_authorization_attempts"."outcome" in ('pending', 'permitted', 'denied', 'expired')),
	CONSTRAINT "inbox_delivery_attempts_kind_check" CHECK ("inbox_delivery_authorization_attempts"."kind" in ('assignment', 'comment', 'mention', 'status-change', 'approval', 'access')),
	CONSTRAINT "inbox_delivery_attempts_distinct_actor_check" CHECK ("inbox_delivery_authorization_attempts"."actor_user_id" is distinct from "inbox_delivery_authorization_attempts"."recipient_id"),
	CONSTRAINT "inbox_delivery_attempts_deadline_check" CHECK ("inbox_delivery_authorization_attempts"."expires_at" > "inbox_delivery_authorization_attempts"."created_at")
);
--> statement-breakpoint
ALTER TABLE "inbox_delivery_authorization_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inbox_delivery_authorization_attempts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbox_generations" (
	"organization_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "inbox_generations_organization_id_recipient_id_pk" PRIMARY KEY("organization_id","recipient_id"),
	CONSTRAINT "inbox_generations_nonnegative_check" CHECK ("inbox_generations"."generation" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inbox_generations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inbox_generations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbox_notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_user_id" uuid,
	"subject_kind" text,
	"subject_value" text,
	"comment_id" uuid,
	"status" text,
	"creation_generation" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	"read_at" timestamp (3) with time zone,
	"archived_at" timestamp (3) with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "inbox_notifications_source_recipient_unique" UNIQUE("organization_id","recipient_id","source_event_id"),
	CONSTRAINT "inbox_notifications_version_check" CHECK ("inbox_notifications"."version" >= 1),
	CONSTRAINT "inbox_notifications_generation_check" CHECK ("inbox_notifications"."creation_generation" >= 1),
	CONSTRAINT "inbox_notifications_subject_check" CHECK ((("inbox_notifications"."subject_kind" is null and "inbox_notifications"."subject_value" is null)
        or ("inbox_notifications"."subject_kind" = 'task-key' and "inbox_notifications"."subject_value" ~ '^[A-Z]{2,5}-[1-9][0-9]{0,8}$')
        or ("inbox_notifications"."subject_kind" in ('task-id', 'space', 'list') and "inbox_notifications"."subject_value" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) is true),
	CONSTRAINT "inbox_notifications_time_check" CHECK ("inbox_notifications"."updated_at" >= "inbox_notifications"."created_at" and ("inbox_notifications"."read_at" is null or "inbox_notifications"."read_at" >= "inbox_notifications"."created_at") and ("inbox_notifications"."archived_at" is null or "inbox_notifications"."archived_at" >= "inbox_notifications"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "inbox_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inbox_notifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"channels" jsonb NOT NULL,
	"digest" text NOT NULL,
	"do_not_disturb" boolean NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_digest_check" CHECK ("notification_preferences"."digest" in ('each', 'daily', 'weekly', 'never')),
	CONSTRAINT "notification_preferences_version_check" CHECK ("notification_preferences"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reminder_authorization_attempts" (
	"organization_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"reminder_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"reminder_version" integer NOT NULL,
	"schedule_version" integer NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"status" text NOT NULL,
	"current" boolean DEFAULT true NOT NULL,
	CONSTRAINT "reminder_authorization_attempts_pkey" PRIMARY KEY("organization_id","id"),
	CONSTRAINT "reminder_authorization_attempts_status_check" CHECK ("reminder_authorization_attempts"."status" in ('pending', 'permitted', 'denied', 'expired')),
	CONSTRAINT "reminder_authorization_attempts_version_check" CHECK ("reminder_authorization_attempts"."schedule_version" >= 1 and "reminder_authorization_attempts"."reminder_version" >= "reminder_authorization_attempts"."schedule_version")
);
--> statement-breakpoint
ALTER TABLE "reminder_authorization_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reminder_authorization_attempts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reminders" (
	"organization_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	"remind_at" timestamp (3) with time zone NOT NULL,
	"note" text,
	"fired_at" timestamp (3) with time zone,
	"completed_at" timestamp (3) with time zone,
	"version" integer NOT NULL,
	"schedule_version" integer NOT NULL,
	CONSTRAINT "reminders_pkey" PRIMARY KEY("organization_id","id"),
	CONSTRAINT "reminders_version_check" CHECK ("reminders"."schedule_version" >= 1 and "reminders"."version" >= "reminders"."schedule_version"),
	CONSTRAINT "reminders_time_check" CHECK ("reminders"."remind_at" > "reminders"."created_at" and ("reminders"."fired_at" is null or "reminders"."fired_at" >= "reminders"."remind_at") and ("reminders"."completed_at" is null or "reminders"."completed_at" >= coalesce("reminders"."fired_at", "reminders"."created_at"))),
	CONSTRAINT "reminders_note_check" CHECK ("reminders"."note" is null or char_length("reminders"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reminders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reminder_authorization_attempts" ADD CONSTRAINT "reminder_authorization_attempts_reminder_fkey" FOREIGN KEY ("organization_id","reminder_id") REFERENCES "public"."reminders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_notifications_recipient_page_index" ON "inbox_notifications" USING btree ("organization_id","recipient_id","created_at","id");--> statement-breakpoint
CREATE INDEX "inbox_notifications_unread_page_index" ON "inbox_notifications" USING btree ("organization_id","recipient_id","created_at","id") WHERE "inbox_notifications"."read_at" is null and "inbox_notifications"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "inbox_notifications_archived_page_index" ON "inbox_notifications" USING btree ("organization_id","recipient_id","created_at","id") WHERE "inbox_notifications"."archived_at" is not null;--> statement-breakpoint
CREATE INDEX "inbox_notifications_unread_subject_index" ON "inbox_notifications" USING btree ("organization_id","recipient_id","subject_kind","subject_value") WHERE "inbox_notifications"."read_at" is null and "inbox_notifications"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_authorization_attempts_current_unique" ON "reminder_authorization_attempts" USING btree ("organization_id","reminder_id") WHERE "reminder_authorization_attempts"."current";--> statement-breakpoint
CREATE INDEX "reminder_authorization_attempts_expiry_index" ON "reminder_authorization_attempts" USING btree ("organization_id","expires_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_pending_task_unique" ON "reminders" USING btree ("organization_id","user_id","task_id") WHERE "reminders"."completed_at" is null;--> statement-breakpoint
CREATE INDEX "reminders_owner_page_index" ON "reminders" USING btree ("organization_id","user_id","remind_at","id");--> statement-breakpoint
CREATE POLICY "inbox_delivery_attempts_organization_isolation" ON "inbox_delivery_authorization_attempts" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');--> statement-breakpoint
CREATE POLICY "inbox_generations_organization_isolation" ON "inbox_generations" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');--> statement-breakpoint
CREATE POLICY "inbox_notifications_organization_isolation" ON "inbox_notifications" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');--> statement-breakpoint
CREATE POLICY "notification_preferences_system_access" ON "notification_preferences" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.system_access', true) = 'on') WITH CHECK (current_setting('app.system_access', true) = 'on');--> statement-breakpoint
CREATE POLICY "reminder_authorization_attempts_organization_isolation" ON "reminder_authorization_attempts" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');--> statement-breakpoint
CREATE POLICY "reminders_organization_isolation" ON "reminders" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');
