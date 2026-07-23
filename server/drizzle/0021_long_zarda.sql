ALTER TABLE "identity_activation_reviews" DROP CONSTRAINT "identity_activation_reviews_candidate_id_identity_candidates_id_fk";
--> statement-breakpoint
ALTER TABLE "identity_activation_reviews" ALTER COLUMN "candidate_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_activation_reviews" ADD CONSTRAINT "identity_activation_reviews_candidate_id_identity_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."identity_candidates"("id") ON DELETE set null ON UPDATE no action;