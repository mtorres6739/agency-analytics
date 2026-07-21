CREATE TABLE "site_identity_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"version" integer NOT NULL,
	"encrypted_secret" text NOT NULL,
	"initialization_vector" text NOT NULL,
	"auth_tag" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"deployment_provider" text,
	"deployment_project" text,
	"deployment_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deployed_at" timestamp,
	"retired_at" timestamp,
	"revoked_at" timestamp,
	"last_used_at" timestamp,
	CONSTRAINT "site_identity_keys_site_version_unique" UNIQUE("site_id","version"),
	CONSTRAINT "site_identity_keys_status_check" CHECK ("site_identity_keys"."status" IN ('pending', 'active', 'retired', 'revoked')),
	CONSTRAINT "site_identity_keys_version_check" CHECK ("site_identity_keys"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "site_identity_settings" (
	"site_id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"mode" text DEFAULT 'signed' NOT NULL,
	"allowed_traits" jsonb DEFAULT '["name","email","company","plan"]'::jsonb NOT NULL,
	"retention_days" integer DEFAULT 395 NOT NULL,
	"active_key_id" text,
	"last_success_at" timestamp,
	"last_failure_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "site_identity_settings_mode_check" CHECK ("site_identity_settings"."mode" IN ('signed', 'direct')),
	CONSTRAINT "site_identity_settings_retention_check" CHECK ("site_identity_settings"."retention_days" BETWEEN 1 AND 3650)
);
--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "identity_source" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "last_identified_at" timestamp;--> statement-breakpoint
ALTER TABLE "site_identity_keys" ADD CONSTRAINT "site_identity_keys_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_identity_settings" ADD CONSTRAINT "site_identity_settings_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_identity_keys_site_status_idx" ON "site_identity_keys" USING btree ("site_id","status");