CREATE INDEX IF NOT EXISTS "site_contact_receipts_submission_index" ON "site_contact_receipts" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_contact_submissions_sent_expiry_index" ON "site_contact_submissions" USING btree ("updated_at","id") WHERE "site_contact_submissions"."status" = 'sent';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_contact_submissions_undelivered_expiry_index" ON "site_contact_submissions" USING btree ("created_at","id") WHERE "site_contact_submissions"."status" in ('pending', 'failed');
