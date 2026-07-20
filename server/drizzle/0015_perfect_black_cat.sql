CREATE TABLE "tracking_deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"client_id" text NOT NULL,
	"site_id" integer NOT NULL,
	"provider" text NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_summary" text,
	"actor_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	CONSTRAINT "tracking_deployments_provider_check" CHECK ("tracking_deployments"."provider" IN ('cloudflare', 'vercel', 'wordpress', 'manual')),
	CONSTRAINT "tracking_deployments_action_check" CHECK ("tracking_deployments"."action" IN ('plan', 'apply', 'status', 'rollback')),
	CONSTRAINT "tracking_deployments_status_check" CHECK ("tracking_deployments"."status" IN ('queued', 'running', 'succeeded', 'failed', 'blocked'))
);
--> statement-breakpoint
ALTER TABLE "tracking_deployments" ADD CONSTRAINT "tracking_deployments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_deployments" ADD CONSTRAINT "tracking_deployments_client_id_agency_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."agency_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_deployments" ADD CONSTRAINT "tracking_deployments_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_deployments" ADD CONSTRAINT "tracking_deployments_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tracking_deployments_site_created_idx" ON "tracking_deployments" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "tracking_deployments_client_idx" ON "tracking_deployments" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "tracking_deployments_status_idx" ON "tracking_deployments" USING btree ("status");