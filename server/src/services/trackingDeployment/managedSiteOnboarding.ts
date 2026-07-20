import { and, eq } from "drizzle-orm";
import { db } from "../../db/postgres/postgres.js";
import {
  agencyAuditEvents,
  agencyClients,
  agencyClientSites,
  team,
  teamSiteAccess,
  trackingDeployments,
} from "../../db/postgres/schema.js";
import { createServiceLogger } from "../../lib/logger/logger.js";
import { trackingDeploymentService } from "./trackingDeploymentService.js";

type ManagedSite = {
  siteId: number;
  name: string;
};

const logger = createServiceLogger("managed-site-onboarding");

function clientSlug(name: string, siteId: number) {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
  return `${base || "website"}-${siteId}`;
}

export async function autoOnboardManagedSite(input: {
  organizationId: string;
  site: ManagedSite;
  actorUserId: string | null;
}) {
  if (process.env.TRACKING_AUTO_DEPLOY_ENABLED !== "true") return null;

  const [existing] = await db
    .select({ clientId: agencyClientSites.clientId })
    .from(agencyClientSites)
    .innerJoin(agencyClients, eq(agencyClients.id, agencyClientSites.clientId))
    .where(and(eq(agencyClients.organizationId, input.organizationId), eq(agencyClientSites.siteId, input.site.siteId)))
    .limit(1);
  if (existing) return { clientId: existing.clientId, deploymentId: null, status: "already_managed" as const };

  const clientId = crypto.randomUUID();
  const teamId = crypto.randomUUID();
  const deploymentId = crypto.randomUUID();
  const now = new Date().toISOString();
  const slug = clientSlug(input.site.name, input.site.siteId);

  await db.transaction(async tx => {
    await tx.insert(team).values({
      id: teamId,
      name: input.site.name,
      organizationId: input.organizationId,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(agencyClients).values({
      id: clientId,
      organizationId: input.organizationId,
      teamId,
      name: input.site.name,
      slug,
      status: "onboarding",
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(agencyClientSites).values({
      clientId,
      siteId: input.site.siteId,
      isPrimary: true,
      trackingMethod: "script",
      trackingStatus: "pending",
      lastCheckedAt: now,
    });
    await tx.insert(teamSiteAccess).values({ teamId, siteId: input.site.siteId });
    await tx.insert(trackingDeployments).values({
      id: deploymentId,
      organizationId: input.organizationId,
      clientId,
      siteId: input.site.siteId,
      provider: "manual",
      action: "plan",
      status: "queued",
      input: { preferredProvider: "auto", autoApply: true, autoMerge: true },
      actorUserId: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(agencyAuditEvents).values([
      {
        organizationId: input.organizationId,
        clientId,
        actorUserId: input.actorUserId,
        action: "client.created_automatically",
        targetType: "agency_client",
        targetId: clientId,
        metadata: { name: input.site.name, slug },
      },
      {
        organizationId: input.organizationId,
        clientId,
        actorUserId: input.actorUserId,
        action: "client.tracking_auto_deploy_queued",
        targetType: "tracking_deployment",
        targetId: deploymentId,
        metadata: { siteId: input.site.siteId, provider: "auto" },
      },
    ]);
  });

  try {
    await trackingDeploymentService.queueDeployment(deploymentId);
  } catch (error) {
    logger.error({ error, deploymentId }, "Failed to queue automatic tracking deployment");
    await db
      .update(trackingDeployments)
      .set({
        status: "failed",
        errorSummary: "The automatic tracking deployment queue is unavailable",
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(trackingDeployments.id, deploymentId));
    return { clientId, deploymentId, status: "failed" as const };
  }

  return { clientId, deploymentId, status: "queued" as const };
}
