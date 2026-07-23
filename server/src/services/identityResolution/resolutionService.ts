import { Queue, Worker, type Job } from "bullmq";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import type { IdentityProvider, ResolutionCandidate } from "@rybbit/shared";
import { db } from "../../db/postgres/postgres.js";
import { redis } from "../../db/redis/redis.js";
import {
  identityCandidates,
  identityConsentReceipts,
  identityProviderConnections,
  identityProviderUsage,
  identityResolutionAttempts,
  identitySuppressions,
  siteResolutionSettings,
  sites,
} from "../../db/postgres/schema.js";
import { createServiceLogger } from "../../lib/logger/logger.js";
import { persistIdentifiedUser } from "../tracker/identifyService.js";
import {
  createCorrelationToken,
  decryptResolutionEnvelope,
  deriveScopedIdentityKey,
  encryptResolutionEnvelope,
} from "../identity/identityCrypto.js";
import { customersAiResolver, rb2bResolver } from "./httpResolver.js";
import { pdlEnrichmentProvider } from "./pdlEnrichmentProvider.js";
import type { IdentityResolver } from "./types.js";
import { scoreIdentityCandidate } from "./leadIntelligence.js";

const QUEUE_NAME = "identity-resolution";
const ENVELOPE_TTL_MS = 10 * 60 * 1000;
const CANDIDATE_RETENTION_DAYS = 30;

type ResolutionJob = { attemptId: string; encryptedContext: string; queuedAt: number };
type ProviderDeletionJob = { provider: IdentityProvider; encryptedProviderSubject: string; queuedAt: number };
const DELETION_QUEUE_NAME = "identity-provider-deletion";

const redisConnection = () => ({
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT || 6379),
  ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
});

const resolvers: Record<IdentityProvider, IdentityResolver> = {
  customers_ai: customersAiResolver,
  rb2b: rb2bResolver,
};

const providerCostMicros = (provider: IdentityProvider) =>
  Math.max(0, Number(process.env[`${provider.toUpperCase()}_COST_MICROS`] || 0));

function safeFailure(error: unknown) {
  if (error instanceof Error && error.name) return error.name.slice(0, 80);
  return "ResolutionError";
}

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

type UsageDatabase = Pick<typeof db, "insert">;

async function addUsage(
  input: {
    siteId: number;
    provider: IdentityProvider | "pdl";
    matched: boolean;
    failed: boolean;
    latencyMs: number;
    costMicros: number;
  },
  database: UsageDatabase = db
) {
  await database
    .insert(identityProviderUsage)
    .values({
      siteId: input.siteId,
      provider: input.provider,
      usageDate: utcDate(),
      requests: 1,
      matches: input.matched ? 1 : 0,
      failures: input.failed ? 1 : 0,
      totalLatencyMs: input.latencyMs,
      estimatedCostMicros: input.costMicros,
    })
    .onConflictDoUpdate({
      target: [identityProviderUsage.siteId, identityProviderUsage.provider, identityProviderUsage.usageDate],
      set: {
        requests: sql`${identityProviderUsage.requests} + 1`,
        matches: sql`${identityProviderUsage.matches} + ${input.matched ? 1 : 0}`,
        failures: sql`${identityProviderUsage.failures} + ${input.failed ? 1 : 0}`,
        totalLatencyMs: sql`${identityProviderUsage.totalLatencyMs} + ${input.latencyMs}`,
        estimatedCostMicros: sql`${identityProviderUsage.estimatedCostMicros} + ${input.costMicros}`,
        updatedAt: sql`now()`,
      },
    });
}

type UsageOutcome = Parameters<typeof addUsage>[0];

