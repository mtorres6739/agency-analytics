import * as cron from "node-cron";
import { sql } from "drizzle-orm";
import { db } from "../../db/postgres/postgres.js";
import { createServiceLogger } from "../../lib/logger/logger.js";

class IdentityRetentionService {
  private task: cron.ScheduledTask | null = null;
  private readonly logger = createServiceLogger("identity-retention");

  async run() {
    const result = await db.execute<{ deleted_profiles: number }>(sql`
      WITH expired AS (
        SELECT p.site_id, p.user_id
        FROM user_profiles p
        INNER JOIN site_identity_settings s ON s.site_id = p.site_id
        WHERE p.updated_at < now() - make_interval(days => s.retention_days)
      ), deleted_aliases AS (
        DELETE FROM user_aliases a
        USING expired e
        WHERE a.site_id = e.site_id AND a.user_id = e.user_id
      ), deleted_profiles AS (
        DELETE FROM user_profiles p
        USING expired e
        WHERE p.site_id = e.site_id AND p.user_id = e.user_id
        RETURNING 1
      )
      SELECT count(*)::int AS deleted_profiles FROM deleted_profiles
    `);
    const count = Number(result[0]?.deleted_profiles ?? 0);
    await Promise.all([
      db.execute(sql`DELETE FROM identity_candidates WHERE expires_at < now()`),
      db.execute(sql`DELETE FROM identity_resolution_attempts WHERE started_at < now() - interval '395 days'`),
      db.execute(sql`
        DELETE FROM identity_consent_receipts
        WHERE created_at < now() - interval '395 days' AND (granted = false OR withdrawn_at IS NOT NULL)
      `),
      db.execute(
        sql`DELETE FROM identity_provider_usage WHERE usage_date < to_char(now() - interval '395 days', 'YYYY-MM-DD')`
      ),
    ]);
    if (count > 0) this.logger.info({ count }, "Expired identified profiles deleted");
    return count;
  }

  start() {
    if (this.task) return;
    this.task = cron.schedule(
      "17 3 * * *",
      () => void this.run().catch(error => this.logger.error({ error }, "Identity retention job failed")),
      { timezone: "UTC" }
    );
  }
}

export const identityRetentionService = new IdentityRetentionService();
