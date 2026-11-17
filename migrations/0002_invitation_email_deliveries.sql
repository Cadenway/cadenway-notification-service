CREATE TABLE "invitation_email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"invitation_version" integer NOT NULL,
	"role" text NOT NULL,
	"language" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"skip_reason" text,
	"sent_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_email_deliveries_organization_id_event_id_unique" UNIQUE("organization_id","event_id"),
	CONSTRAINT "invitation_email_deliveries_invitation_version_check" CHECK ("invitation_email_deliveries"."invitation_version" >= 1),
	CONSTRAINT "invitation_email_deliveries_role_check" CHECK ("invitation_email_deliveries"."role" in ('admin', 'member', 'guest')),
	CONSTRAINT "invitation_email_deliveries_status_check" CHECK ("invitation_email_deliveries"."status" in ('queued', 'sent', 'skipped', 'failed')),
	CONSTRAINT "invitation_email_deliveries_skip_reason_check" CHECK (("invitation_email_deliveries"."status" = 'skipped') = ("invitation_email_deliveries"."skip_reason" is not null) and ("invitation_email_deliveries"."skip_reason" is null or "invitation_email_deliveries"."skip_reason" in ('expired', 'superseded'))),
	CONSTRAINT "invitation_email_deliveries_sent_at_check" CHECK (("invitation_email_deliveries"."status" = 'sent') = ("invitation_email_deliveries"."sent_at" is not null)),
	CONSTRAINT "invitation_email_deliveries_validity_check" CHECK ("invitation_email_deliveries"."expires_at" > "invitation_email_deliveries"."issued_at" and "invitation_email_deliveries"."expires_at" <= "invitation_email_deliveries"."issued_at" + interval '8 days')
);
--> statement-breakpoint
ALTER TABLE "invitation_email_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pending_invitation_emails" (
	"delivery_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"inviter_name" text NOT NULL,
	"organization_name" text NOT NULL,
	"member_count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_invitation_emails_member_count_check" CHECK ("pending_invitation_emails"."member_count" >= 1)
);
--> statement-breakpoint
ALTER TABLE "pending_invitation_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pending_invitation_emails" ADD CONSTRAINT "pending_invitation_emails_delivery_id_invitation_email_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."invitation_email_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_email_deliveries_invitation_index" ON "invitation_email_deliveries" USING btree ("organization_id","invitation_id");--> statement-breakpoint
CREATE INDEX "invitation_email_deliveries_queued_expires_at_index" ON "invitation_email_deliveries" USING btree ("expires_at") WHERE "invitation_email_deliveries"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "pending_invitation_emails_expires_at_index" ON "pending_invitation_emails" USING btree ("expires_at");--> statement-breakpoint
CREATE POLICY "invitation_email_deliveries_organization_isolation" ON "invitation_email_deliveries" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');--> statement-breakpoint
CREATE POLICY "pending_invitation_emails_organization_isolation" ON "pending_invitation_emails" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');--> statement-breakpoint
-- Added by hand: drizzle-kit enables row-level security but does not force it, and without FORCE the
-- owner of a table (the migrator role) would bypass its policy. Both tables belong to the
-- organization of their invitation: the organization policy of the kit admits its tenant
-- transactions and the system runner of the hourly sweep only.
ALTER TABLE "invitation_email_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pending_invitation_emails" FORCE ROW LEVEL SECURITY;
