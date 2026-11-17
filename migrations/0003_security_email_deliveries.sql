CREATE TABLE "pending_security_emails" (
	"delivery_id" uuid PRIMARY KEY NOT NULL,
	"recipient_email" text NOT NULL,
	"recipient_name" text NOT NULL,
	"time_zone" text NOT NULL,
	"details" jsonb NOT NULL,
	"token" text,
	"send_before" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_security_emails_token_check" CHECK ("pending_security_emails"."token" is null or "pending_security_emails"."token" ~ '^[A-Za-z0-9_-]{32,128}$')
);
--> statement-breakpoint
ALTER TABLE "pending_security_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "security_email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"template" text NOT NULL,
	"language" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"send_before" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"skip_reason" text,
	"sent_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_email_deliveries_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "security_email_deliveries_template_check" CHECK ("security_email_deliveries"."template" in ('password-reset', 'password-changed', 'email-changed', 'new-device', 'deletion-scheduled', 'deletion-cancelled')),
	CONSTRAINT "security_email_deliveries_status_check" CHECK ("security_email_deliveries"."status" in ('queued', 'sent', 'skipped', 'failed')),
	CONSTRAINT "security_email_deliveries_skip_reason_check" CHECK (("security_email_deliveries"."status" = 'skipped') = ("security_email_deliveries"."skip_reason" is not null) and ("security_email_deliveries"."skip_reason" is null or "security_email_deliveries"."skip_reason" in ('expired'))),
	CONSTRAINT "security_email_deliveries_sent_at_check" CHECK (("security_email_deliveries"."status" = 'sent') = ("security_email_deliveries"."sent_at" is not null)),
	CONSTRAINT "security_email_deliveries_window_check" CHECK ("security_email_deliveries"."send_before" > "security_email_deliveries"."occurred_at" and "security_email_deliveries"."send_before" <= "security_email_deliveries"."occurred_at" + interval '1 day')
);
--> statement-breakpoint
ALTER TABLE "security_email_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pending_security_emails" ADD CONSTRAINT "pending_security_emails_delivery_id_security_email_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."security_email_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_security_emails_send_before_index" ON "pending_security_emails" USING btree ("send_before");--> statement-breakpoint
CREATE INDEX "security_email_deliveries_queued_send_before_index" ON "security_email_deliveries" USING btree ("send_before") WHERE "security_email_deliveries"."status" = 'queued';--> statement-breakpoint
CREATE POLICY "pending_security_emails_system_access" ON "pending_security_emails" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.system_access', true) = 'on') WITH CHECK (current_setting('app.system_access', true) = 'on');--> statement-breakpoint
CREATE POLICY "security_email_deliveries_system_access" ON "security_email_deliveries" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.system_access', true) = 'on') WITH CHECK (current_setting('app.system_access', true) = 'on');--> statement-breakpoint
-- Added by hand: drizzle-kit enables row-level security but does not force it, and without FORCE the
-- owner of a table (the migrator role) would bypass its policy. Both tables hold no organization:
-- their policies admit the system runner of the kit only, so no tenant transaction ever reads an
-- address, a device, an IP address or a reset token.
ALTER TABLE "security_email_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pending_security_emails" FORCE ROW LEVEL SECURITY;
