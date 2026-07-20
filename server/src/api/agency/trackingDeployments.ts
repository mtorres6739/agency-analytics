import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../../db/postgres/postgres.js";
import { agencyAuditEvents, agencyClientSites, agencyClients, trackingDeployments } from "../../db/postgres/schema.js";
import { trackingDeploymentService } from "../../services/trackingDeployment/trackingDeploymentService.js";
import { canAccessClient, getAgencyPrincipal } from "./access.js";
import { trackingDeploymentPlanSchema } from "./schemas.js";

type SiteParams = { organizationId: string; clientId: string; siteId: string };
type DeploymentParams = SiteParams & { deploymentId: string };

const serialize = (deployment: typeof trackingDeployments.$inferSelect) => ({
  ...deployment,
  input: deployment.input ?? {},
  result: deployment.result ?? {},
});

async function resolveManagedSite(request: FastifyRequest, params: SiteParams) {
  const principal = await getAgencyPrincipal(request, params.organizationId);
  if (!principal?.canManage) return null;
  const siteId = Number(params.siteId);
  if (!Number.isSafeInteger(siteId) || siteId <= 0) return null;
  const [assignment] = await db
    .select({ id: agencyClientSites.id })
    .from(agencyClientSites)
    .innerJoin(agencyClients, eq(agencyClients.id, agencyClientSites.clientId))
    .where(
      and(
        eq(agencyClients.organizationId, params.organizationId),
        eq(agencyClientSites.clientId, params.clientId),
        eq(agencyClientSites.siteId, siteId)
      )
    )
    .limit(1);
  return assignment ? { principal, siteId } : null;
}

async function enqueue(
  request: FastifyRequest,
  reply: FastifyReply,
  input: {
    organizationId: string;
    clientId: string;
    siteId: number;
    provider: "cloudflare" | "vercel" | "wordpress" | "manual";
    action: "plan" | "apply" | "status" | "rollback";
    payload: Record<string, unknown>;
    actorUserId: string | null;
  }
) {
  const active = await db
    .select()
    .from(trackingDeployments)
    .where(
      and(
        eq(trackingDeployments.clientId, input.clientId),
        eq(trackingDeployments.siteId, input.siteId),
        inArray(trackingDeployments.status, ["queued", "running"])
      )
    )
    .orderBy(desc(trackingDeployments.createdAt))
    .limit(1);
  if (active[0]) return reply.status(409).send({ error: "A tracking installation job is already running" });

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const [deployment] = await db.transaction(async tx => {
    const rows = await tx
      .insert(trackingDeployments)
      .values({
        id,
        organizationId: input.organizationId,
        clientId: input.clientId,
        siteId: input.siteId,
        provider: input.provider,
        action: input.action,
        status: "queued",
        input: input.payload,
        actorUserId: input.actorUserId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await tx.insert(agencyAuditEvents).values({
      organizationId: input.organizationId,
      clientId: input.clientId,
      actorUserId: input.actorUserId,
      action: `client.tracking_${input.action}_queued`,
      targetType: "tracking_deployment",
      targetId: id,
      metadata: { siteId: input.siteId, provider: input.provider },
    });
    return rows;
  });

  try {
    await trackingDeploymentService.queueDeployment(id);
  } catch (error) {
    request.log.error({ error, deploymentId: id }, "Failed to queue tracking deployment");
    await db
      .update(trackingDeployments)
      .set({ status: "failed", errorSummary: "The tracking deployment queue is unavailable", updatedAt: now })
      .where(eq(trackingDeployments.id, id));
    return reply.status(503).send({ error: "The tracking deployment queue is temporarily unavailable" });
  }
  return reply.status(202).send({ deployment: serialize(deployment) });
}

export async function listTrackingDeployments(request: FastifyRequest<{ Params: SiteParams }>, reply: FastifyReply) {
  const access = await resolveManagedSite(request, request.params);
  if (!access) return reply.status(404).send({ error: "Client website not found" });
  const deployments = await db
    .select()
    .from(trackingDeployments)
    .where(
      and(
        eq(trackingDeployments.organizationId, request.params.organizationId),
        eq(trackingDeployments.clientId, request.params.clientId),
        eq(trackingDeployments.siteId, access.siteId)
      )
    )
    .orderBy(desc(trackingDeployments.createdAt))
    .limit(20);
  return reply.send({ deployments: deployments.map(serialize) });
}

export async function getLatestSiteTrackingDeployment(
  request: FastifyRequest<{ Params: { organizationId: string; siteId: string } }>,
  reply: FastifyReply
) {
  const siteId = Number(request.params.siteId);
  if (!Number.isSafeInteger(siteId) || siteId <= 0) return reply.status(404).send({ error: "Website not found" });

  const [assignment] = await db
    .select({ clientId: agencyClientSites.clientId })
    .from(agencyClientSites)
    .innerJoin(agencyClients, eq(agencyClients.id, agencyClientSites.clientId))
    .where(and(eq(agencyClients.organizationId, request.params.organizationId), eq(agencyClientSites.siteId, siteId)))
    .limit(1);
  if (!assignment) return reply.send({ deployment: null });

  const access = await canAccessClient(request, request.params.organizationId, assignment.clientId);
  if (!access.allowed) return reply.status(404).send({ error: "Website not found" });

  const [deployment] = await db
    .select()
    .from(trackingDeployments)
    .where(
      and(
        eq(trackingDeployments.organizationId, request.params.organizationId),
        eq(trackingDeployments.clientId, assignment.clientId),
        eq(trackingDeployments.siteId, siteId)
      )
    )
    .orderBy(desc(trackingDeployments.createdAt))
    .limit(1);
  return reply.send({ deployment: deployment ? serialize(deployment) : null });
}

export async function planTrackingDeployment(
  request: FastifyRequest<{ Params: SiteParams; Body: unknown }>,
  reply: FastifyReply
) {
  const access = await resolveManagedSite(request, request.params);
  if (!access) return reply.status(404).send({ error: "Client website not found" });
  const parsed = trackingDeploymentPlanSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: "Invalid request",
      code: "VALIDATION_ERROR",
      details: parsed.error.flatten(),
    });
  }
  const requested = parsed.data.preferredProvider;
  return enqueue(request, reply, {
    organizationId: request.params.organizationId,
    clientId: request.params.clientId,
    siteId: access.siteId,
    provider: requested === "auto" ? "manual" : requested,
    action: "plan",
    payload: parsed.data,
    actorUserId: access.principal.userId,
  });
}

async function enqueueFromSource(
  request: FastifyRequest<{ Params: DeploymentParams }>,
  reply: FastifyReply,
  action: "apply" | "status" | "rollback",
  requiredAction: "plan" | "apply"
) {
  const access = await resolveManagedSite(request, request.params);
  if (!access) return reply.status(404).send({ error: "Client website not found" });
  const [source] = await db
    .select()
    .from(trackingDeployments)
    .where(
      and(
        eq(trackingDeployments.id, request.params.deploymentId),
        eq(trackingDeployments.organizationId, request.params.organizationId),
        eq(trackingDeployments.clientId, request.params.clientId),
        eq(trackingDeployments.siteId, access.siteId),
        eq(trackingDeployments.action, requiredAction)
      )
    )
    .limit(1);
  if (!source || !["succeeded", "blocked"].includes(source.status)) {
    return reply.status(409).send({ error: `A completed ${requiredAction} run is required` });
  }
  return enqueue(request, reply, {
    organizationId: request.params.organizationId,
    clientId: request.params.clientId,
    siteId: access.siteId,
    provider: source.provider as "cloudflare" | "vercel" | "wordpress" | "manual",
    action,
    payload: { sourceDeploymentId: source.id },
    actorUserId: access.principal.userId,
  });
}

export async function applyTrackingDeployment(
  request: FastifyRequest<{ Params: DeploymentParams }>,
  reply: FastifyReply
) {
  return enqueueFromSource(request, reply, "apply", "plan");
}

export async function refreshTrackingDeployment(
  request: FastifyRequest<{ Params: DeploymentParams }>,
  reply: FastifyReply
) {
  return enqueueFromSource(request, reply, "status", "apply");
}

export async function rollbackTrackingDeployment(
  request: FastifyRequest<{ Params: DeploymentParams }>,
  reply: FastifyReply
) {
  return enqueueFromSource(request, reply, "rollback", "apply");
}
