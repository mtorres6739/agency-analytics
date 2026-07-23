import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../../db/postgres/postgres.js";
import {
  agencyAuditEvents,
  agencyClients,
  agencyClientSites,
  siteIdentitySettings,
  sites,
} from "../../db/postgres/schema.js";
import {
  DEFAULT_IDENTITY_TRAITS,
  getIdentitySettingsRecord,
  serializeIdentitySettings,
} from "../../services/identity/identitySettingsService.js";
import {
  IdentityProvisioningError,
  provisionIdentityKey,
  refreshPendingIdentityKey,
} from "../../services/identity/identityProvisioningService.js";
import { getIdentityComplianceBlock } from "../../services/identity/identityCompliance.js";

const traitKeys = ["name", "email", "company", "plan", "title", "linkedinUrl", "location"] as const;
const updateSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.enum(["signed", "direct"]).optional(),
    allowedTraits: z.array(z.enum(traitKeys)).min(1).max(traitKeys.length).optional(),
    retentionDays: z.number().int().min(1).max(3650).optional(),
  })
  .strict();

async function resolveSite(siteParam: string) {
  const siteId = Number(siteParam);
  if (!Number.isSafeInteger(siteId) || siteId <= 0) return null;
  const [site] = await db.select().from(sites).where(eq(sites.siteId, siteId)).limit(1);
  return site ?? null;
}

async function auditIdentityChange(
  site: typeof sites.$inferSelect,
  actorUserId: string | null,
  action: string,
  metadata: Record<string, unknown>
) {
  if (!site.organizationId) return;
  const [assignment] = await db
    .select({ clientId: agencyClientSites.clientId })
    .from(agencyClientSites)
    .innerJoin(agencyClients, eq(agencyClients.id, agencyClientSites.clientId))
    .where(and(eq(agencyClients.organizationId, site.organizationId), eq(agencyClientSites.siteId, site.siteId)))
    .limit(1);
  await db.insert(agencyAuditEvents).values({
    organizationId: site.organizationId,
    clientId: assignment?.clientId ?? null,
    actorUserId,
    action,
    targetType: "site_identity",
    targetId: String(site.siteId),
    metadata,
  });
}

export async function getSiteIdentitySettings(
  request: FastifyRequest<{ Params: { siteId: string } }>,
  reply: FastifyReply
) {
  const site = await resolveSite(request.params.siteId);
  if (!site) return reply.status(404).send({ error: "Site not found" });
  const refreshed = await refreshPendingIdentityKey(site.siteId).catch(error => {
    request.log.warn({ error, siteId: site.siteId }, "Identity deployment status refresh failed");
    return { changed: false, status: "pending" as const };
  });
  if (refreshed.changed) {
    await auditIdentityChange(site, request.user?.id ?? null, `site.identity_key_${refreshed.status}`, {});
  }
  const { settings, key, latestKey } = await getIdentitySettingsRecord(site.siteId);
  const complianceReason = getIdentityComplianceBlock(site.domain);
  return reply.send({
    settings: {
      ...serializeIdentitySettings(site.siteId, settings, key, latestKey),
      complianceBlocked: !!complianceReason,
      complianceReason,
    },
  });
}

export async function updateSiteIdentitySettings(
  request: FastifyRequest<{ Params: { siteId: string }; Body: unknown }>,
  reply: FastifyReply
) {
  const site = await resolveSite(request.params.siteId);
  if (!site) return reply.status(404).send({ error: "Site not found" });
  const parsed = updateSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Invalid request", details: parsed.error.flatten() });
  }
  const complianceReason = getIdentityComplianceBlock(site.domain);
  if (parsed.data.enabled === true && complianceReason) {
    return reply.status(423).send({ error: complianceReason, code: "COMPLIANCE_BLOCKED" });
  }
  const existing = await getIdentitySettingsRecord(site.siteId);
  if (parsed.data.enabled === true && (parsed.data.mode ?? existing.settings?.mode ?? "signed") === "signed") {
    if (!existing.key || existing.key.status !== "active") {
      return reply.status(409).send({ error: "Rotate and deploy an identity key before enabling identity" });
    }
  }
  const now = new Date().toISOString();
  const allowedTraits = parsed.data.allowedTraits
    ? [...new Set(parsed.data.allowedTraits)]
    : (existing.settings?.allowedTraits ?? DEFAULT_IDENTITY_TRAITS);
  await db
    .insert(siteIdentitySettings)
    .values({
      siteId: site.siteId,
      enabled: parsed.data.enabled ?? existing.settings?.enabled ?? false,
      mode: parsed.data.mode ?? existing.settings?.mode ?? "signed",
      allowedTraits,
      retentionDays: parsed.data.retentionDays ?? existing.settings?.retentionDays ?? 395,
      activeKeyId: existing.settings?.activeKeyId ?? null,
      createdAt: existing.settings?.createdAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: siteIdentitySettings.siteId,
      set: {
        ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
        ...(parsed.data.mode !== undefined ? { mode: parsed.data.mode } : {}),
        ...(parsed.data.allowedTraits !== undefined ? { allowedTraits } : {}),
        ...(parsed.data.retentionDays !== undefined ? { retentionDays: parsed.data.retentionDays } : {}),
        updatedAt: now,
      },
    });
  await auditIdentityChange(site, request.user?.id ?? null, "site.identity_settings_updated", {
    changedFields: Object.keys(parsed.data),
  });
  const updated = await getIdentitySettingsRecord(site.siteId);
  return reply.send({
    settings: {
      ...serializeIdentitySettings(site.siteId, updated.settings, updated.key, updated.latestKey),
      complianceBlocked: !!complianceReason,
      complianceReason,
    },
  });
}

export async function rotateSiteIdentityKey(
  request: FastifyRequest<{ Params: { siteId: string } }>,
  reply: FastifyReply
) {
  const site = await resolveSite(request.params.siteId);
  if (!site) return reply.status(404).send({ error: "Site not found" });
  if (!site.id) return reply.status(409).send({ error: "Site tracking property ID is not configured" });
  const complianceReason = getIdentityComplianceBlock(site.domain);
  if (complianceReason) {
    return reply.status(423).send({ error: complianceReason, code: "COMPLIANCE_BLOCKED" });
  }
  try {
    const deployment = await provisionIdentityKey({
      siteId: site.siteId,
      sitePublicId: site.id,
      hostname: site.domain,
    });
    await auditIdentityChange(site, request.user?.id ?? null, "site.identity_key_deployment_started", {
      keyVersion: deployment.keyVersion,
      provider: deployment.provider,
      project: deployment.project,
    });
    return reply.status(202).send({
      keyVersion: deployment.keyVersion,
      keyConfigured: false,
      rotationStatus: deployment.status,
      provider: deployment.provider,
      project: deployment.project,
    });
  } catch (error) {
    request.log.error({ error, siteId: site.siteId }, "Identity key rotation failed");
    if (error instanceof IdentityProvisioningError) {
      const status = error.code === "UNSUPPORTED_SITE" ? 409 : 503;
      return reply.status(status).send({ error: error.message, code: error.code });
    }
    return reply.status(503).send({ error: "Identity key deployment is not configured" });
  }
}
