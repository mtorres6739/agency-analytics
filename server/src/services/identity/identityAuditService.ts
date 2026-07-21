import { and, eq } from "drizzle-orm";
import { db } from "../../db/postgres/postgres.js";
import { agencyAuditEvents, agencyClients, agencyClientSites, sites } from "../../db/postgres/schema.js";

export async function auditSiteIdentityEvent(input: {
  siteId: number;
  actorUserId: string | null;
  action: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}) {
  const [context] = await db
    .select({ organizationId: sites.organizationId, clientId: agencyClientSites.clientId })
    .from(sites)
    .leftJoin(agencyClientSites, eq(agencyClientSites.siteId, sites.siteId))
    .leftJoin(
      agencyClients,
      and(eq(agencyClients.id, agencyClientSites.clientId), eq(agencyClients.organizationId, sites.organizationId))
    )
    .where(eq(sites.siteId, input.siteId))
    .limit(1);
  if (!context?.organizationId) return;
  await db.insert(agencyAuditEvents).values({
    organizationId: context.organizationId,
    clientId: context.clientId ?? null,
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: "identified_user",
    targetId: input.targetId ?? String(input.siteId),
    metadata: input.metadata ?? {},
  });
}