async function recordAttemptOutcome(input: {
  attemptId: string;
  status: "matched" | "no_match" | "failed";
  confidence?: number;
  rejectionCode?: string;
  providerUsage: UsageOutcome;
  enrichmentUsage?: UsageOutcome | null;
}) {
  return db.transaction(async tx => {
    const [claimed] = await tx
      .update(identityResolutionAttempts)
      .set({
        status: input.status,
        confidence: input.confidence,
        rejectionCode: input.rejectionCode,
        estimatedCostMicros: input.providerUsage.costMicros,
        completedAt: new Date().toISOString(),
      })
      .where(and(eq(identityResolutionAttempts.id, input.attemptId), eq(identityResolutionAttempts.status, "queued")))
      .returning({ id: identityResolutionAttempts.id });
    if (!claimed) return false;
    await addUsage(input.providerUsage, tx);
    if (input.enrichmentUsage) {
      await addUsage(input.enrichmentUsage, tx);
    }
    return true;
  });
}

async function reserveBudget(input: {
  siteId: number;
  organizationId: string;
  dailyCap: number;
  monthlyBudgetCents: number;
  estimatedCostMicros: number;
}) {
  const monthStart = `${utcDate().slice(0, 7)}-01`;
  const [[siteUsage], [organizationUsage]] = await Promise.all([
    db
      .select({
        dailyRequests: sql<number>`coalesce(sum(case when ${identityProviderUsage.usageDate} = ${utcDate()} then ${identityProviderUsage.requests} else 0 end), 0)::int`,
        monthlyCostMicros: sql<number>`coalesce(sum(${identityProviderUsage.estimatedCostMicros}), 0)::bigint`,
      })
      .from(identityProviderUsage)
      .where(and(eq(identityProviderUsage.siteId, input.siteId), gte(identityProviderUsage.usageDate, monthStart))),
    db
      .select({
        monthlyCostMicros: sql<number>`coalesce(sum(${identityProviderUsage.estimatedCostMicros}), 0)::bigint`,
      })
      .from(identityProviderUsage)
      .innerJoin(sites, eq(sites.siteId, identityProviderUsage.siteId))
      .where(and(eq(sites.organizationId, input.organizationId), gte(identityProviderUsage.usageDate, monthStart))),
  ]);
  const dailyKey = `identity:budget:${input.siteId}:day:${utcDate()}:requests`;
  const monthlyKey = `identity:budget:${input.siteId}:month:${utcDate().slice(0, 7)}:micros`;
  const organizationMonthlyKey = `identity:budget:organization:${input.organizationId}:month:${utcDate().slice(0, 7)}:micros`;
  await Promise.all([
    redis.set(dailyKey, String(Number(siteUsage?.dailyRequests ?? 0)), "EX", 2 * 24 * 60 * 60, "NX"),
    redis.set(monthlyKey, String(Number(siteUsage?.monthlyCostMicros ?? 0)), "EX", 35 * 24 * 60 * 60, "NX"),
    redis.set(
      organizationMonthlyKey,
      String(Number(organizationUsage?.monthlyCostMicros ?? 0)),
      "EX",
      35 * 24 * 60 * 60,
      "NX"
    ),
  ]);
  const organizationMonthlyCapCents = Math.min(
    75_000,
    Math.max(0, Number(process.env.IDENTITY_PILOT_MONTHLY_BUDGET_CENTS || 75_000))
  );
  const reserved = await redis.eval(
    `
      local daily = tonumber(redis.call('GET', KEYS[1]) or '0')
      local monthly = tonumber(redis.call('GET', KEYS[2]) or '0')
      local organization_monthly = tonumber(redis.call('GET', KEYS[3]) or '0')
      local daily_cap = tonumber(ARGV[1])
      local monthly_cap = tonumber(ARGV[2])
      local request_cost = tonumber(ARGV[3])
      local organization_monthly_cap = tonumber(ARGV[4])
      if daily + 1 > daily_cap or monthly + request_cost > monthly_cap or organization_monthly + request_cost > organization_monthly_cap then
        return 0
      end
      redis.call('INCRBY', KEYS[1], 1)
      redis.call('INCRBY', KEYS[2], request_cost)
      redis.call('INCRBY', KEYS[3], request_cost)
      return 1
    `,
    3,
    dailyKey,
    monthlyKey,
    organizationMonthlyKey,
    input.dailyCap,
    input.monthlyBudgetCents * 10_000,
    input.estimatedCostMicros,
    organizationMonthlyCapCents * 10_000
  );
  return Number(reserved) === 1;
}

