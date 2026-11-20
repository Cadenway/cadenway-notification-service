CREATE TABLE "reminder_generations" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "reminder_generations_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "reminder_generations_nonnegative_check" CHECK ("reminder_generations"."generation" >= 0)
);
--> statement-breakpoint
ALTER TABLE "reminder_generations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reminder_generations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "reminder_generations_organization_isolation" ON "reminder_generations" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');
