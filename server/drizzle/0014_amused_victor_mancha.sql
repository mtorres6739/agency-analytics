CREATE TABLE "twoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backupCodes" text NOT NULL,
	"userId" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"failedVerificationCount" integer DEFAULT 0 NOT NULL,
	"lockedUntil" timestamp,
	CONSTRAINT "twoFactor_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "twoFactorEnabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON "twoFactor" USING btree ("secret");--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_schedule_window_unique" UNIQUE("schedule_id","window_start","window_end");