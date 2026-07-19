CREATE TABLE "agency_audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"client_id" text,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agency_client_sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"site_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"tracking_method" text DEFAULT 'script' NOT NULL,
	"tracking_status" text DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp,
	"last_checked_at" timestamp,
	CONSTRAINT "agency_client_sites_site_unique" UNIQUE("site_id"),
	CONSTRAINT "agency_client_sites_client_site_unique" UNIQUE("client_id","site_id"),
	CONSTRAINT "agency_client_sites_method_check" CHECK ("agency_client_sites"."tracking_method" IN ('script', 'gtm', 'cms', 'proxy')),
	CONSTRAINT "agency_client_sites_status_check" CHECK ("agency_client_sites"."tracking_status" IN ('pending', 'verified', 'stale', 'error'))
);
--> statement-breakpoint
CREATE TABLE "agency_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'onboarding' NOT NULL,
	"logo_url" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"external_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agency_clients_org_slug_unique" UNIQUE("organization_id","slug"),
	CONSTRAINT "agency_clients_team_unique" UNIQUE("team_id"),
	CONSTRAINT "agency_clients_status_check" CHECK ("agency_clients"."status" IN ('onboarding', 'active', 'paused', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "report_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "report_recipients_schedule_email_unique" UNIQUE("schedule_id","email")
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"artifact_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	CONSTRAINT "report_runs_status_check" CHECK ("report_runs"."status" IN ('queued', 'running', 'succeeded', 'failed')),
	CONSTRAINT "report_runs_window_check" CHECK ("report_runs"."window_end" > "report_runs"."window_start"),
	CONSTRAINT "report_runs_attempts_check" CHECK ("report_runs"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"cadence" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"weekday" integer,
	"day_of_month" integer,
	"send_hour" integer DEFAULT 8 NOT NULL,
	"site_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "report_schedules_cadence_check" CHECK ("report_schedules"."cadence" IN ('weekly', 'monthly')),
	CONSTRAINT "report_schedules_weekday_check" CHECK ("report_schedules"."weekday" IS NULL OR ("report_schedules"."weekday" BETWEEN 0 AND 6)),
	CONSTRAINT "report_schedules_day_check" CHECK ("report_schedules"."day_of_month" IS NULL OR ("report_schedules"."day_of_month" BETWEEN 1 AND 28)),
	CONSTRAINT "report_schedules_hour_check" CHECK ("report_schedules"."send_hour" BETWEEN 0 AND 23)
);
--> statement-breakpoint
ALTER TABLE "agency_audit_events" ADD CONSTRAINT "agency_audit_events_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_audit_events" ADD CONSTRAINT "agency_audit_events_client_id_agency_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."agency_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_audit_events" ADD CONSTRAINT "agency_audit_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_client_sites" ADD CONSTRAINT "agency_client_sites_client_id_agency_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."agency_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_client_sites" ADD CONSTRAINT "agency_client_sites_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_clients" ADD CONSTRAINT "agency_clients_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_clients" ADD CONSTRAINT "agency_clients_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_recipients" ADD CONSTRAINT "report_recipients_schedule_id_report_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."report_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_schedule_id_report_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."report_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_client_id_agency_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."agency_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agency_audit_events_org_created_idx" ON "agency_audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "agency_audit_events_client_idx" ON "agency_audit_events" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "agency_client_sites_client_idx" ON "agency_client_sites" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "agency_clients_org_idx" ON "agency_clients" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "report_recipients_schedule_idx" ON "report_recipients" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "report_runs_schedule_idx" ON "report_runs" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "report_runs_status_idx" ON "report_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "report_schedules_client_idx" ON "report_schedules" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "report_schedules_next_run_idx" ON "report_schedules" USING btree ("next_run_at");