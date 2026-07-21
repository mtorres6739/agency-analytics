CREATE TABLE "identity_activation_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" integer NOT NULL,
	"candidate_id" uuid NOT NULL,
	"reviewer_id" text,
	"decision" text NOT NULL,
	"crm_status" text,
	"crm_contact_id" text,
	"sanitized_result" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "identity_activation_reviews_decision_check" CHECK ("identity_activation_reviews"."decision" IN ('approved', 'rejected', 'suppressed', 'sent_to_crm'))
);
--> statement-breakpoint
CREATE TABLE "identity_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" integer NOT NULL,
	"anonymous_subject" text NOT NULL,
	"provider" text NOT NULL,
	"provider_subject_key" text NOT NULL,
	"provider_request_id" text,
	"confidence" real NOT NULL,
	"match_method" text NOT NULL,
	"traits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"linked_user_id" text,
	"crm_contact_id" text,
	"expires_at" timestamp NOT NULL,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "identity_candidates_site_provider_subject_unique" UNIQUE("site_id","provider","provider_subject_key"),
	CONSTRAINT "identity_candidates_provider_check" CHECK ("identity_candidates"."provider" IN ('customers_ai', 'rb2b')),
	CONSTRAINT "identity_candidates_match_method_check" CHECK ("identity_candidates"."match_method" IN ('deterministic', 'probabilistic')),
	CONSTRAINT "identity_candidates_review_status_check" CHECK ("identity_candidates"."review_status" IN ('pending', 'approved', 'rejected', 'suppressed', 'expired')),
	CONSTRAINT "identity_candidates_confidence_check" CHECK ("identity_candidates"."confidence" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "identity_consent_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" integer NOT NULL,
	"anonymous_subject" text NOT NULL,
	"policy_version" text NOT NULL,
	"permitted_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"region" text,
	"gpc" boolean DEFAULT false NOT NULL,
	"granted" boolean DEFAULT false NOT NULL,
	"granted_at" timestamp,
	"withdrawn_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"credential_ref" text,
	"policy_approved_at" timestamp,
	"last_health_check_at" timestamp,
	"last_health_status" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "identity_provider_connections_org_provider_unique" UNIQUE("organization_id","provider"),
	CONSTRAINT "identity_provider_connections_provider_check" CHECK ("identity_provider_connections"."provider" IN ('customers_ai', 'rb2b', 'pdl')),
	CONSTRAINT "identity_provider_connections_status_check" CHECK ("identity_provider_connections"."status" IN ('pending', 'approved', 'disabled', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "identity_provider_usage" (
	"site_id" integer NOT NULL,
	"provider" text NOT NULL,
	"usage_date" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"matches" integer DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"total_latency_ms" integer DEFAULT 0 NOT NULL,
	"estimated_cost_micros" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "identity_provider_usage_site_id_provider_usage_date_pk" PRIMARY KEY("site_id","provider","usage_date"),
	CONSTRAINT "identity_provider_usage_provider_check" CHECK ("identity_provider_usage"."provider" IN ('customers_ai', 'rb2b', 'pdl'))
);
--> statement-breakpoint
CREATE TABLE "identity_resolution_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" integer NOT NULL,
	"anonymous_subject" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"confidence" real,
	"provider_request_id" text,
	"estimated_cost_micros" integer DEFAULT 0 NOT NULL,
	"rejection_code" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "identity_resolution_attempts_provider_check" CHECK ("identity_resolution_attempts"."provider" IN ('customers_ai', 'rb2b')),
	CONSTRAINT "identity_resolution_attempts_status_check" CHECK ("identity_resolution_attempts"."status" IN ('queued', 'matched', 'no_match', 'blocked', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "identity_suppressions" (
	"site_id" integer NOT NULL,
	"suppression_key" text NOT NULL,
	"reason" text DEFAULT 'withdrawn' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "identity_suppressions_site_id_suppression_key_pk" PRIMARY KEY("site_id","suppression_key")
);
--> statement-breakpoint
CREATE TABLE "site_resolution_settings" (
	"site_id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"mode" text DEFAULT 'consumer' NOT NULL,
	"primary_provider" text DEFAULT 'customers_ai' NOT NULL,
	"enrichment_provider" text,
	"enrichment_enabled" boolean DEFAULT false NOT NULL,
	"shadow_mode" boolean DEFAULT true NOT NULL,
	"deterministic_threshold" real DEFAULT 0.95 NOT NULL,
	"enrichment_threshold" real DEFAULT 0.8 NOT NULL,
	"daily_cap" integer DEFAULT 100 NOT NULL,
	"monthly_budget_cents" integer DEFAULT 75000 NOT NULL,
	"compliance_state" text DEFAULT 'pending' NOT NULL,
	"policy_version" text DEFAULT 'identity-v1' NOT NULL,
	"allowed_traits" jsonb DEFAULT '["name","email","company","title","linkedinUrl","location"]'::jsonb NOT NULL,
	"phone_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "site_resolution_settings_mode_check" CHECK ("site_resolution_settings"."mode" IN ('consumer', 'business')),
	CONSTRAINT "site_resolution_settings_primary_provider_check" CHECK ("site_resolution_settings"."primary_provider" IN ('customers_ai', 'rb2b')),
	CONSTRAINT "site_resolution_settings_enrichment_provider_check" CHECK ("site_resolution_settings"."enrichment_provider" IS NULL OR "site_resolution_settings"."enrichment_provider" = 'pdl'),
	CONSTRAINT "site_resolution_settings_compliance_check" CHECK ("site_resolution_settings"."compliance_state" IN ('pending', 'approved', 'blocked')),
	CONSTRAINT "site_resolution_settings_thresholds_check" CHECK ("site_resolution_settings"."deterministic_threshold" BETWEEN 0 AND 1 AND "site_resolution_settings"."enrichment_threshold" BETWEEN 0 AND 1),
	CONSTRAINT "site_resolution_settings_caps_check" CHECK ("site_resolution_settings"."daily_cap" >= 0 AND "site_resolution_settings"."monthly_budget_cents" BETWEEN 0 AND 75000),
	CONSTRAINT "site_resolution_settings_phone_disabled_check" CHECK ("site_resolution_settings"."phone_enabled" = false)
);
--> statement-breakpoint
ALTER TABLE "identity_activation_reviews" ADD CONSTRAINT "identity_activation_reviews_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_activation_reviews" ADD CONSTRAINT "identity_activation_reviews_candidate_id_identity_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."identity_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_activation_reviews" ADD CONSTRAINT "identity_activation_reviews_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_candidates" ADD CONSTRAINT "identity_candidates_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_consent_receipts" ADD CONSTRAINT "identity_consent_receipts_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_provider_connections" ADD CONSTRAINT "identity_provider_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_provider_usage" ADD CONSTRAINT "identity_provider_usage_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_resolution_attempts" ADD CONSTRAINT "identity_resolution_attempts_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_suppressions" ADD CONSTRAINT "identity_suppressions_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_resolution_settings" ADD CONSTRAINT "site_resolution_settings_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_activation_reviews_candidate_idx" ON "identity_activation_reviews" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "identity_candidates_site_status_idx" ON "identity_candidates" USING btree ("site_id","review_status","created_at");--> statement-breakpoint
CREATE INDEX "identity_consent_receipts_site_subject_idx" ON "identity_consent_receipts" USING btree ("site_id","anonymous_subject");--> statement-breakpoint
CREATE INDEX "identity_consent_receipts_created_idx" ON "identity_consent_receipts" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "identity_resolution_attempts_site_started_idx" ON "identity_resolution_attempts" USING btree ("site_id","started_at");--> statement-breakpoint
CREATE INDEX "identity_resolution_attempts_subject_idx" ON "identity_resolution_attempts" USING btree ("site_id","anonymous_subject");