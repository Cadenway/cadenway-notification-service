CREATE TABLE "site_contact_receipts" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"submission_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_contact_receipts_key_hash_check" CHECK ("site_contact_receipts"."key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "site_contact_receipts_fingerprint_check" CHECK ("site_contact_receipts"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "site_contact_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_contact_submissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reply_to" text NOT NULL,
	"subject" text NOT NULL,
	"message" json NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_contact_submissions_subject_check" CHECK ("site_contact_submissions"."subject" in ('login', 'mfa', 'org', 'data', 'other')),
	CONSTRAINT "site_contact_submissions_status_check" CHECK ("site_contact_submissions"."status" in ('pending', 'sent', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "site_contact_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_newsletter_subscriptions" (
	"mailbox" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'subscribed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_newsletter_subscriptions_mailbox_check" CHECK (length("site_newsletter_subscriptions"."mailbox") between 3 and 254),
	CONSTRAINT "site_newsletter_subscriptions_status_check" CHECK ("site_newsletter_subscriptions"."status" in ('subscribed', 'unsubscribed', 'suppressed'))
);
--> statement-breakpoint
ALTER TABLE "site_newsletter_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "site_contact_receipts" ADD CONSTRAINT "site_contact_receipts_submission_id_site_contact_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."site_contact_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_contact_receipts_expiration_index" ON "site_contact_receipts" USING btree ("expires_at");--> statement-breakpoint
CREATE POLICY "site_contact_receipts_system_access" ON "site_contact_receipts" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.system_access', true) = 'on') WITH CHECK (current_setting('app.system_access', true) = 'on');--> statement-breakpoint
CREATE POLICY "site_contact_submissions_system_access" ON "site_contact_submissions" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.system_access', true) = 'on') WITH CHECK (current_setting('app.system_access', true) = 'on');--> statement-breakpoint
CREATE POLICY "site_newsletter_subscriptions_system_access" ON "site_newsletter_subscriptions" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.system_access', true) = 'on') WITH CHECK (current_setting('app.system_access', true) = 'on');--> statement-breakpoint
-- Drizzle enables RLS but does not force it for table owners.
ALTER TABLE "site_contact_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "site_contact_submissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "site_newsletter_subscriptions" FORCE ROW LEVEL SECURITY;
