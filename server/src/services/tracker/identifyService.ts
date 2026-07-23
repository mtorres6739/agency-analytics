import { FastifyReply, FastifyRequest } from "fastify";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/postgres/postgres.js";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { userProfiles, userAliases } from "../../db/postgres/schema.js";
import { siteConfig } from "../../lib/siteConfig.js";
import { userIdService } from "../userId/userIdService.js";
import { resolveClientIp } from "./resolveClientIp.js";
import { createServiceLogger } from "../../lib/logger/logger.js";
import { getIdentitySettingsRecord } from "../identity/identitySettingsService.js";
import { IdentityCryptoError, normalizeIdentityTraits } from "../identity/identityCrypto.js";

const logger = createServiceLogger("identify-service");

// Max traits size in bytes (2KB)
const MAX_TRAITS_SIZE = 2048;

// Validation schema for identify requests
const identifyPayloadSchema = z.object({
  site_id: z.string().min(1),
  anonymous_id: z.string().min(1).max(255).optional(),
  user_id: z.string().min(1).max(255),
  ip_address: z.string().ip().optional(),
  user_agent: z.string().max(512).optional(),
  traits: z
    .record(z.unknown())
    .optional()
    .refine(
      traits => {
        if (!traits) return true;
        const size = new TextEncoder().encode(JSON.stringify(traits)).length;
        return size <= MAX_TRAITS_SIZE;
      },
      { message: `Traits must be less than ${MAX_TRAITS_SIZE} bytes (2KB)` }
    ),
  is_new_identify: z.boolean().default(true),
});

// Backfill window limits partition scanning to recent data only.
// Anonymous events older than this are unlikely to belong to the identifying user.
const BACKFILL_DAYS = 30;

type IdentityPersistenceDatabase = Pick<typeof db, "insert" | "select" | "update">;

type PersistIdentifiedUserInput = {
  siteId: number;
  anonymousId: string;
  userId: string;
  traits?: Record<string, unknown>;
  isNewIdentify?: boolean;
  identitySource?: "direct" | "verified" | "dashboard" | "resolved";
};

// days: null backfills the device's full history — only for explicit admin
// actions (dashboard identify), where the operator asserts the whole history
// belongs to this user and the unbounded partition scan is a one-off.
export async function backfillIdentifiedUserId(
  siteId: number,
  anonymousId: string,
  userId: string,
  days: number | null = BACKFILL_DAYS
) {
  try {
    // session_replay_metadata has no `timestamp` column; its time column is
    // `start_time`. Using `timestamp` there throws ClickHouse error 47
    // (UNKNOWN_IDENTIFIER), so map each table to its actual time column.
    const tables: Array<{ name: string; timeColumn: string }> = [
      { name: "events", timeColumn: "timestamp" },
      { name: "session_replay_events", timeColumn: "timestamp" },
      { name: "session_replay_metadata", timeColumn: "start_time" },
    ];
    for (const { name, timeColumn } of tables) {
      await clickhouse.command({
        query: `ALTER TABLE ${name} UPDATE identified_user_id = {userId: String} WHERE site_id = {siteId: UInt16} AND user_id = {anonymousId: String} AND identified_user_id = ''${
          days !== null ? ` AND ${timeColumn} >= now() - INTERVAL {days: UInt16} DAY` : ""
        }`,
        query_params: { userId, siteId, anonymousId, ...(days !== null ? { days } : {}) },
      });
    }
    logger.info({ siteId, anonymousId, userId }, "Backfilled identified_user_id in ClickHouse");
  } catch (error) {
    logger.error({ siteId, anonymousId, userId, error }, "Error backfilling identified_user_id");
  }
}

export async function persistIdentifiedUser(
  input: PersistIdentifiedUserInput,
  options: { database?: IdentityPersistenceDatabase; deferBackfill?: boolean } = {}
) {
  const database = options.database ?? db;
  const { siteId, anonymousId, userId, traits, isNewIdentify = true, identitySource = "direct" } = input;
  const identifiedAt = new Date().toISOString();
  let backfillRequired = false;
  if (isNewIdentify) {
    await database
      .insert(userProfiles)
      .values({ siteId, userId, identitySource, lastIdentifiedAt: identifiedAt })
      .onConflictDoUpdate({
        target: [userProfiles.siteId, userProfiles.userId],
        set: { identitySource, lastIdentifiedAt: identifiedAt, updatedAt: sql`now()` },
      });
    const [existingAlias] = await database
      .select()
      .from(userAliases)
      .where(and(eq(userAliases.siteId, siteId), eq(userAliases.anonymousId, anonymousId)))
      .limit(1);

    if (!existingAlias) {
      await database.insert(userAliases).values({ siteId, anonymousId, userId }).onConflictDoNothing();
      backfillRequired = true;
    } else if (existingAlias.userId !== userId) {
      await database
        .update(userAliases)
        .set({ userId })
        .where(and(eq(userAliases.siteId, siteId), eq(userAliases.anonymousId, anonymousId)));
    }
  }

  if (traits && Object.keys(traits).length > 0) {
    const filteredTraits = Object.fromEntries(Object.entries(traits).filter(([, value]) => value !== null));
    const nullKeys = Object.entries(traits)
      .filter(([, value]) => value === null)
      .map(([key]) => key);
    const traitsExpr =
      nullKeys.length > 0
        ? sql`(${userProfiles.traits} - ${nullKeys}::text[]) || ${JSON.stringify(filteredTraits)}::jsonb`
        : sql`${userProfiles.traits} || ${JSON.stringify(filteredTraits)}::jsonb`;

    await database
      .insert(userProfiles)
      .values({ siteId, userId, traits: filteredTraits, identitySource, lastIdentifiedAt: identifiedAt })
      .onConflictDoUpdate({
        target: [userProfiles.siteId, userProfiles.userId],
        set: { traits: traitsExpr, identitySource, lastIdentifiedAt: identifiedAt, updatedAt: sql`now()` },
      });
  }
  if (backfillRequired && !options.deferBackfill) {
    void backfillIdentifiedUserId(siteId, anonymousId, userId);
  }
  return { backfillRequired };
}

export async function handleIdentify(request: FastifyRequest, reply: FastifyReply) {
  try {
    const validationResult = identifyPayloadSchema.safeParse(request.body);

    if (!validationResult.success) {
      return reply.status(400).send({
        success: false,
        error: "Invalid payload",
        details: validationResult.error.flatten(),
      });
    }

    const { site_id, anonymous_id, user_id, traits, is_new_identify, ip_address, user_agent } = validationResult.data;

    // Get site configuration
    const siteConfiguration = await siteConfig.getConfig(site_id);
    if (!siteConfiguration) {
      return reply.status(404).send({
        success: false,
        error: "Site not found",
      });
    }

    const siteId = siteConfiguration.siteId;
    const { settings } = await getIdentitySettingsRecord(siteId);
    if (!settings?.enabled || settings.mode !== "direct") {
      return reply.status(403).send({
        success: false,
        error: "Direct identity is disabled for this site",
        code: "IDENTITY_DISABLED",
      });
    }

    const anonymousId = anonymous_id
      ? await userIdService.generateUserIdFromClientId(anonymous_id, siteId)
      : await userIdService.generateUserId(
          ip_address || resolveClientIp(request),
          user_agent || request.headers["user-agent"] || "",
          siteId
        );

    let allowedTraits: Record<string, unknown> | undefined;
    if (traits) {
      const normalized = normalizeIdentityTraits(traits);
      const allowlist = new Set(settings.allowedTraits);
      allowedTraits = Object.fromEntries(Object.entries(normalized).filter(([key]) => allowlist.has(key)));
    }

    await persistIdentifiedUser({
      siteId,
      anonymousId,
      userId: user_id,
      traits: allowedTraits,
      isNewIdentify: is_new_identify,
      identitySource: "direct",
    });

    return reply.status(200).send({
      success: true,
    });
  } catch (error) {
    if (error instanceof IdentityCryptoError) {
      return reply.status(400).send({ success: false, error: error.message, code: error.code });
    }
    logger.error(error, "Error handling identify");
    return reply.status(500).send({
      success: false,
      error: "Failed to process identify",
    });
  }
}
