import { and, eq, inArray } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { db } from "../../db/postgres/postgres.js";
import { formatClickHouseDateTime64 } from "../../lib/clickhouseDate.js";
import {
  agencyAuditEvents,
  agencyClients,
  agencyClientSites,
  gscConnections,
  goals,
  reportSchedules,
  sites,
  team,
  teamSiteAccess,
  uptimeMonitorStatus,
  uptimeMonitors,
} from "../../db/postgres/schema.js";
import { buildGoalCondition } from "../analytics/goals/goalConditions.js";
import { processResults } from "../analytics/utils/utils.js";
import { getAccessibleClientIds, getAgencyPrincipal, canAccessClient } from "./access.js";
import { assignSiteSchema, createClientSchema, defaultSlug, updateClientSchema } from "./schemas.js";

type OrgParams = { organizationId: string };
type ClientParams = OrgParams & { clientId: string };

const validationError = (reply: FastifyReply, error: { flatten: () => unknown }) =>
  reply.status(400).send({ error: "Invalid request", code: "VALIDATION_ERROR", details: error.flatten() });

const serializeRows = (rows: Awaited<ReturnType<typeof selectClientRows>>) => {
  const clients = new Map<string, any>();
  for (const row of rows) {
    if (!clients.has(row.id)) {
      clients.set(row.id, {
        id: row.id,
        organizationId: row.organizationId,
        teamId: row.teamId,
        name: row.name,
        slug: row.slug,
        status: row.status,
        logoUrl: row.logoUrl,
        timezone: row.timezone,
        externalRef: row.externalRef,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        sites: [],
      });
    }
    if (row.siteId) {
      clients.get(row.id).sites.push({
        clientId: row.id,
        siteId: row.siteId,
        name: row.siteName,
        domain: row.domain,
        isPrimary: row.isPrimary,
        trackingMethod: row.trackingMethod,
        trackingStatus: row.trackingStatus,
        verifiedAt: row.verifiedAt,
        lastCheckedAt: row.lastCheckedAt,
      });
    }
  }
  return [...clients.values()];
};

function selectClientRows(organizationId: string, clientIds?: string[]) {
  const base = db
    .select({
      id: agencyClients.id,
      organizationId: agencyClients.organizationId,
      teamId: agencyClients.teamId,
      name: agencyClients.name,
      slug: agencyClients.slug,
      status: agencyClients.status,
      logoUrl: agencyClients.logoUrl,
      timezone: agencyClients.timezone,
      externalRef: agencyClients.externalRef,
      createdAt: agencyClients.createdAt,
      updatedAt: agencyClients.updatedAt,
      siteId: agencyClientSites.siteId,
      isPrimary: agencyClientSites.isPrimary,
      trackingMethod: agencyClientSites.trackingMethod,
      trackingStatus: agencyClientSites.trackingStatus,
      verifiedAt: agencyClientSites.verifiedAt,
      lastCheckedAt: agencyClientSites.lastCheckedAt,
      siteName: sites.name,
      domain: sites.domain,
    })
    .from(agencyClients)
    .leftJoin(agencyClientSites, eq(agencyClientSites.clientId, agencyClients.id))
    .leftJoin(sites, eq(sites.siteId, agencyClientSites.siteId));

  const where = clientIds
    ? and(eq(agencyClients.organizationId, organizationId), inArray(agencyClients.id, clientIds))
    : eq(agencyClients.organizationId, organizationId);
  return base.where(where).orderBy(agencyClients.name);
}

export async function listAgencyClients(request: FastifyRequest<{ Params: OrgParams }>, reply: FastifyReply) {
  try {
    const { organizationId } = request.params;
    const { principal, clientIds } = await getAccessibleClientIds(request, organizationId);
    if (!principal) return reply.status(403).send({ error: "Forbidden" });
    if (clientIds.length === 0) return reply.send({ clients: [] });
    const rows = await selectClientRows(organizationId, clientIds);
    return reply.send({ clients: serializeRows(rows) });
  } catch (error) {
    request.log.error({ error }, "Failed to list agency clients");
    return reply.status(500).send({ error: "Failed to list clients" });
  }
}

