import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../../db/postgres/postgres.js";
import {
  agencyAuditEvents,
  identityActivationReviews,
  identityCandidates,
  identityProviderConnections,
  identityProviderUsage,
  identitySuppressions,
  siteResolutionSettings,
  sites,
} from "../../db/postgres/schema.js";
import { getIdentityComplianceBlock } from "../../services/identity/identityCompliance.js";
import { persistIdentifiedUser } from "../../services/tracker/identifyService.js";
import { sendCandidateToGhl } from "../../services/identityResolution/ghlActivation.js";
import { generateLeadBrief, scoreIdentityCandidate } from "../../services/identityResolution/leadIntelligence.js";
import { deriveScopedIdentityKey } from "../../services/identity/identityCrypto.js";
import { identityResolutionService } from "../../services/identityResolution/resolutionService.js";

const providerSchema = z.enum(["customers_ai", "rb2b"]);
const settingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.enum(["consumer", "business"]).optional(),
    primaryProvider: providerSchema.optional(),
    transport: z.enum(["server", "pixel"]).optional(),
    enrichmentEnabled: z.boolean().optional(),
    enrichmentProvider: z.literal("pdl").nullable().optional(),
    shadowMode: z.boolean().optional(),
    deterministicThreshold: z.number().min(0).max(1).optional(),
    enrichmentThreshold: z.number().min(0).max(1).optional(),
    dailyCap: z.number().int().min(0).max(100_000).optional(),
    monthlyBudgetCents: z.number().int().min(0).max(75_000).optional(),
    complianceState: z.enum(["pending", "approved", "blocked"]).optional(),
    policyVersion: z.string().trim().min(1).max(100).optional(),
    icpCriteria: z
      .object({
        companyKeywords: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
        titleKeywords: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
        minimumConfidence: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
    phoneEnabled: z.literal(false).optional(),
  })
  .strict();

async function resolveSite(siteParam: string) {
  const siteId = Number(siteParam);
  if (!Number.isSafeInteger(siteId) || siteId <= 0) return null;
  const [site] = await db.select().from(sites).where(eq(sites.siteId, siteId)).limit(1);
  return site ?? null;
}

async function audit(site: typeof sites.$inferSelect, actorUserId: string | null, action: string, targetId: string) {
  if (!site.organizationId) return;
  await db.insert(agencyAuditEvents).values({
    organizationId: site.organizationId,
    actorUserId,
    action,
    targetType: "identity_resolution",
    targetId,
    metadata: {},
  });
}

function serializeSettings(siteId: number, row?: typeof siteResolutionSettings.$inferSelect) {
  return {
    siteId,
    enabled: row?.enabled ?? false,
    mode: row?.mode ?? "consumer",
    primaryProvider: row?.primaryProvider ?? "customers_ai",
    transport: row?.transport ?? "server",
    enrichmentProvider: row?.enrichmentProvider ?? null,
    enrichmentEnabled: row?.enrichmentEnabled ?? false,
    shadowMode: row?.shadowMode ?? true,
    deterministicThreshold: row?.deterministicThreshold ?? 0.95,
    enrichmentThreshold: row?.enrichmentThreshold ?? 0.8,
    dailyCap: row?.dailyCap ?? 100,
    monthlyBudgetCents: row?.monthlyBudgetCents ?? 75_000,
    complianceState: row?.complianceState ?? "pending",
    policyVersion: row?.policyVersion ?? "identity-v1",
    icpCriteria: row?.icpCriteria ?? {},
    phoneEnabled: false as const,
    createdAt: row?.createdAt ?? new Date().toISOString(),
    updatedAt: row?.updatedAt ?? new Date().toISOString(),
  };
}

export async function getResolutionSettings(
  request: FastifyRequest<{ Params: { siteId: string } }>,
  reply: FastifyReply
) {
  const site = await resolveSite(request.params.siteId);
  if (!site) return reply.status(404).send({ error: "Site not found" });
  const [settings] = await db
    .select()
    .from(siteResolutionSettings)
    .where(eq(siteResolutionSettings.siteId, site.siteId))
    .limit(1);
  const complianceReason = getIdentityComplianceBlock(site.domain);
  return reply.send({
    settings: serializeSettings(site.siteId, settings),
    complianceBlocked: Boolean(complianceReason),
    complianceReason,
  });
}

