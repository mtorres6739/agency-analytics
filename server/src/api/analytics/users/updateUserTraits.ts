import { FastifyReply, FastifyRequest } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db/postgres/postgres.js";
import { userProfiles } from "../../../db/postgres/schema.js";
import { auditSiteIdentityEvent } from "../../../services/identity/identityAuditService.js";
import {
  DEFAULT_IDENTITY_TRAITS,
  getIdentitySettingsRecord,
} from "../../../services/identity/identitySettingsService.js";

// Max traits size in bytes (2KB) — matches the tracker identify endpoint
const MAX_TRAITS_SIZE = 2048;

const updateUserTraitsBodySchema = z.object({
  traits: z
    .object({
      name: z.string().trim().min(1).max(255).optional(),
      email: z.string().trim().toLowerCase().email().max(320).optional(),
      company: z.string().trim().min(1).max(255).optional(),
      plan: z.string().trim().min(1).max(100).optional(),
    })
    .strict()
    .refine(
      traits => {
        const size = new TextEncoder().encode(JSON.stringify(traits)).length;
        return size <= MAX_TRAITS_SIZE;
      },
      { message: `Traits must be less than ${MAX_TRAITS_SIZE} bytes (2KB)` }
    ),
});

export interface UpdateUserTraitsRequest {
  Params: {
    siteId: string;
    userId: string;
  };
  Body: unknown;
}

/**
 * Replace a user's traits from the dashboard. Unlike the tracking script's
 * identify() (which merges), the dashboard editor submits the full set, so
 * the stored traits are replaced wholesale.
 */
export async function updateUserTraits(req: FastifyRequest<UpdateUserTraitsRequest>, res: FastifyReply) {
  const validationResult = updateUserTraitsBodySchema.safeParse(req.body);
  if (!validationResult.success) {
    return res.status(400).send({ error: "Invalid payload", details: validationResult.error.flatten() });
  }

  const { userId } = req.params;
  const siteId = Number(req.params.siteId);
  const { settings } = await getIdentitySettingsRecord(siteId);
  const allowedTraits = new Set<string>(settings?.allowedTraits ?? DEFAULT_IDENTITY_TRAITS);
  const traits = Object.fromEntries(
    Object.entries(validationResult.data.traits).filter(
      ([key, value]) => allowedTraits.has(key) && value !== null && value !== undefined
    )
  );

  try {
    await db
      .insert(userProfiles)
      .values({
        siteId,
        userId,
        traits,
        identitySource: "dashboard",
        lastIdentifiedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [userProfiles.siteId, userProfiles.userId],
        set: {
          traits,
          identitySource: "dashboard",
          lastIdentifiedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      });

    await auditSiteIdentityEvent({
      siteId,
      actorUserId: req.user?.id ?? null,
      action: "identified_user.traits_updated",
      targetId: userId,
      metadata: { traitKeys: Object.keys(traits) },
    });
    return res.send({ success: true });
  } catch (error) {
    console.error("Error updating user traits:", error);
    return res.status(500).send({ error: "Failed to update user traits" });
  }
}
