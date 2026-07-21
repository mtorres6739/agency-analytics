import { FastifyReply, FastifyRequest } from "fastify";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db/postgres/postgres.js";
import { siteIdentitySettings, sites, userAliases, userProfiles } from "../../../db/postgres/schema.js";
import { getIdentityComplianceBlock } from "../../../services/identity/identityCompliance.js";
import { backfillIdentifiedUserId } from "../../../services/tracker/identifyService.js";
import { auditSiteIdentityEvent } from "../../../services/identity/identityAuditService.js";

// Max traits size in bytes (2KB) — matches the tracker identify endpoint
const MAX_TRAITS_SIZE = 2048;

const identifyUserBodySchema = z.object({
  anonymous_id: z.string().min(1).max(255),
  user_id: z
    .string()
    .min(1)
    .max(255)
    .refine(value => !value.includes("@"), "User ID must be opaque, not an email"),
  traits: z
    .object({
      name: z.string().trim().min(1).max(255).optional(),
      email: z.string().trim().toLowerCase().email().max(320).optional(),
      company: z.string().trim().min(1).max(255).optional(),
      plan: z.string().trim().min(1).max(100).optional(),
    })
    .strict()
    .optional()
    .refine(
      traits => {
        if (!traits) return true;
        const size = new TextEncoder().encode(JSON.stringify(traits)).length;
        return size <= MAX_TRAITS_SIZE;
      },
      { message: `Traits must be less than ${MAX_TRAITS_SIZE} bytes (2KB)` }
    ),
});

export interface IdentifyUserRequest {
  Params: {
    siteId: string;
  };
  Body: unknown;
}

/**
 * Manually identify an anonymous visitor from the dashboard: links the device
 * fingerprint (anonymous_id) to a user ID, exactly like the tracking script's
 * identify() call, but initiated by a dashboard user instead of the visitor.
 */
export async function identifyUser(req: FastifyRequest<IdentifyUserRequest>, res: FastifyReply) {
  const validationResult = identifyUserBodySchema.safeParse(req.body);
  if (!validationResult.success) {
    return res.status(400).send({ error: "Invalid payload", details: validationResult.error.flatten() });
  }

  const { anonymous_id, user_id, traits } = validationResult.data;
  const siteId = Number(req.params.siteId);

  if (anonymous_id === user_id) {
    return res.status(400).send({ error: "User ID must be different from the anonymous ID" });
  }

  try {
    const [site] = await db
      .select({
        domain: sites.domain,
        identityEnabled: siteIdentitySettings.enabled,
      })
      .from(sites)
      .leftJoin(siteIdentitySettings, eq(siteIdentitySettings.siteId, sites.siteId))
      .where(eq(sites.siteId, siteId))
      .limit(1);
    if (!site) {
      return res.status(404).send({ error: "Site not found" });
    }
    const complianceReason = getIdentityComplianceBlock(site.domain);
    if (complianceReason) {
      return res.status(423).send({ error: complianceReason, code: "COMPLIANCE_BLOCKED" });
    }
    if (!site.identityEnabled) {
      return res.status(409).send({ error: "Identity is disabled for this site", code: "IDENTITY_DISABLED" });
    }

    const filteredTraits = traits ? Object.fromEntries(Object.entries(traits).filter(([, v]) => v !== null)) : {};

    if (Object.keys(filteredTraits).length > 0) {
      await db
        .insert(userProfiles)
        .values({
          siteId,
          userId: user_id,
          traits: filteredTraits,
          identitySource: "dashboard",
          lastIdentifiedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: [userProfiles.siteId, userProfiles.userId],
          set: {
            traits: sql`${userProfiles.traits} || ${JSON.stringify(filteredTraits)}::jsonb`,
            identitySource: "dashboard",
            lastIdentifiedAt: sql`now()`,
            updatedAt: sql`now()`,
          },
        });
    } else {
      // Profile shell so the user shows up in search/inventory even without traits
      await db
        .insert(userProfiles)
        .values({
          siteId,
          userId: user_id,
          identitySource: "dashboard",
          lastIdentifiedAt: new Date().toISOString(),
        })
        .onConflictDoNothing();
    }

    await db
      .insert(userAliases)
      .values({ siteId, anonymousId: anonymous_id, userId: user_id })
      .onConflictDoUpdate({
        target: [userAliases.siteId, userAliases.anonymousId],
        set: { userId: user_id },
      });

    // Fire-and-forget: the ClickHouse mutation can take a while on large sites,
    // so don't hold the response on it. No backfill window — the operator is
    // explicitly asserting this device's history belongs to this user.
    backfillIdentifiedUserId(siteId, anonymous_id, user_id, null);
    await auditSiteIdentityEvent({
      siteId,
      actorUserId: req.user?.id ?? null,
      action: "identified_user.created_manually",
      targetId: user_id,
      metadata: { traitKeys: Object.keys(filteredTraits) },
    });

    return res.send({ success: true });
  } catch (error) {
    console.error("Error identifying user:", error);
    return res.status(500).send({ error: "Failed to identify user" });
  }
}