export async function createAgencyClient(
  request: FastifyRequest<{ Params: OrgParams; Body: unknown }>,
  reply: FastifyReply
) {
  const parsed = createClientSchema.safeParse(request.body);
  if (!parsed.success) return validationError(reply, parsed.error);

  try {
    const { organizationId } = request.params;
    const principal = await getAgencyPrincipal(request, organizationId);
    if (!principal?.canManage) return reply.status(403).send({ error: "Forbidden" });

    const id = crypto.randomUUID();
    const teamId = crypto.randomUUID();
    const now = new Date().toISOString();
    const slug = parsed.data.slug ?? defaultSlug(parsed.data.name);
    if (!slug) return reply.status(400).send({ error: "Client name must contain letters or numbers" });

    await db.transaction(async tx => {
      await tx
        .insert(team)
        .values({ id: teamId, name: parsed.data.name, organizationId, createdAt: now, updatedAt: now });
      await tx.insert(agencyClients).values({
        id,
        organizationId,
        teamId,
        name: parsed.data.name,
        slug,
        timezone: parsed.data.timezone,
        logoUrl: parsed.data.logoUrl,
        externalRef: parsed.data.externalRef,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(agencyAuditEvents).values({
        organizationId,
        clientId: id,
        actorUserId: principal.userId,
        action: "client.created",
        targetType: "agency_client",
        targetId: id,
        metadata: { name: parsed.data.name, slug },
      });
    });

    const rows = await selectClientRows(organizationId, [id]);
    return reply.status(201).send({ client: serializeRows(rows)[0] });
  } catch (error: any) {
    if (error?.code === "23505") return reply.status(400).send({ error: "A client with this slug already exists" });
    request.log.error({ error }, "Failed to create agency client");
    return reply.status(500).send({ error: "Failed to create client" });
  }
}

export async function getAgencyClient(request: FastifyRequest<{ Params: ClientParams }>, reply: FastifyReply) {
  const { organizationId, clientId } = request.params;
  const access = await canAccessClient(request, organizationId, clientId);
  if (!access.allowed) return reply.status(404).send({ error: "Client not found" });
  const rows = await selectClientRows(organizationId, [clientId]);
  const client = serializeRows(rows)[0];
  return client ? reply.send({ client }) : reply.status(404).send({ error: "Client not found" });
}

export async function updateAgencyClient(
  request: FastifyRequest<{ Params: ClientParams; Body: unknown }>,
  reply: FastifyReply
) {
  const parsed = updateClientSchema.safeParse(request.body);
  if (!parsed.success) return validationError(reply, parsed.error);
  const { organizationId, clientId } = request.params;
  const principal = await getAgencyPrincipal(request, organizationId);
  if (!principal?.canManage) return reply.status(403).send({ error: "Forbidden" });

  const [existing] = await db
    .select({ id: agencyClients.id, teamId: agencyClients.teamId })
    .from(agencyClients)
    .where(and(eq(agencyClients.id, clientId), eq(agencyClients.organizationId, organizationId)))
    .limit(1);
  if (!existing) return reply.status(404).send({ error: "Client not found" });

  const now = new Date().toISOString();
  try {
    await db.transaction(async tx => {
      await tx
        .update(agencyClients)
        .set({ ...parsed.data, updatedAt: now })
        .where(eq(agencyClients.id, clientId));
      if (parsed.data.name)
        await tx.update(team).set({ name: parsed.data.name, updatedAt: now }).where(eq(team.id, existing.teamId));
      await tx.insert(agencyAuditEvents).values({
        organizationId,
        clientId,
        actorUserId: principal.userId,
        action: "client.updated",
        targetType: "agency_client",
        targetId: clientId,
        metadata: { fields: Object.keys(parsed.data) },
      });
    });
    const rows = await selectClientRows(organizationId, [clientId]);
    return reply.send({ client: serializeRows(rows)[0] });
  } catch (error: any) {
    if (error?.code === "23505") return reply.status(400).send({ error: "A client with this slug already exists" });
    request.log.error({ error }, "Failed to update agency client");
    return reply.status(500).send({ error: "Failed to update client" });
  }
}

export async function assignAgencyClientSite(
  request: FastifyRequest<{ Params: ClientParams; Body: unknown }>,
  reply: FastifyReply
) {
  const parsed = assignSiteSchema.safeParse(request.body);
  if (!parsed.success) return validationError(reply, parsed.error);
  const { organizationId, clientId } = request.params;
  const principal = await getAgencyPrincipal(request, organizationId);
  if (!principal?.canManage) return reply.status(403).send({ error: "Forbidden" });

  const [[client], [site]] = await Promise.all([
    db
      .select({ id: agencyClients.id, teamId: agencyClients.teamId })
      .from(agencyClients)
      .where(and(eq(agencyClients.id, clientId), eq(agencyClients.organizationId, organizationId)))
      .limit(1),
    db
      .select({ siteId: sites.siteId })
      .from(sites)
      .where(and(eq(sites.siteId, parsed.data.siteId), eq(sites.organizationId, organizationId)))
      .limit(1),
  ]);
  if (!client) return reply.status(404).send({ error: "Client not found" });
  if (!site) return reply.status(404).send({ error: "Site not found" });

  try {
    await db.transaction(async tx => {
      if (parsed.data.isPrimary) {
        await tx.update(agencyClientSites).set({ isPrimary: false }).where(eq(agencyClientSites.clientId, clientId));
      }
      await tx.insert(agencyClientSites).values({ clientId, ...parsed.data });
      await tx
        .insert(teamSiteAccess)
        .values({ teamId: client.teamId, siteId: parsed.data.siteId })
        .onConflictDoNothing();
      await tx.insert(agencyAuditEvents).values({
        organizationId,
        clientId,
        actorUserId: principal.userId,
        action: "client.site_added",
        targetType: "site",
        targetId: String(parsed.data.siteId),
        metadata: { trackingMethod: parsed.data.trackingMethod, isPrimary: parsed.data.isPrimary },
      });
    });
    const rows = await selectClientRows(organizationId, [clientId]);
    return reply.status(201).send({ client: serializeRows(rows)[0] });
  } catch (error: any) {
    if (error?.code === "23505") return reply.status(400).send({ error: "This site is already assigned to a client" });
    request.log.error({ error }, "Failed to assign agency client site");
    return reply.status(500).send({ error: "Failed to assign site" });
  }
}

export async function removeAgencyClientSite(
  request: FastifyRequest<{ Params: ClientParams & { siteId: string } }>,
  reply: FastifyReply
) {
  const { organizationId, clientId } = request.params;
  const siteId = Number(request.params.siteId);
  if (!Number.isInteger(siteId) || siteId < 1) return reply.status(400).send({ error: "Invalid site ID" });
  const principal = await getAgencyPrincipal(request, organizationId);
  if (!principal?.canManage) return reply.status(403).send({ error: "Forbidden" });

  const [client] = await db
    .select({ teamId: agencyClients.teamId })
    .from(agencyClients)
    .where(and(eq(agencyClients.id, clientId), eq(agencyClients.organizationId, organizationId)))
    .limit(1);
  if (!client) return reply.status(404).send({ error: "Client not found" });

  await db.transaction(async tx => {
    await tx
      .delete(agencyClientSites)
      .where(and(eq(agencyClientSites.clientId, clientId), eq(agencyClientSites.siteId, siteId)));
    await tx
      .delete(teamSiteAccess)
      .where(and(eq(teamSiteAccess.teamId, client.teamId), eq(teamSiteAccess.siteId, siteId)));
    await tx.insert(agencyAuditEvents).values({
      organizationId,
      clientId,
      actorUserId: principal.userId,
      action: "client.site_removed",
      targetType: "site",
      targetId: String(siteId),
    });
  });
  return reply.status(204).send();
}

export async function verifyAgencyClientSite(
  request: FastifyRequest<{ Params: ClientParams & { siteId: string } }>,
  reply: FastifyReply
) {
  const { organizationId, clientId } = request.params;
  const siteId = Number(request.params.siteId);
  if (!Number.isInteger(siteId) || siteId < 1) return reply.status(400).send({ error: "Invalid site ID" });
  const principal = await getAgencyPrincipal(request, organizationId);
  if (!principal?.canManage) return reply.status(403).send({ error: "Forbidden" });

  const [assignment] = await db
    .select({ id: agencyClientSites.id })
    .from(agencyClientSites)
    .innerJoin(agencyClients, eq(agencyClients.id, agencyClientSites.clientId))
    .where(
      and(
        eq(agencyClientSites.clientId, clientId),
        eq(agencyClientSites.siteId, siteId),
        eq(agencyClients.organizationId, organizationId)
      )
    )
    .limit(1);
  if (!assignment) return reply.status(404).send({ error: "Client site not found" });

  const checkedAt = new Date();
  try {
    const result = await clickhouse.query({
      query: `SELECT count() AS event_count, max(timestamp) AS last_event_at FROM events WHERE site_id = {siteId:Int32}`,
      query_params: { siteId },
      format: "JSONEachRow",
    });
    const [data] = await processResults<{ event_count: number; last_event_at: string | null }>(result);
    const lastEventAt = data?.last_event_at ? new Date(data.last_event_at) : null;
    const status =
      !data?.event_count || !lastEventAt
        ? "pending"
        : checkedAt.getTime() - lastEventAt.getTime() > 7 * 86_400_000
          ? "stale"
          : "verified";

    await db.transaction(async tx => {
      await tx
        .update(agencyClientSites)
        .set({
          trackingStatus: status,
          lastCheckedAt: checkedAt.toISOString(),
          verifiedAt: status === "verified" ? checkedAt.toISOString() : null,
        })
        .where(eq(agencyClientSites.id, assignment.id));
      await tx.insert(agencyAuditEvents).values({
        organizationId,
        clientId,
        actorUserId: principal.userId,
        action: "client.site_verified",
        targetType: "site",
        targetId: String(siteId),
        metadata: { status, hasEvents: Number(data?.event_count ?? 0) > 0 },
      });
    });
    return reply.send({ status, lastEventAt: lastEventAt?.toISOString() ?? null, checkedAt: checkedAt.toISOString() });
  } catch (error) {
    request.log.error({ error, siteId }, "Failed to verify agency client site");
    await db
      .update(agencyClientSites)
      .set({ trackingStatus: "error", lastCheckedAt: checkedAt.toISOString() })
      .where(eq(agencyClientSites.id, assignment.id));
    return reply.status(500).send({ error: "Tracking verification failed" });
  }
}

export async function getAgencyClientOnboarding(
  request: FastifyRequest<{ Params: ClientParams }>,
  reply: FastifyReply
) {
  const { organizationId, clientId } = request.params;
  const access = await canAccessClient(request, organizationId, clientId);
  if (!access.allowed) return reply.status(404).send({ error: "Client not found" });

  const clientRows = await selectClientRows(organizationId, [clientId]);
  const client = serializeRows(clientRows)[0];
  if (!client) return reply.status(404).send({ error: "Client not found" });
  const siteIds = client.sites.map((site: any) => site.siteId);
  const [goalRows, gscRows, uptimeRows, scheduleRows] = await Promise.all([
    siteIds.length ? db.select({ id: goals.goalId }).from(goals).where(inArray(goals.siteId, siteIds)).limit(1) : [],
    siteIds.length
      ? db
          .select({ siteId: gscConnections.siteId })
          .from(gscConnections)
          .where(inArray(gscConnections.siteId, siteIds))
          .limit(1)
      : [],
    db
      .select({ httpConfig: uptimeMonitors.httpConfig, tcpConfig: uptimeMonitors.tcpConfig })
      .from(uptimeMonitors)
      .where(and(eq(uptimeMonitors.organizationId, organizationId), eq(uptimeMonitors.enabled, true))),
    db
      .select({ id: reportSchedules.id })
      .from(reportSchedules)
      .where(and(eq(reportSchedules.clientId, clientId), eq(reportSchedules.enabled, true)))
      .limit(1),
  ]);

  const verified = client.sites.some((site: any) => site.trackingStatus === "verified");
  const clientDomains = new Set(client.sites.map((site: any) => site.domain.replace(/^www\./, "")));
  const hasUptimeMonitor = uptimeRows.some(row => {
    const target = row.httpConfig?.url ?? row.tcpConfig?.host;
    if (!target) return false;
    try {
      const hostname = (target.includes("://") ? new URL(target).hostname : target).replace(/^www\./, "");
      return clientDomains.has(hostname);
    } catch {
      return false;
    }
  });
  const steps = [
    { key: "client", label: "Create client", complete: true },
    { key: "site", label: "Add a website", complete: siteIds.length > 0 },
    { key: "installation", label: "Choose an installation method", complete: siteIds.length > 0 },
    { key: "privacy", label: "Configure privacy exclusions", complete: siteIds.length > 0 },
    { key: "verification", label: "Verify the first event", complete: verified },
    { key: "goals", label: "Configure conversion goals", complete: goalRows.length > 0 },
    { key: "integrations", label: "Connect search and uptime", complete: gscRows.length > 0 && hasUptimeMonitor },
    { key: "users", label: "Invite client users", complete: false },
    { key: "reporting", label: "Enable scheduled reporting", complete: scheduleRows.length > 0 },
  ];
  const completedSteps = steps.filter(step => step.complete).length;
  return reply.send({
    onboarding: {
      clientId,
      completedSteps,
      totalSteps: steps.length,
      percentComplete: Math.round((completedSteps / steps.length) * 100),
      steps,
    },
  });
}

export async function getAgencyClientSummary(
  request: FastifyRequest<{ Params: ClientParams; Querystring: { start?: string; end?: string } }>,
  reply: FastifyReply
) {
  const { organizationId, clientId } = request.params;
  const access = await canAccessClient(request, organizationId, clientId);
  if (!access.allowed) return reply.status(404).send({ error: "Client not found" });

  const rows = await selectClientRows(organizationId, [clientId]);
  const client = serializeRows(rows)[0];
  if (!client) return reply.status(404).send({ error: "Client not found" });

  const end = request.query.end ? new Date(request.query.end) : new Date();
  const start = request.query.start ? new Date(request.query.start) : new Date(end.getTime() - 30 * 86_400_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return reply.status(400).send({ error: "Invalid reporting window" });
  }

  const siteIds = client.sites.map((site: any) => site.siteId);
  const partialData: string[] = [];
  let visitors = 0;
  let sessions = 0;
  let conversions = 0;

  if (siteIds.length > 0) {
    try {
      const clientGoals = await db
        .select({ siteId: goals.siteId, goalType: goals.goalType, config: goals.config })
        .from(goals)
        .where(inArray(goals.siteId, siteIds));
      const goalConditions = clientGoals
        .map(goal => {
          const condition = buildGoalCondition({ goalType: goal.goalType, config: goal.config });
          return condition ? `(site_id = ${Number(goal.siteId)} AND (${condition}))` : null;
        })
        .filter((condition): condition is string => !!condition);
      const conversionSelect = goalConditions.length ? `uniqExactIf(session_id, ${goalConditions.join(" OR ")})` : "0";
      const result = await clickhouse.query({
        query: `
          SELECT
            uniqExact(user_id) AS visitors,
            uniqExact(session_id) AS sessions,
            ${conversionSelect} AS conversions
          FROM events
          WHERE site_id IN {siteIds:Array(Int32)}
            AND timestamp >= {start:DateTime64(3)}
            AND timestamp < {end:DateTime64(3)}
        `,
        query_params: {
          siteIds,
          start: formatClickHouseDateTime64(start),
          end: formatClickHouseDateTime64(end),
        },
        format: "JSONEachRow",
      });
      const [metrics] = await processResults<{ visitors: number; sessions: number; conversions: number }>(result);
      visitors = Number(metrics?.visitors ?? 0);
      sessions = Number(metrics?.sessions ?? 0);
      conversions = Number(metrics?.conversions ?? 0);
    } catch (error) {
      request.log.warn({ error, clientId }, "Client summary analytics are temporarily unavailable");
      partialData.push("analytics");
    }
  }

  const monitorRows = await db
    .select({
      currentStatus: uptimeMonitorStatus.currentStatus,
      httpConfig: uptimeMonitors.httpConfig,
      tcpConfig: uptimeMonitors.tcpConfig,
    })
    .from(uptimeMonitors)
    .leftJoin(uptimeMonitorStatus, eq(uptimeMonitorStatus.monitorId, uptimeMonitors.id))
    .where(eq(uptimeMonitors.organizationId, organizationId));
  const domains = new Set(client.sites.map((site: any) => site.domain.replace(/^www\./, "")));
  const sitesDown = monitorRows.filter(row => {
    if (row.currentStatus !== "down") return false;
    const target = row.httpConfig?.url ?? row.tcpConfig?.host;
    if (!target) return false;
    try {
      return domains.has((target.includes("://") ? new URL(target).hostname : target).replace(/^www\./, ""));
    } catch {
      return false;
    }
  }).length;

  return reply.send({
    summary: {
      clientId,
      siteCount: siteIds.length,
      visitors,
      sessions,
      conversions,
      conversionRate: sessions > 0 ? (conversions / sessions) * 100 : 0,
      sitesDown,
      trackingIssues: client.sites.filter((site: any) => site.trackingStatus !== "verified").length,
      reportingPeriod: { start: start.toISOString(), end: end.toISOString() },
      ...(partialData.length ? { partialData } : {}),
    },
  });
}
