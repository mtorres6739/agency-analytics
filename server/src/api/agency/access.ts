import { and, eq, inArray } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { db } from "../../db/postgres/postgres.js";
import { agencyClients, agencyClientSites, member } from "../../db/postgres/schema.js";
import { getSitesUserHasAccessTo, getUserIdFromRequest } from "../../lib/auth-utils.js";

export async function getAgencyPrincipal(request: FastifyRequest, organizationId: string) {
  if (request.apiKeyOrganizationId === organizationId) {
    return { userId: null, role: "owner", canManage: true } as const;
  }

  const userId = request.user?.id ?? (await getUserIdFromRequest(request));
  if (!userId) return null;

  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1);

  if (!membership) return null;
  return {
    userId,
    role: membership.role,
    canManage: membership.role === "owner" || membership.role === "admin",
  };
}

export async function getAccessibleClientIds(request: FastifyRequest, organizationId: string) {
  const principal = await getAgencyPrincipal(request, organizationId);
  if (!principal) return { principal: null, clientIds: [] as string[] };

  if (principal.canManage) {
    const rows = await db
      .select({ id: agencyClients.id })
      .from(agencyClients)
      .where(eq(agencyClients.organizationId, organizationId));
    return { principal, clientIds: rows.map(row => row.id) };
  }

  const allowedSites = await getSitesUserHasAccessTo(request);
  const siteIds = allowedSites.filter(site => site.organizationId === organizationId).map(site => site.siteId);
  if (siteIds.length === 0) return { principal, clientIds: [] as string[] };

  const rows = await db
    .select({ id: agencyClients.id })
    .from(agencyClients)
    .innerJoin(agencyClientSites, eq(agencyClientSites.clientId, agencyClients.id))
    .where(and(eq(agencyClients.organizationId, organizationId), inArray(agencyClientSites.siteId, siteIds)));

  return { principal, clientIds: [...new Set(rows.map(row => row.id))] };
}

export async function canAccessClient(request: FastifyRequest, organizationId: string, clientId: string) {
  const { principal, clientIds } = await getAccessibleClientIds(request, organizationId);
  return { principal, allowed: !!principal && clientIds.includes(clientId) };
}
