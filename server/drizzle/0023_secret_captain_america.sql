CREATE TABLE "identity_provider_deletion_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" integer NOT NULL,
	"candidate_id" uuid,
	"provider" text NOT NULL,
	"provider_subject_ref" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"queued_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "identity_provider_deletion_outbox_candidate_unique" UNIQUE("candidate_id"),
	CONSTRAINT "identity_provider_deletion_outbox_provider_check" CHECK ("identity_provider_deletion_outbox"."provider" IN ('customers_ai', 'rb2b')),
	CONSTRAINT "identity_provider_deletion_outbox_status_check" CHECK ("identity_provider_deletion_outbox"."status" IN ('pending', 'queued', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "identity_provider_deletion_outbox_status_idx" ON "identity_provider_deletion_outbox" USING btree ("status","created_at");