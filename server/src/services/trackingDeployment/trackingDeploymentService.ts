import { Queue, Worker, type Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/postgres/postgres.js";
import {
  agencyAuditEvents,
  agencyClientSites,
  agencyClients,
  sites,
  trackingDeployments,
} from "../../db/postgres/schema.js";
import { createServiceLogger } from "../../lib/logger/logger.js";
import { CloudflareTrackingProvider, type TrackingSite } from "./cloudflareProvider.js";
import { VercelTrackingProvider } from "./vercelProvider.js";
import { detectWordPress, manualPlan } from "./wordpressProvider.js";

const QUEUE_NAME = "tracking-deployments";

type TrackingJob = { deploymentId: string };
type DeploymentInput = {
  preferredProvider?: "auto" | "cloudflare" | "vercel" | "wordpress" | "manual";
  vercelProject?: string;
  sourceDeploymentId?: string;
  autoApply?: boolean;
  autoMerge?: boolean;
};

const redisConnection = () => ({
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT || 6379),
  ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
});

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Unknown tracking deployment failure")
    .replace(/[\r\n]+/g, " ")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .slice(0, 500);
}

function analyticsOrigin() {
  return (process.env.TRACKING_ANALYTICS_ORIGIN || process.env.BASE_URL || "").replace(/\/+$/, "");
}

function cloudflareProvider() {
  const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API;
  const accountId = process.env.CF_ACCOUNT_ID;
  const origin = analyticsOrigin();
  if (!token || !accountId || !origin) return null;
  return new CloudflareTrackingProvider({
    token,
    accountId,
    analyticsOrigin: origin,
    pathPrefix: process.env.TRACKING_PATH_PREFIX || "/__bold-analytics",
    workerPrefix: process.env.TRACKING_WORKER_PREFIX || "bold-analytics-tracker",
  });
}

function vercelProvider() {
  const token = process.env.VERCEL_TOKEN;
  const githubToken = process.env.GITHUB_TOKEN;
  const origin = analyticsOrigin();
  if (!token || !githubToken || !origin) return null;
  return new VercelTrackingProvider({
    token,
    githubToken,
    analyticsOrigin: origin,
    teamId: process.env.VERCEL_TEAM_ID || undefined,
  });
}

async function getDeploymentContext(deploymentId: string) {
  const [row] = await db
    .select({
      deployment: trackingDeployments,
      organizationId: agencyClients.organizationId,
      hostname: sites.domain,
      trackingId: sites.id,
      assignmentId: agencyClientSites.id,
    })
    .from(trackingDeployments)
    .innerJoin(agencyClients, eq(agencyClients.id, trackingDeployments.clientId))
    .innerJoin(
      agencyClientSites,
      and(
        eq(agencyClientSites.clientId, trackingDeployments.clientId),
        eq(agencyClientSites.siteId, trackingDeployments.siteId)
      )
    )
    .innerJoin(sites, eq(sites.siteId, trackingDeployments.siteId))
    .where(eq(trackingDeployments.id, deploymentId))
    .limit(1);
  return row ?? null;
}

function publicCredentialBlock(site: TrackingSite, provider: "cloudflare" | "vercel") {
  return {
    hostname: site.hostname,
    provider,
    supported: false,
    installed: false,
    blocked: true,
    reason: `${provider === "cloudflare" ? "Cloudflare" : "Vercel and GitHub"} deployment credentials are not configured on the analytics server`,
  };
}

export class TrackingDeploymentService {
  private queue = new Queue<TrackingJob>(QUEUE_NAME, { connection: redisConnection() });
  private worker?: Worker<TrackingJob>;
  private initialized = false;
  private logger = createServiceLogger("tracking-deployments");

  async initialize() {
    if (this.initialized) return;
    await this.queue.waitUntilReady();
    this.worker = new Worker<TrackingJob>(QUEUE_NAME, job => this.process(job), {
      connection: redisConnection(),
      concurrency: 2,
    });
    this.worker.on("failed", (job, error) =>
      this.logger.error({ deploymentId: job?.data.deploymentId, err: error }, "Tracking deployment job failed")
    );
    await this.worker.waitUntilReady();
    const queued = await db
      .select({ id: trackingDeployments.id })
      .from(trackingDeployments)
      .where(eq(trackingDeployments.status, "queued"));
    for (const deployment of queued) await this.queueDeployment(deployment.id);
    this.initialized = true;
    this.logger.info("Tracking deployment worker initialized");
  }