export async function updateResolutionSettings(
  request: FastifyRequest<{ Params: { siteId: string }; Body: unknown }>,
  reply: FastifyReply
) {
  const site = await resolveSite(request.params.siteId);
  if (!site) return reply.status(404).send({ error: "Site not found" });
  const parsed = settingsSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid request", details: parsed.error.flatten() });
  const existing = await db
    .select()
    .from(siteResolutionSettings)
    .where(eq(siteResolutionSettings.siteId, site.siteId))
    .limit(1)
    .then(rows => rows[0]);
  const requested = { ...serializeSettings(site.siteId, existing), ...parsed.data };
  const expectedProvider = requested.mode === "consumer" ? "customers_ai" : "rb2b";
  if (requested.primaryProvider !== expectedProvider) {
    return reply.status(400).send({
      error: `The ${requested.mode} site mode requires the ${expectedProvider} provider`,
      code: "PROVIDER_MODE_MISMATCH",
    });
  }
  const complianceReason = getIdentityComplianceBlock(site.domain);
  if (requested.enabled && (complianceReason || requested.complianceState !== "approved")) {
    return reply.status(423).send({
      error: complianceReason || "Compliance approval is required before identity resolution can be enabled",
      code: "COMPLIANCE_BLOCKED",
    });
  }
  if (requested.enabled) {
    if (!site.organizationId) return reply.status(409).send({ error: "Site organization is not configured" });
    const [connection] = await db
      .select({
        status: identityProviderConnections.status,
        policyApprovedAt: identityProviderConnections.policyApprovedAt,
        capabilities: identityProviderConnections.capabilities,
        lastHealthStatus: identityProviderConnections.lastHealthStatus,
      })
      .from(identityProviderConnections)
      .where(
        and(
          eq(identityProviderConnections.organizationId, site.organizationId),
          eq(identityProviderConnections.provider, requested.primaryProvider)
        )
      )
      .limit(1);
    if (connection?.status !== "approved" || !connection.policyApprovedAt) {
      return reply.status(409).send({
        error: "The selected provider has not passed the contract and policy gate",
        code: "PROVIDER_NOT_APPROVED",
      });
    }
    const requiredTransport = requested.transport === "server" ? "resolve" : "webhook";
    if (!connection.capabilities.includes(requiredTransport) || connection.lastHealthStatus !== "healthy") {
      return reply.status(409).send({
        error: `The selected provider has not passed its ${requiredTransport} transport health gate`,
        code: "PROVIDER_NOT_HEALTHY",
      });
    }
    if (requested.enrichmentEnabled) {
      const [enrichmentConnection] = await db
        .select({
          status: identityProviderConnections.status,
          policyApprovedAt: identityProviderConnections.policyApprovedAt,
          capabilities: identityProviderConnections.capabilities,
          lastHealthStatus: identityProviderConnections.lastHealthStatus,
        })
        .from(identityProviderConnections)
        .where(
          and(
            eq(identityProviderConnections.organizationId, site.organizationId),
            eq(identityProviderConnections.provider, "pdl")
          )
        )
        .limit(1);
      if (
        enrichmentConnection?.status !== "approved" ||
        !enrichmentConnection.policyApprovedAt ||
        !enrichmentConnection.capabilities.includes("enrich") ||
        enrichmentConnection.lastHealthStatus !== "healthy"
      ) {
        return reply.status(409).send({
          error: "PDL has not passed its contract and health gates",
          code: "ENRICHMENT_PROVIDER_NOT_APPROVED",
        });
      }
    }
  }
  const now = new Date().toISOString();
  await db
    .insert(siteResolutionSettings)
    .values({
      siteId: site.siteId,
      enabled: requested.enabled,
      mode: requested.mode,
      primaryProvider: requested.primaryProvider,
      transport: requested.transport,
      enrichmentEnabled: requested.enrichmentEnabled,
      enrichmentProvider: requested.enrichmentProvider,
      shadowMode: requested.shadowMode,
      deterministicThreshold: requested.deterministicThreshold,
      enrichmentThreshold: requested.enrichmentThreshold,
      dailyCap: requested.dailyCap,
      monthlyBudgetCents: requested.monthlyBudgetCents,
      complianceState: requested.complianceState,
      policyVersion: requested.policyVersion,
      icpCriteria: requested.icpCriteria,
      phoneEnabled: false,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: siteResolutionSettings.siteId,
      set: { ...parsed.data, phoneEnabled: false, updatedAt: now },
    });
  await audit(site, request.user?.id ?? null, "site.resolution_settings_updated", String(site.siteId));
  const [updated] = await db
    .select()
    .from(siteResolutionSettings)
    .where(eq(siteResolutionSettings.siteId, site.siteId))
    .limit(1);
  return reply.send({ settings: serializeSettings(site.siteId, updated) });
}

const candidateQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "suppressed", "expired"]).optional(),
  provider: providerSchema.optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function listIdentityCandidates(
  request: FastifyRequest<{ Params: { siteId: string }; Querystring: unknown }>,
  reply: FastifyReply
) {
  const site = await resolveSite(request.params.siteId);
  if (!site) return reply.status(404).send({ error: "Site not found" });
  const parsed = candidateQuerySchema.safeParse(request.query);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
  const conditions = [eq(identityCandidates.siteId, site.siteId)];
  if (parsed.data.status) conditions.push(eq(identityCandidates.reviewStatus, parsed.data.status));
  if (parsed.data.provider) conditions.push(eq(identityCandidates.provider, parsed.data.provider));
  if (parsed.data.minConfidence !== undefined)
    conditions.push(gte(identityCandidates.confidence, parsed.data.minConfidence));
  const where = and(...conditions);
  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: identityCandidates.id,
        siteId: identityCandidates.siteId,
        provider: identityCandidates.provider,
        confidence: identityCandidates.confidence,
        matchMethod: identityCandidates.matchMethod,
        traits: identityCandidates.traits,
        provenance: identityCandidates.provenance,
        reviewStatus: identityCandidates.reviewStatus,
        linkedUserId: identityCandidates.linkedUserId,
        crmContactId: identityCandidates.crmContactId,
        icpScore: identityCandidates.icpScore,
        aiBrief: identityCandidates.aiBrief,
        createdAt: identityCandidates.createdAt,
        expiresAt: identityCandidates.expiresAt,
      })
      .from(identityCandidates)
      .where(where)
      .orderBy(desc(identityCandidates.createdAt))
      .limit(parsed.data.pageSize)
      .offset((parsed.data.page - 1) * parsed.data.pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(identityCandidates)
      .where(where),
  ]);
  return reply.send({
    data: rows,
    totalCount: Number(countRows[0]?.count ?? 0),
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  });
}

const actionSchema = z.object({ sendToCrm: z.boolean().default(false) }).strict();

async function candidateAction(
  request: FastifyRequest<{ Params: { siteId: string; candidateId: string }; Body: unknown }>,
  reply: FastifyReply,
  decision: "approved" | "rejected" | "suppressed"
) {
  const site = await resolveSite(request.params.siteId);
  if (!site) return reply.status(404).send({ error: "Site not found" });
  const parsed = actionSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: "Invalid request" });
  if (decision !== "approved" && parsed.data.sendToCrm)
    return reply.status(400).send({ error: "Only approved candidates can be routed" });
  const [candidate] = await db
    .select()
    .from(identityCandidates)
    .where(and(eq(identityCandidates.siteId, site.siteId), eq(identityCandidates.id, request.params.candidateId)))
    .limit(1);
  if (!candidate) return reply.status(404).send({ error: "Candidate not found" });
  if (candidate.reviewStatus !== "pending")
    return reply.status(409).send({ error: "Candidate has already been reviewed" });

  let linkedUserId: string | null = null;
  let crm = { status: null as string | null, contactId: null as string | null };
  if (decision === "approved") {
    linkedUserId = `id_${candidate.providerSubjectKey}`;
    await persistIdentifiedUser({
      siteId: site.siteId,
      anonymousId: candidate.anonymousSubject,
      userId: linkedUserId,
      traits: candidate.traits,
      identitySource: "resolved",
    });
    if (parsed.data.sendToCrm) crm = await sendCandidateToGhl({ siteId: site.siteId, traits: candidate.traits as any });
  }
  const now = new Date().toISOString();
  if (decision === "suppressed") {
    await identityResolutionService.queueProviderDeletions([candidate]);
  }
  await db.transaction(async tx => {
    await tx
      .update(identityCandidates)
      .set({ reviewStatus: decision, linkedUserId, crmContactId: crm.contactId, reviewedAt: now, updatedAt: now })
      .where(eq(identityCandidates.id, candidate.id));
    await tx.insert(identityActivationReviews).values({
      siteId: site.siteId,
      candidateId: candidate.id,
      reviewerId: request.user?.id ?? null,
      decision,
      crmStatus: crm.status,
      crmContactId: crm.contactId,
      sanitizedResult: crm.status ? { status: crm.status } : {},
    });
    if (decision === "suppressed" && site.id) {
      await tx
        .insert(identitySuppressions)
        .values({
          siteId: site.siteId,
          suppressionKey: deriveScopedIdentityKey(site.id, "identity-suppression-v1", candidate.anonymousSubject),
          reason: "reviewer_suppressed",
        })
        .onConflictDoNothing();
    }
  });
  await audit(site, request.user?.id ?? null, `identity_candidate.${decision}`, candidate.id);
  return reply.send({ success: true, linkedUserId, crm });
}

