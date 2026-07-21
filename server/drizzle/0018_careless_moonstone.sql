ALTER TABLE "identity_candidates" ADD COLUMN "icp_score" integer;--> statement-breakpoint
ALTER TABLE "identity_candidates" ADD COLUMN "ai_brief" text;--> statement-breakpoint
ALTER TABLE "identity_candidates" ADD COLUMN "brief_generated_at" timestamp;--> statement-breakpoint
ALTER TABLE "site_resolution_settings" ADD COLUMN "icp_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL;