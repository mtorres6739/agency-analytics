import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../../db/postgres/postgres.js";
import { agencyAuditEvents, identityProviderConnections } from "../../db/postgres/schema.js";
import { getAgencyPrincipal } from "../agency/access.js";
import { customersAiResolver, rb2bResolver } from "../../services/identityResolution/httpResolver.js";
import { pdlEnrichmentProvider } from "../../services/identityResolution/pdlEnrichmentProvider.js";

const paramsSchema = z.object({ organizationId: z.string().min(1), provider: z.enum(["customers_ai", "rb2b", "pdl"]) });
const connectionSchema = z
  .object({
    externalAccountId: z.string().trim().max(255).nullable().optional(),
    capabilities: z
      .array(z.enum(["resolve", "webhook", "delete", "enrich"]))
      .max(4)
      .default([]),
    status: z.enum(["pending", "approved", "disabled"]).default("pending"),
    credentialRef: z.enum(["env:CUSTOMERS_AI_API_KEY", "env:RB2B_API_KEY", "env:PDL_API_KEY"]).nullable().optional(),
    attestations: z
      .object({
        exportRights: z.literal(true),
        normalizedStorageRights: z.literal(true),
        clientDisplayRights: z.literal(true),
        deletionRights: z.literal(true),
        replacementRights: z.literal(true),
        monthlyCommitmentUnder750: z.literal(true),
      })
      .strict()
      .optional(),
  })
  .strict();

async function auditProviderMutation(input: {
  organizationId: string;
  actorUserId: string | null;
  action: string;
  provider: string;
}) {
  await db.insert(agencyAuditEvents).values({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: "identity_provider",
    targetId: input.provider,
    metadata: {},
  });
}

export async function listIdentityProviderConnections(
  request: FastifyRequest<{ Params: { organizationId: string } }>,
  reply: FastifyReply
) {
  const principal = await getAgencyPrincipal(request, request.params.organizationId);
  if (!principal) return reply.status(403).send({ error: "Organization access is required" });
  const rows = await db
    .select({
      provider: identityProviderConnections.provider,
      externalAccountId: identityProviderConnections.externalAccountId,
      capabilities: identityProviderConnections.capabilities,
      status: identityProviderConnections.status,
      credentialRef: identityProviderConnections.credentialRef,
      policyAttestations: identityProviderConnections.policyAttestations,
      policyApprovedBy: identityProviderConnections.policyApprovedBy,
      policyApprovedAt: identityProviderConnections.policyApprovedAt,
      lastHealthCheckAt: identityProviderConnections.lastHealthCheckAt,
      lastHealthStatus: identityProviderConnections.lastHealthStatus,
    })
    .from(identityProviderConnections)
    .where(eq(identityProviderConnections.organizationId, request.params.organizationId));
  return reply.send({ data: rows });
}

export async function upsertIdentityProviderConnection(
  request: FastifyRequest<{ Params: { organizationId: string; provider: string }; Body: unknown }>,
  reply: FastifyReply
) {
  const params = paramsSchema.safeParse(request.params);
  const body = connectionSchema.safeParse(request.body);
  if (!params.success || !body.success) return reply.status(400).send({ error: "Invalid provider connection" });
  const principal = await getAgencyPrincipal(request, params.data.organizationId);
  if (!principal?.canManage) return reply.status(403).send({ error: "Organization administrator access is required" });
  if (body.data.status === "approved" && !body.data.attestations) {
    return reply.status(409).send({ error: "All provider contract and data-rights attestations are required" });
  }
  if (body.data.status === "approved" && params.data.provider !== "pdl" && !body.data.capabilities.includes("delete")) {
    return reply.status(409).send({ error: "Provider deletion capability is required before approval" });
  }
  if (
    body.data.status === "approved" &&
    params.data.provider !== "pdl" &&
    !body.data.capabilities.some(capability => capability === "resolve" || capability === "webhook")
  ) {
    return reply.status(409).send({ error: "A provider resolution transport is required before approval" });
  }
  if (body.data.status === "approved" && params.data.provider === "pdl" && !body.data.capabilities.includes("enrich")) {
    return reply.status(409).send({ error: "PDL enrichment capability is required before approval" });
  }
  const expectedCredentialRef = {
    customers_ai: "env:CUSTOMERS_AI_API_KEY",
    rb2b: "env:RB2B_API_KEY",
    pdl: "env:PDL_API_KEY",
  }[params.data.provider];
  if (body.data.credentialRef && body.data.credentialRef !== expectedCredentialRef) {
    return reply.status(400).send({ error: "Credential reference does not match the selected provider" });
  }
  const now = new Date().toISOString();
  const [connection] = await db
    .insert(identityProviderConnections)
    .values({
      organizationId: params.data.organizationId,
      provider: params.data.provider,
      externalAccountId: body.data.externalAccountId,
      capabilities: body.data.capabilities,
      status: body.data.status,
      credentialRef: body.data.credentialRef,
      policyAttestations: body.data.status === "approved" ? body.data.attestations : {},
      policyApprovedBy: body.data.status === "approved" ? principal.userId : null,
      policyApprovedAt: body.data.status === "approved" ? now : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [identityProviderConnections.organizationId, identityProviderConnections.provider],
      set: {
        externalAccountId: body.data.externalAccountId,
        capabilities: body.data.capabilities,
        status: body.data.status,
        credentialRef: body.data.credentialRef,
        policyAttestations: body.data.status === "approved" ? body.data.attestations : {},
        policyApprovedBy: body.data.status === "approved" ? principal.userId : null,
        policyApprovedAt: body.data.status === "approved" ? now : null,
        updatedAt: now,
      },
    })
    .returning({ id: identityProviderConnections.id, status: identityProviderConnections.status });
  await auditProviderMutation({
    organizationId: params.data.organizationId,
    actorUserId: principal.userId,
    action: "identity_provider.connection_updated",
    provider: params.data.provider,
  });
  return reply.send({ success: true, connection });
}

export async function testIdentityProviderConnection(
  request: FastifyRequest<{ Params: { organizationId: string; provider: string } }>,
  reply: FastifyReply
) {
  const parsed = paramsSchema.safeParse(request.params);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid provider" });
  const principal = await getAgencyPrincipal(request, parsed.data.organizationId);
  if (!principal?.canManage) return reply.status(403).send({ error: "Organization administrator access is required" });
  const [connection] = await db
    .select()
    .from(identityProviderConnections)
    .where(
      and(
        eq(identityProviderConnections.organizationId, parsed.data.organizationId),
        eq(identityProviderConnections.provider, parsed.data.provider)
      )
    )
    .limit(1);
  if (!connection) return reply.status(404).send({ error: "Provider connection not found" });
  const adapters = { customers_ai: customersAiResolver, rb2b: rb2bResolver, pdl: pdlEnrichmentProvider };
  const result = await adapters[parsed.data.provider].healthCheck();
  const now = new Date().toISOString();
  await db
    .update(identityProviderConnections)
    .set({ lastHealthCheckAt: now, lastHealthStatus: result.ok ? "healthy" : "failed", updatedAt: now })
    .where(eq(identityProviderConnections.id, connection.id));
  await auditProviderMutation({
    organizationId: parsed.data.organizationId,
    actorUserId: principal.userId,
    action: "identity_provider.health_checked",
    provider: parsed.data.provider,
  });
  return reply.status(result.ok ? 200 : 503).send({ provider: parsed.data.provider, ...result, checkedAt: now });
}