export const approveIdentityCandidate = (request: any, reply: FastifyReply) =>
  candidateAction(request, reply, "approved");
export const rejectIdentityCandidate = (request: any, reply: FastifyReply) =>
  candidateAction(request, reply, "rejected");
export const suppressIdentityCandidate = (request: any, reply: FastifyReply) =>
  candidateAction(request, reply, "suppressed");

export async function getProviderUsage(request: FastifyRequest<{ Params: { siteId: string } }>, reply: FastifyReply) {
  const site = await resolveSite(request.params.siteId);
  if (!site) return reply.status(404).send({ error: "Site not found" });
  const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
  const rows = await db
    .select()
    .from(identityProviderUsage)
    .where(and(eq(identityProviderUsage.siteId, site.siteId), gte(identityProviderUsage.usageDate, monthStart)))
    .orderBy(desc(identityProviderUsage.usageDate));
  const totals = rows.reduce(
    (sum, row) => ({
      requests: sum.requests + row.requests,
      matches: sum.matches + row.matches,
      failures: sum.failures + row.failures,
      estimatedCostMicros: sum.estimatedCostMicros + row.estimatedCostMicros,
    }),
    { requests: 0, matches: 0, failures: 0, estimatedCostMicros: 0 }
  );
  return reply.send({
    data: rows,
    totals: { ...totals, estimatedCostDollars: totals.estimatedCostMicros / 1_000_000 },
  });
}

export async function generateIdentityCandidateBrief(
  request: FastifyRequest<{ Params: { siteId: string; candidateId: string } }>,
  reply: FastifyReply
) {
  const site = await resolveSite(request.params.siteId);
  if (!site) return reply.status(404).send({ error: "Site not found" });
  const [candidate] = await db
    .select()
    .from(identityCandidates)
    .where(and(eq(identityCandidates.siteId, site.siteId), eq(identityCandidates.id, request.params.candidateId)))
    .limit(1);
  if (!candidate) return reply.status(404).send({ error: "Candidate not found" });
  const [settings] = await db
    .select({ icpCriteria: siteResolutionSettings.icpCriteria })
    .from(siteResolutionSettings)
    .where(eq(siteResolutionSettings.siteId, site.siteId))
    .limit(1);
  const scoring = scoreIdentityCandidate(
    { confidence: candidate.confidence, traits: candidate.traits as any },
    settings?.icpCriteria ?? {}
  );
  if (candidate.aiBrief && candidate.icpScore === scoring.score) {
    return reply.send({ score: scoring.score, reasons: scoring.reasons, brief: candidate.aiBrief, cached: true });
  }
  const brief = await generateLeadBrief({
    candidate: {
      confidence: candidate.confidence,
      matchMethod: candidate.matchMethod as "deterministic" | "probabilistic",
      traits: candidate.traits as any,
    },
    score: scoring.score,
    reasons: scoring.reasons,
  });
  const now = new Date().toISOString();
  await db
    .update(identityCandidates)
    .set({ icpScore: scoring.score, aiBrief: brief, briefGeneratedAt: now, updatedAt: now })
    .where(eq(identityCandidates.id, candidate.id));
  await audit(site, request.user?.id ?? null, "identity_candidate.brief_generated", candidate.id);
  return reply.send({ score: scoring.score, reasons: scoring.reasons, brief, cached: false });
}