  async shutdown() {
    await this.worker?.close();
    await this.queue.close();
    this.initialized = false;
  }

  async queueDeployment(deploymentId: string) {
    const jobId = `tracking-deployment-${deploymentId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "failed" || state === "completed") await existing.remove();
      else return;
    }
    await this.queue.add(
      "tracking-deployment",
      { deploymentId },
      {
        jobId,
        attempts: 2,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 86_400, count: 500 },
        removeOnFail: { age: 604_800, count: 500 },
      }
    );
  }

  private async process(job: Job<TrackingJob>) {
    const context = await getDeploymentContext(job.data.deploymentId);
    if (!context) return;
    if (["succeeded", "blocked"].includes(context.deployment.status)) return;

    const startedAt = new Date().toISOString();
    await db
      .update(trackingDeployments)
      .set({ status: "running", startedAt, updatedAt: startedAt, errorSummary: null })
      .where(eq(trackingDeployments.id, context.deployment.id));

    try {
      const input = context.deployment.input as DeploymentInput;
      if (!context.trackingId) throw new Error("The website does not have a public tracking property ID");
      const site = {
        hostname: context.hostname.toLowerCase(),
        siteId: context.deployment.siteId,
        trackingId: context.trackingId,
      };
      let result: Record<string, any>;
      if (context.deployment.action === "plan") {
        const plan = await this.plan(site, input);
        result =
          input.autoApply && !plan.blocked && plan.supported && !plan.installed
            ? await this.applyPlan(site, plan, input.autoMerge === true)
            : plan;
      } else if (context.deployment.action === "apply") result = await this.apply(site, input);
      else if (context.deployment.action === "status") result = await this.status(site, input);
      else result = await this.rollback(site, input);

      const completedAt = new Date().toISOString();
      const status = result.blocked ? "blocked" : "succeeded";
      const provider = result.provider ?? context.deployment.provider;
      await db.transaction(async tx => {
        await tx
          .update(trackingDeployments)
          .set({ provider, status, result, completedAt, updatedAt: completedAt, errorSummary: null })
          .where(eq(trackingDeployments.id, context.deployment.id));

        if (
          (context.deployment.action === "apply" ||
            (context.deployment.action === "plan" && input.autoApply && result.autoApplied)) &&
          status === "succeeded"
        ) {
          await tx
            .update(agencyClientSites)
            .set({
              trackingMethod: provider === "cloudflare" ? "proxy" : "script",
              trackingStatus: "pending",
              lastCheckedAt: completedAt,
            })
            .where(eq(agencyClientSites.id, context.assignmentId));
        } else if (context.deployment.action === "rollback" && status === "succeeded") {
          await tx
            .update(agencyClientSites)
            .set({ trackingStatus: "pending", lastCheckedAt: completedAt })
            .where(eq(agencyClientSites.id, context.assignmentId));
        }

        await tx.insert(agencyAuditEvents).values({
          organizationId: context.organizationId,
          clientId: context.deployment.clientId,
          actorUserId: context.deployment.actorUserId,
          action: `client.tracking_${context.deployment.action}_${status}`,
          targetType: "tracking_deployment",
          targetId: context.deployment.id,
          metadata: { siteId: site.siteId, provider },
        });
      });
    } catch (error) {
      const errorSummary = safeError(error);
      const completedAt = new Date().toISOString();
      await db
        .update(trackingDeployments)
        .set({ status: "failed", errorSummary, completedAt, updatedAt: completedAt })
        .where(eq(trackingDeployments.id, context.deployment.id));
      throw error;
    }
  }

  private async plan(site: TrackingSite, input: DeploymentInput) {
    if (process.env.TRACKING_INSTALLER_ENABLED !== "true") {
      return manualPlan(site, "Managed tracking installation is disabled on this environment");
    }
    const preferred = input.preferredProvider ?? "auto";
    if (preferred === "manual") return manualPlan(site);

    const cloudflare = cloudflareProvider();
    if (preferred === "cloudflare") {
      return cloudflare ? cloudflare.plan(site) : publicCredentialBlock(site, "cloudflare");
    }
    if (preferred === "auto" && cloudflare) {
      try {
        const plan = await cloudflare.plan(site);
        if (plan.supported || plan.installed) return plan;
      } catch (error) {
        this.logger.info(
          { hostname: site.hostname, error: safeError(error) },
          "Cloudflare auto-detection did not match"
        );
      }
    }

    const vercel = vercelProvider();
    if (preferred === "vercel") {
      return vercel ? vercel.plan(site, input.vercelProject) : publicCredentialBlock(site, "vercel");
    }
    if (preferred === "auto" && vercel) {
      try {
        return await vercel.plan(site, input.vercelProject);
      } catch (error) {
        this.logger.info({ hostname: site.hostname, error: safeError(error) }, "Vercel auto-detection did not match");
      }
    }

    const wordpress = await detectWordPress(site);
    if (wordpress) return wordpress;
    return manualPlan(site);
  }

  private async sourceDeployment(input: DeploymentInput, site: TrackingSite) {
    if (!input.sourceDeploymentId) throw new Error("A source deployment is required");
    const [source] = await db
      .select()
      .from(trackingDeployments)
      .where(eq(trackingDeployments.id, input.sourceDeploymentId))
      .limit(1);
    if (!source || !["succeeded", "blocked"].includes(source.status)) {
      throw new Error("The source deployment is not ready");
    }
    if (source.siteId !== site.siteId) throw new Error("The source deployment belongs to another website");
    return source;
  }

  private async applyPlan(site: TrackingSite, plan: Record<string, any>, autoMerge: boolean) {
    if (plan.provider === "cloudflare") {
      const provider = cloudflareProvider();
      const result = provider ? await provider.apply(site) : publicCredentialBlock(site, "cloudflare");
      return { ...result, autoApplied: !result.blocked };
    }
    if (plan.provider === "vercel") {
      const provider = vercelProvider();
      const result = provider
        ? await provider.apply(site, plan.project, { autoMerge })
        : publicCredentialBlock(site, "vercel");
      return { ...result, autoApplied: !result.blocked };
    }
    return { ...plan, blocked: true, supported: false, autoApplied: false };
  }

  private async apply(site: TrackingSite, input: DeploymentInput) {
    const source = await this.sourceDeployment(input, site);
    const result = source.result as Record<string, any>;
    if (source.action !== "plan") throw new Error("Apply requires a completed plan");
    if (source.status === "blocked" || result.blocked) return result;
    if (source.provider === "cloudflare") {
      const provider = cloudflareProvider();
      return provider ? provider.apply(site) : publicCredentialBlock(site, "cloudflare");
    }
    if (source.provider === "vercel") {
      const provider = vercelProvider();
      return provider ? provider.apply(site, result.project) : publicCredentialBlock(site, "vercel");
    }
    return { ...result, blocked: true, supported: false };
  }

  private async status(site: TrackingSite, input: DeploymentInput) {
    const source = await this.sourceDeployment(input, site);
    const result = source.result as Record<string, any>;
    if (source.provider === "vercel") {
      const provider = vercelProvider();
      return provider ? provider.status(site, result.project) : publicCredentialBlock(site, "vercel");
    }
    if (source.provider === "cloudflare") {
      const provider = cloudflareProvider();
      if (!provider) return publicCredentialBlock(site, "cloudflare");
      const plan = await provider.plan(site);
      return plan.installed ? { ...plan, verification: await provider.verify(site) } : plan;
    }
    return result;
  }

  private async rollback(site: TrackingSite, input: DeploymentInput) {
    const source = await this.sourceDeployment(input, site);
    const result = source.result as Record<string, any>;
    if (source.action !== "apply") throw new Error("Rollback requires a completed apply run");
    if (source.provider === "cloudflare") {
      const provider = cloudflareProvider();
      return provider ? provider.rollback(site) : publicCredentialBlock(site, "cloudflare");
    }
    if (source.provider === "vercel") {
      const provider = vercelProvider();
      return provider ? provider.rollback(site, result.project) : publicCredentialBlock(site, "vercel");
    }
    return { ...result, blocked: true, supported: false };
  }
}

export const trackingDeploymentService = new TrackingDeploymentService();
