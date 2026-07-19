import { FastifyReply, FastifyRequest } from "fastify";
import { siteConfig } from "../../lib/siteConfig.js";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";

export async function deleteSite(request: FastifyRequest<{ Params: { siteId: string } }>, reply: FastifyReply) {
  const { siteId: id } = request.params;
  const siteId = Number(id);

  const analyticsTables = [
    "events",
    "bot_events",
    "session_replay_events",
    "session_replay_metadata",
    "hourly_events_by_site_mv_target",
    "sessions_mv_target",
    "overview_hourly_mv_target",
    "pathname_hourly_mv_target",
    "country_hourly_mv_target",
    "device_type_hourly_mv_target",
    "session_hourly_mv_target",
  ] as const;

  try {
    // Delete analytics first. If configuration deletion then fails, the site
    // remains visible and the operator can retry. We never claim success while
    // retaining analytics that the user explicitly asked us to delete.
    await Promise.all(
      analyticsTables.map(table =>
        clickhouse.command({
          query: `ALTER TABLE IF EXISTS ${table} DELETE WHERE site_id = {siteId:UInt32}`,
          query_params: { siteId },
          clickhouse_settings: { mutations_sync: "2" },
        })
      )
    );
    await siteConfig.removeSite(siteId);
  } catch (error) {
    request.log.error({ error, siteId }, "Failed to delete site and its analytics data");
    return reply.status(500).send({ error: "Failed to delete site" });
  }

  return reply.status(200).send({ success: true });
}