function mergeEnrichment(
  candidate: ResolutionCandidate,
  enrichment: Awaited<ReturnType<typeof pdlEnrichmentProvider.enrich>>
) {
  if (!enrichment) return candidate;
  const traits = { ...candidate.traits };
  for (const [field, value] of Object.entries(enrichment.traits)) {
    if (!value || field in traits) continue;
    Object.assign(traits, { [field]: value });
  }
  return { ...candidate, traits, provenance: [...candidate.provenance, ...enrichment.provenance] };
}

class IdentityResolutionService {
  private queue = new Queue<ResolutionJob>(QUEUE_NAME, { connection: redisConnection() });
  private deletionQueue = new Queue<ProviderDeletionJob>(DELETION_QUEUE_NAME, { connection: redisConnection() });
  private worker?: Worker<ResolutionJob>;
  private deletionWorker?: Worker<ProviderDeletionJob>;
  private initialized = false;
  private logger = createServiceLogger("identity-resolution");

  async initialize() {
    if (this.initialized) return;
    await this.queue.waitUntilReady();
    this.worker = new Worker<ResolutionJob>(QUEUE_NAME, job => this.process(job), {
      connection: redisConnection(),
      concurrency: 3,
    });
    this.worker.on("failed", (job, error) =>
      this.logger.error(
        { attemptId: job?.data.attemptId, errorName: safeFailure(error) },
        "Identity resolution job failed"
      )
    );
    await this.worker.waitUntilReady();
    await this.deletionQueue.waitUntilReady();
    this.deletionWorker = new Worker<ProviderDeletionJob>(
      DELETION_QUEUE_NAME,
      async job => {
        if (Date.now() - job.data.queuedAt > 7 * 24 * 60 * 60 * 1000) throw new Error("DeletionJobExpired");
        const envelope = decryptResolutionEnvelope(job.data.encryptedProviderSubject);
        const providerSubjectId = typeof envelope.providerSubjectId === "string" ? envelope.providerSubjectId : "";
        if (!providerSubjectId) throw new Error("DeletionSubjectInvalid");
        await resolvers[job.data.provider].deleteSubject(providerSubjectId);
      },
      { connection: redisConnection(), concurrency: 2 }
    );
    this.deletionWorker.on("failed", (job, error) =>
      this.logger.error(
        { provider: job?.data.provider, errorName: safeFailure(error) },
        "Provider identity deletion job failed"
      )
    );
    await this.deletionWorker.waitUntilReady();
    this.initialized = true;
  }

  async shutdown() {
    await this.worker?.close();
    await this.deletionWorker?.close();
    await this.queue.close();
    await this.deletionQueue.close();
    this.initialized = false;
  }

