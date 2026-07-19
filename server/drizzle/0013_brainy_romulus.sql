ALTER TABLE "import_status" DROP CONSTRAINT "import_status_site_id_sites_site_id_fk";
--> statement-breakpoint
ALTER TABLE "import_status" ADD CONSTRAINT "import_status_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE cascade ON UPDATE no action;