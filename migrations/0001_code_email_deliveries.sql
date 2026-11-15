CREATE TABLE "code_email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_id" uuid NOT NULL,
	"code_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"language" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"skip_reason" text,
	"sent_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_email_deliveries_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "code_email_deliveries_purpose_check" CHECK ("code_email_deliveries"."purpose" in ('email-verification', 'sign-in', 'email-change')),
	CONSTRAINT "code_email_deliveries_status_check" CHECK ("code_email_deliveries"."status" in ('queued', 'sent', 'skipped', 'failed')),
	CONSTRAINT "code_email_deliveries_skip_reason_check" CHECK (("code_email_deliveries"."status" = 'skipped') = ("code_email_deliveries"."skip_reason" is not null) and ("code_email_deliveries"."skip_reason" is null or "code_email_deliveries"."skip_reason" in ('expired', 'purpose-not-supported'))),
	CONSTRAINT "code_email_deliveries_sent_at_check" CHECK (("code_email_deliveries"."status" = 'sent') = ("code_email_deliveries"."sent_at" is not null)),
	CONSTRAINT "code_email_deliveries_validity_check" CHECK ("code_email_deliveries"."expires_at" > "code_email_deliveries"."issued_at")
);
--> statement-breakpoint
ALTER TABLE "code_email_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pending_code_emails" (
	"delivery_id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"recipient_email" text NOT NULL,
	"recipient_name" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_code_emails_code_check" CHECK ("pending_code_emails"."code" ~ '^[0-9]{6}$')
);
--> statement-breakpoint
ALTER TABLE "pending_code_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pending_code_emails" ADD CONSTRAINT "pending_code_emails_delivery_id_code_email_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."code_email_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "code_email_deliveries_queued_expires_at_index" ON "code_email_deliveries" USING btree ("expires_at") WHERE "code_email_deliveries"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "pending_code_emails_expires_at_index" ON "pending_code_emails" USING btree ("expires_at");--> statement-breakpoint
CREATE POLICY "code_email_deliveries_system_access" ON "code_email_deliveries" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.system_access', true) = 'on') WITH CHECK (current_setting('app.system_access', true) = 'on');--> statement-breakpoint
CREATE POLICY "pending_code_emails_system_access" ON "pending_code_emails" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.system_access', true) = 'on') WITH CHECK (current_setting('app.system_access', true) = 'on');--> statement-breakpoint
-- Added by hand: drizzle-kit enables row-level security but does not force it, and without FORCE the
-- owner of a table (the migrator role) would bypass its policy. Both tables hold no organization:
-- their policies admit the system runner of the kit only, so no tenant transaction ever reads a
-- code or an address.
ALTER TABLE "code_email_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pending_code_emails" FORCE ROW LEVEL SECURITY;