  async queueFromConsent(input: {
    siteId: number;
    sitePublicId: string;
    anonymousSubject: string;
    receiptId: string;
    ipAddress: string;
    userAgent: string;
  }) {
    const [settings] = await db
      .select()
      .from(siteResolutionSettings)
      .where(eq(siteResolutionSettings.siteId, input.siteId))
      .limit(1);
    if (!settings?.enabled || settings.complianceState !== "approved") return { queued: false, code: "DISABLED" };

    const [site] = await db.select().from(sites).where(eq(sites.siteId, input.siteId)).limit(1);
    if (!site?.organizationId) return { queued: false, code: "SITE_NOT_CONFIGURED" };
    const [connection] = await db
      .select()
      .from(identityProviderConnections)
      .where(
        and(
          eq(identityProviderConnections.organizationId, site.organizationId),
          eq(identityProviderConnections.provider, settings.primaryProvider),
          eq(identityProviderConnections.status, "approved")
        )
      )
      .limit(1);
    const requiredTransport = settings.transport === "server" ? "resolve" : "webhook";
    if (
      !connection?.policyApprovedAt ||
      connection.lastHealthStatus !== "healthy" ||
      !connection.capabilities.includes(requiredTransport)
    ) {
      return { queued: false, code: "PROVIDER_NOT_APPROVED" };
    }
    const [suppression] = await db
      .select({ key: identitySuppressions.suppressionKey })
      .from(identitySuppressions)
      .where(
        and(
          eq(identitySuppressions.siteId, input.siteId),
          eq(
            identitySuppressions.suppressionKey,
            deriveScopedIdentityKey(input.sitePublicId, "identity-suppression-v1", input.anonymousSubject)
          )
        )
      )
      .limit(1);
    if (suppression) return { queued: false, code: "SUPPRESSED" };
    const estimatedCostMicros =
      providerCostMicros(settings.primaryProvider as IdentityProvider) +
      (settings.enrichmentEnabled ? Math.max(0, Number(process.env.PDL_COST_MICROS || 0)) : 0);
    if (
      !(await reserveBudget({
        siteId: input.siteId,
        organizationId: site.organizationId,
        dailyCap: settings.dailyCap,
        monthlyBudgetCents: settings.monthlyBudgetCents,
        estimatedCostMicros,
      }))
    ) {
      return { queued: false, code: "BUDGET_EXHAUSTED" };
    }

    const expiresAt = Math.floor((Date.now() + ENVELOPE_TTL_MS) / 1000);
    const correlationToken = createCorrelationToken({
      sitePublicId: input.sitePublicId,
      anonymousSubject: input.anonymousSubject,
      receiptId: input.receiptId,
      expiresAt,
    });
    if (settings.transport === "pixel") {
      return { queued: false, pixel: true, correlationToken, expiresAt };
    }

    const [attempt] = await db
      .insert(identityResolutionAttempts)
      .values({
        siteId: input.siteId,
        anonymousSubject: input.anonymousSubject,
        provider: settings.primaryProvider,
        status: "queued",
        estimatedCostMicros: providerCostMicros(settings.primaryProvider as IdentityProvider),
      })
      .returning({ id: identityResolutionAttempts.id });
    const encryptedContext = encryptResolutionEnvelope({
      siteId: input.siteId,
      sitePublicId: input.sitePublicId,
      anonymousSubject: input.anonymousSubject,
      correlationToken,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    await this.queue.add(
      "resolve",
      { attemptId: attempt.id, encryptedContext, queuedAt: Date.now() },
      {
        jobId: `identity-resolution-${attempt.id}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: true,
        removeOnFail: { age: 600, count: 100 },
      }
    );
    return { queued: true, correlationToken, expiresAt };
  }

  async queueProviderDeletions(candidates: Array<{ id: string; provider: string; providerSubjectRef: string | null }>) {
    let queued = 0;
    for (const candidate of candidates) {
      if (!candidate.providerSubjectRef || !["customers_ai", "rb2b"].includes(candidate.provider)) continue;
      await this.deletionQueue.add(
        "delete-provider-subject",
        {
          provider: candidate.provider as IdentityProvider,
          encryptedProviderSubject: candidate.providerSubjectRef,
          queuedAt: Date.now(),
        },
        {
          jobId: `identity-provider-delete-${candidate.id}`,
          attempts: 10,
          backoff: { type: "exponential", delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: { age: 7 * 24 * 60 * 60, count: 1_000 },
        }
      );
      queued += 1;
    }
    return queued;
  }

  async ingestWebhookCandidates(input: {
    siteId: number;
    sitePublicId: string;
    anonymousSubject: string;
    provider: IdentityProvider;
    providerRequestId: string;
    candidates: ResolutionCandidate[];
  }) {
    const [settings] = await db
      .select()
      .from(siteResolutionSettings)
      .where(eq(siteResolutionSettings.siteId, input.siteId))
      .limit(1);
    const [webhookSite] = await db
      .select({ organizationId: sites.organizationId })
      .from(sites)
      .where(eq(sites.siteId, input.siteId))
      .limit(1);
    const [webhookConnection] = webhookSite?.organizationId
      ? await db
          .select({
            status: identityProviderConnections.status,
            policyApprovedAt: identityProviderConnections.policyApprovedAt,
            capabilities: identityProviderConnections.capabilities,
            lastHealthStatus: identityProviderConnections.lastHealthStatus,
          })
          .from(identityProviderConnections)
          .where(
            and(
              eq(identityProviderConnections.organizationId, webhookSite.organizationId),
              eq(identityProviderConnections.provider, input.provider)
            )
          )
          .limit(1)
      : [];
    if (
      !settings?.enabled ||
      settings.complianceState !== "approved" ||
      settings.primaryProvider !== input.provider ||
      settings.transport !== "pixel" ||
      webhookConnection?.status !== "approved" ||
      !webhookConnection.policyApprovedAt ||
      webhookConnection.lastHealthStatus !== "healthy" ||
      !webhookConnection.capabilities.includes("webhook")
    ) {
      return { accepted: false, code: "DISABLED" };
    }
    const hasConflict = input.candidates.length > 1;
    for (const candidate of input.candidates) {
      const providerSubjectKey = deriveScopedIdentityKey(
        input.sitePublicId,
        `provider-subject-${input.provider}-v1`,
        candidate.providerSubjectId
      );
      const providerSubjectRef = encryptResolutionEnvelope({ providerSubjectId: candidate.providerSubjectId });
      const deterministic =
        !hasConflict &&
        candidate.matchMethod === "deterministic" &&
        candidate.confidence >= settings.deterministicThreshold;
      const linkedUserId = deterministic && !settings.shadowMode ? `id_${providerSubjectKey}` : null;
      const icp = scoreIdentityCandidate(candidate, settings.icpCriteria || {});
      await db
        .insert(identityCandidates)
        .values({
          siteId: input.siteId,
          anonymousSubject: input.anonymousSubject,
          provider: input.provider,
          providerSubjectKey,
          providerSubjectRef,
          providerRequestId: input.providerRequestId,
          confidence: candidate.confidence,
          matchMethod: candidate.matchMethod,
          traits: candidate.traits,
          provenance: candidate.provenance,
          linkedUserId,
          icpScore: icp.score,
          expiresAt: new Date(Date.now() + CANDIDATE_RETENTION_DAYS * 86_400_000).toISOString(),
        })
        .onConflictDoUpdate({
          target: [identityCandidates.siteId, identityCandidates.provider, identityCandidates.providerSubjectKey],
          set: {
            anonymousSubject: input.anonymousSubject,
            providerRequestId: input.providerRequestId,
            providerSubjectRef,
            confidence: candidate.confidence,
            matchMethod: candidate.matchMethod,
            traits: candidate.traits,
            provenance: candidate.provenance,
            linkedUserId,
            icpScore: icp.score,
            updatedAt: sql`now()`,
          },
        });
      if (linkedUserId) {
        await persistIdentifiedUser({
          siteId: input.siteId,
          anonymousId: input.anonymousSubject,
          userId: linkedUserId,
          traits: candidate.traits,
          identitySource: "resolved",
        });
      }
    }
    const costMicros = providerCostMicros(input.provider);
    await Promise.all([
      db.insert(identityResolutionAttempts).values({
        siteId: input.siteId,
        anonymousSubject: input.anonymousSubject,
        provider: input.provider,
        status: input.candidates.length ? "matched" : "no_match",
        confidence: input.candidates[0]?.confidence,
        providerRequestId: input.providerRequestId,
        estimatedCostMicros: costMicros,
        completedAt: new Date().toISOString(),
      }),
      addUsage({
        siteId: input.siteId,
        provider: input.provider,
        matched: input.candidates.length > 0,
        failed: false,
        latencyMs: 0,
        costMicros,
      }),
    ]);
    return { accepted: true, count: input.candidates.length };
  }

  private async process(job: Job<ResolutionJob>) {
    if (Date.now() - job.data.queuedAt > ENVELOPE_TTL_MS) throw new Error("ResolutionEnvelopeExpired");
    const context = decryptResolutionEnvelope(job.data.encryptedContext) as {
      siteId: number;
      sitePublicId: string;
      anonymousSubject: string;
      correlationToken: string;
      ipAddress: string;
      userAgent: string;
    };
    const [settings] = await db
      .select()
      .from(siteResolutionSettings)
      .where(eq(siteResolutionSettings.siteId, context.siteId))
      .limit(1);
    const [runtimeSite] = await db
      .select({ organizationId: sites.organizationId })
      .from(sites)
      .where(eq(sites.siteId, context.siteId))
      .limit(1);
    const [runtimeConnection] = runtimeSite?.organizationId
      ? await db
          .select({
            status: identityProviderConnections.status,
            policyApprovedAt: identityProviderConnections.policyApprovedAt,
            capabilities: identityProviderConnections.capabilities,
            lastHealthStatus: identityProviderConnections.lastHealthStatus,
          })
          .from(identityProviderConnections)
          .where(
            and(
              eq(identityProviderConnections.organizationId, runtimeSite.organizationId),
              eq(identityProviderConnections.provider, settings?.primaryProvider ?? "")
            )
          )
          .limit(1)
      : [];
    const [consent] = await db
      .select({ id: identityConsentReceipts.id })
      .from(identityConsentReceipts)
      .where(
        and(
          eq(identityConsentReceipts.siteId, context.siteId),
          eq(identityConsentReceipts.anonymousSubject, context.anonymousSubject),
          eq(identityConsentReceipts.granted, true),
          isNull(identityConsentReceipts.withdrawnAt)
        )
      )
      .limit(1);
    if (
      !settings?.enabled ||
      settings.complianceState !== "approved" ||
      settings.transport !== "server" ||
      !consent ||
      runtimeConnection?.status !== "approved" ||
      !runtimeConnection.policyApprovedAt ||
      runtimeConnection.lastHealthStatus !== "healthy" ||
      !runtimeConnection.capabilities.includes("resolve")
    ) {
      await db
        .update(identityResolutionAttempts)
        .set({ status: "blocked", rejectionCode: "CONSENT_OR_SETTINGS_CHANGED", completedAt: new Date().toISOString() })
        .where(eq(identityResolutionAttempts.id, job.data.attemptId));
      return;
    }

    const provider = settings.primaryProvider as IdentityProvider;
    const [enrichmentConnection] =
      settings.enrichmentEnabled && runtimeSite?.organizationId
        ? await db
            .select({
              status: identityProviderConnections.status,
              policyApprovedAt: identityProviderConnections.policyApprovedAt,
              capabilities: identityProviderConnections.capabilities,
              lastHealthStatus: identityProviderConnections.lastHealthStatus,
            })
            .from(identityProviderConnections)
            .where(
              and(
                eq(identityProviderConnections.organizationId, runtimeSite.organizationId),
                eq(identityProviderConnections.provider, "pdl")
              )
            )
            .limit(1)
        : [];
    const enrichmentApproved =
      enrichmentConnection?.status === "approved" &&
      Boolean(enrichmentConnection.policyApprovedAt) &&
      enrichmentConnection.lastHealthStatus === "healthy" &&
      enrichmentConnection.capabilities.includes("enrich");
    const started = Date.now();
    let enrichmentUsage: UsageOutcome | null = null;
    try {
      const candidates = await resolvers[provider].resolve({
        siteId: context.siteId,
        sitePublicId: context.sitePublicId,
        anonymousSubject: context.anonymousSubject,
        correlationToken: context.correlationToken,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      const costMicros = providerCostMicros(provider);
      const hasConflict = candidates.length > 1;
      for (const original of candidates) {
        let candidate = original;
        if (
          settings.enrichmentEnabled &&
          settings.enrichmentProvider === "pdl" &&
          enrichmentApproved &&
          !hasConflict &&
          candidate.confidence >= settings.enrichmentThreshold
        ) {
          const enrichStarted = Date.now();
          try {
            const enrichment = await pdlEnrichmentProvider.enrich(candidate.traits);
            candidate = mergeEnrichment(candidate, enrichment);
            enrichmentUsage = {
              siteId: context.siteId,
              provider: "pdl",
              matched: Boolean(enrichment),
              failed: false,
              latencyMs: Date.now() - enrichStarted,
              costMicros: Number(process.env.PDL_COST_MICROS || 0),
            };
          } catch (error) {
            enrichmentUsage = {
              siteId: context.siteId,
              provider: "pdl",
              matched: false,
              failed: true,
              latencyMs: Date.now() - enrichStarted,
              costMicros: 0,
            };
            this.logger.warn({ siteId: context.siteId, errorName: safeFailure(error) }, "Optional enrichment failed");
          }
        }
        const providerSubjectKey = deriveScopedIdentityKey(
          context.sitePublicId,
          `provider-subject-${provider}-v1`,
          candidate.providerSubjectId
        );
        const providerSubjectRef = encryptResolutionEnvelope({ providerSubjectId: candidate.providerSubjectId });
        const deterministic =
          !hasConflict &&
          candidate.matchMethod === "deterministic" &&
          candidate.confidence >= settings.deterministicThreshold;
        const linkedUserId = deterministic && !settings.shadowMode ? `id_${providerSubjectKey}` : null;
        const icp = scoreIdentityCandidate(candidate, settings.icpCriteria || {});
        await db
          .insert(identityCandidates)
          .values({
            siteId: context.siteId,
            anonymousSubject: context.anonymousSubject,
            provider,
            providerSubjectKey,
            providerSubjectRef,
            confidence: candidate.confidence,
            matchMethod: candidate.matchMethod,
            traits: candidate.traits,
            provenance: candidate.provenance,
            linkedUserId,
            icpScore: icp.score,
            expiresAt: new Date(Date.now() + CANDIDATE_RETENTION_DAYS * 86_400_000).toISOString(),
          })
          .onConflictDoUpdate({
            target: [identityCandidates.siteId, identityCandidates.provider, identityCandidates.providerSubjectKey],
            set: {
              confidence: candidate.confidence,
              matchMethod: candidate.matchMethod,
              traits: candidate.traits,
              provenance: candidate.provenance,
              anonymousSubject: context.anonymousSubject,
              providerSubjectRef,
              linkedUserId,
              icpScore: icp.score,
              expiresAt: new Date(Date.now() + CANDIDATE_RETENTION_DAYS * 86_400_000).toISOString(),
              updatedAt: sql`now()`,
            },
          });
        if (linkedUserId) {
          await persistIdentifiedUser({
            siteId: context.siteId,
            anonymousId: context.anonymousSubject,
            userId: linkedUserId,
            traits: candidate.traits,
            identitySource: "resolved",
          });
        }
      }
      await recordAttemptOutcome({
        attemptId: job.data.attemptId,
        status: candidates.length ? "matched" : "no_match",
        confidence: candidates[0]?.confidence,
        providerUsage: {
          siteId: context.siteId,
          provider,
          matched: candidates.length > 0,
          failed: false,
          latencyMs: Date.now() - started,
          costMicros,
        },
        enrichmentUsage,
      });
    } catch (error) {
      const attemptsAllowed = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
      const terminalFailure = job.attemptsMade + 1 >= attemptsAllowed;
      if (terminalFailure) {
        await recordAttemptOutcome({
          attemptId: job.data.attemptId,
          status: "failed",
          rejectionCode: safeFailure(error),
          providerUsage: {
            siteId: context.siteId,
            provider,
            matched: false,
            failed: true,
            latencyMs: Date.now() - started,
            costMicros: 0,
          },
          enrichmentUsage,
        });
      }
      throw error;
    }
  }
}

export const identityResolutionService = new IdentityResolutionService();
