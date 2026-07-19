import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Queue, Worker, type Job } from "bullmq";
import { and, eq, inArray, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import puppeteer from "puppeteer";
import { Resend } from "resend";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { db } from "../../db/postgres/postgres.js";
import {
  agencyClients,
  agencyClientSites,
  goals,
  reportRecipients,
  reportRuns,
  reportSchedules,
  sites,
  uptimeMonitorStatus,
  uptimeMonitors,
} from "../../db/postgres/schema.js";
import { buildGoalCondition } from "../../api/analytics/goals/goalConditions.js";
import { processResults } from "../../api/analytics/utils/utils.js";
import { createServiceLogger } from "../../lib/logger/logger.js";

const QUEUE_NAME = "agency-reports";
const DISPATCH_SCHEDULER_ID = "agency-reports-dispatch-minute";
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

type ReportJob = { type: "dispatch" } | { type: "generate"; runId: string };

export type AgencyReportSummary = {
  clientId: string;
  clientName: string;
  sites: Array<{ siteId: number; name: string; domain: string }>;
  windowStart: string;
  windowEnd: string;
  visitors: number;
  sessions: number;
  conversions: number;
  conversionRate: number;
  sitesDown: number;
  topPages: Array<{ pathname: string; sessions: number }>;
  acquisition: Array<{ channel: string; sessions: number }>;
  webVitals: { lcp: number | null; cls: number | null; inp: number | null };
};

const redisConnection = () => ({
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT || 6379),
  ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
});

function createS3Client() {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  return new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  });
}

function requireStorageConfig() {
  const bucket = process.env.REPORTS_BUCKET;
  if (!bucket) throw new Error("REPORTS_BUCKET is required for agency reports");
  return {
    bucket,
    prefix: (process.env.REPORTS_PREFIX || "agency-analytics/reports").replace(/^\/+|\/+$/g, ""),
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function reportHtml(summary: AgencyReportSummary) {
  const period = `${new Date(summary.windowStart).toLocaleDateString("en-US")} – ${new Date(summary.windowEnd).toLocaleDateString("en-US")}`;
  const metric = (label: string, value: string) =>
    `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  const rows = (items: Array<Record<string, unknown>>, columns: string[]) =>
    items.length
      ? items.map(item => `<tr>${columns.map(column => `<td>${escapeHtml(item[column])}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${columns.length}">No data for this period</td></tr>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(summary.clientName)} analytics report</title><style>
    @page{size:A4;margin:18mm}*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;color:#171717;font-size:12px;margin:0}header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f766e;padding-bottom:18px;margin-bottom:22px}h1{font-size:24px;margin:0 0 6px}h2{font-size:15px;margin:24px 0 10px}.muted{color:#666}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.metric{border:1px solid #ddd;border-radius:10px;padding:12px}.metric span{display:block;color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.04em}.metric strong{display:block;font-size:20px;margin-top:5px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5e5e5;text-align:left}th{font-size:10px;text-transform:uppercase;color:#666}.footer{margin-top:28px;padding-top:12px;border-top:1px solid #ddd;color:#777;font-size:10px}
  </style></head><body><header><div><h1>${escapeHtml(summary.clientName)}</h1><div class="muted">Website analytics report · ${escapeHtml(period)}</div></div><strong>Bold Analytics</strong></header>
  <section class="metrics">${metric("Visitors", formatNumber(summary.visitors))}${metric("Sessions", formatNumber(summary.sessions))}${metric("Conversions", formatNumber(summary.conversions))}${metric("Conversion rate", `${formatNumber(summary.conversionRate)}%`)}</section>
  <h2>Acquisition</h2><table><thead><tr><th>Channel</th><th>Sessions</th></tr></thead><tbody>${rows(summary.acquisition as Array<Record<string, unknown>>, ["channel", "sessions"])}</tbody></table>
  <h2>Top content</h2><table><thead><tr><th>Page</th><th>Sessions</th></tr></thead><tbody>${rows(summary.topPages as Array<Record<string, unknown>>, ["pathname", "sessions"])}</tbody></table>
  <h2>Performance and uptime</h2><section class="metrics">${metric("LCP", summary.webVitals.lcp == null ? "No data" : `${formatNumber(summary.webVitals.lcp)} ms`)}${metric("CLS", summary.webVitals.cls == null ? "No data" : formatNumber(summary.webVitals.cls))}${metric("INP", summary.webVitals.inp == null ? "No data" : `${formatNumber(summary.webVitals.inp)} ms`)}${metric("Sites down", String(summary.sitesDown))}</section>
  <div class="footer">Aggregate report generated by Bold Analytics. Detailed event and visitor data remains available only to authorized portal users.</div></body></html>`;
}

async function buildSummary(clientId: string, start: Date, end: Date): Promise<AgencyReportSummary> {
  const clientRows = await db
    .select({
      clientId: agencyClients.id,
      clientName: agencyClients.name,
      organizationId: agencyClients.organizationId,
      siteId: agencyClientSites.siteId,
      siteName: sites.name,
      domain: sites.domain,
    })
    .from(agencyClients)
    .leftJoin(agencyClientSites, eq(agencyClientSites.clientId, agencyClients.id))
    .leftJoin(sites, eq(sites.siteId, agencyClientSites.siteId))
    .where(eq(agencyClients.id, clientId));
  if (!clientRows.length) throw new Error("Agency client no longer exists");

  const siteRows = clientRows
    .filter(row => row.siteId != null && row.siteName && row.domain)
    .map(row => ({ siteId: Number(row.siteId), name: row.siteName!, domain: row.domain! }));
  const siteIds = siteRows.map(site => site.siteId);
  let visitors = 0;
  let sessions = 0;
  let conversions = 0;
  let topPages: AgencyReportSummary["topPages"] = [];
  let acquisition: AgencyReportSummary["acquisition"] = [];
  let webVitals: AgencyReportSummary["webVitals"] = { lcp: null, cls: null, inp: null };

  if (siteIds.length) {
    const clientGoals = await db
      .select({ siteId: goals.siteId, goalType: goals.goalType, config: goals.config })
      .from(goals)
      .where(inArray(goals.siteId, siteIds));
    const goalConditions = clientGoals
      .map(goal => {
        const condition = buildGoalCondition({ goalType: goal.goalType, config: goal.config });
        return condition ? `(site_id = ${Number(goal.siteId)} AND (${condition}))` : null;
      })
      .filter((condition): condition is string => Boolean(condition));
    const conversionSelect = goalConditions.length ? `uniqExactIf(session_id, ${goalConditions.join(" OR ")})` : "0";
    const params = { siteIds, start: start.toISOString(), end: end.toISOString() };
    const [overviewResult, pagesResult, acquisitionResult] = await Promise.all([
      clickhouse.query({
        query: `SELECT uniqExact(user_id) visitors, uniqExact(session_id) sessions, ${conversionSelect} conversions, avgOrNull(lcp) lcp, avgOrNull(cls) cls, avgOrNull(inp) inp FROM events WHERE site_id IN {siteIds:Array(Int32)} AND timestamp >= {start:DateTime64(3)} AND timestamp < {end:DateTime64(3)}`,
        query_params: params,
        format: "JSONEachRow",
      }),
      clickhouse.query({
        query: `SELECT pathname, uniqExact(session_id) sessions FROM events WHERE site_id IN {siteIds:Array(Int32)} AND timestamp >= {start:DateTime64(3)} AND timestamp < {end:DateTime64(3)} AND type = 'pageview' GROUP BY pathname ORDER BY sessions DESC LIMIT 10`,
        query_params: params,
        format: "JSONEachRow",
      }),
      clickhouse.query({
        query: `SELECT if(channel = '', 'Direct', channel) channel, uniqExact(session_id) sessions FROM events WHERE site_id IN {siteIds:Array(Int32)} AND timestamp >= {start:DateTime64(3)} AND timestamp < {end:DateTime64(3)} GROUP BY channel ORDER BY sessions DESC LIMIT 10`,
        query_params: params,
        format: "JSONEachRow",
      }),
    ]);
    const [overview] = await processResults<{
      visitors: number;
      sessions: number;
      conversions: number;
      lcp: number | null;
      cls: number | null;
      inp: number | null;
    }>(overviewResult);
    visitors = Number(overview?.visitors ?? 0);
    sessions = Number(overview?.sessions ?? 0);
    conversions = Number(overview?.conversions ?? 0);
    webVitals = {
      lcp: overview?.lcp == null ? null : Number(overview.lcp),
      cls: overview?.cls == null ? null : Number(overview.cls),
      inp: overview?.inp == null ? null : Number(overview.inp),
    };
    topPages = (await processResults<{ pathname: string; sessions: number }>(pagesResult)).map(row => ({
      pathname: row.pathname,
      sessions: Number(row.sessions),
    }));
    acquisition = (await processResults<{ channel: string; sessions: number }>(acquisitionResult)).map(row => ({
      channel: row.channel,
      sessions: Number(row.sessions),
    }));
  }

  const statusRows = await db
    .select({ currentStatus: uptimeMonitorStatus.currentStatus, httpConfig: uptimeMonitors.httpConfig })
    .from(uptimeMonitors)
    .leftJoin(uptimeMonitorStatus, eq(uptimeMonitorStatus.monitorId, uptimeMonitors.id))
    .where(eq(uptimeMonitors.organizationId, clientRows[0].organizationId));
  const domains = new Set(siteRows.map(site => site.domain.replace(/^www\./, "")));
  const sitesDown = statusRows.filter(row => {
    if (row.currentStatus !== "down" || !row.httpConfig?.url) return false;
    try {
      return domains.has(new URL(row.httpConfig.url).hostname.replace(/^www\./, ""));
    } catch {
      return false;
    }
  }).length;

  return {
    clientId,
    clientName: clientRows[0].clientName,
    sites: siteRows,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    visitors,
    sessions,
    conversions,
    conversionRate: sessions ? (conversions / sessions) * 100 : 0,
    sitesDown,
    topPages,
    acquisition,
    webVitals,
  };
}

function nextRun(schedule: typeof reportSchedules.$inferSelect, fromIso: string) {
  const from = DateTime.fromISO(fromIso, { zone: "utc" }).setZone(schedule.timezone);
  return (schedule.cadence === "weekly" ? from.plus({ weeks: 1 }) : from.plus({ months: 1 })).toUTC().toISO();
}

function reportWindow(schedule: typeof reportSchedules.$inferSelect) {
  const end = DateTime.fromISO(schedule.nextRunAt!, { zone: "utc" });
  const start = schedule.cadence === "weekly" ? end.minus({ weeks: 1 }) : end.minus({ months: 1 });
  return { start: start.toJSDate(), end: end.toJSDate() };
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown report failure";
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

export class AgencyReportService {
  private queue = new Queue<ReportJob>(QUEUE_NAME, { connection: redisConnection() });
  private worker?: Worker<ReportJob>;
  private initialized = false;
  private logger = createServiceLogger("agency-reports");
  private s3 = createS3Client();

  async initialize() {
    if (this.initialized) return;
    await this.queue.waitUntilReady();
    await this.queue.upsertJobScheduler(
      DISPATCH_SCHEDULER_ID,
      { every: 60_000 },
      { name: "dispatch", data: { type: "dispatch" }, opts: { removeOnComplete: 20, removeOnFail: 50 } }
    );
    this.worker = new Worker<ReportJob>(QUEUE_NAME, job => this.process(job), {
      connection: redisConnection(),
      concurrency: 2,
    });
    this.worker.on("failed", (job, error) => this.logger.error({ runId: job?.id, err: error }, "Report job failed"));
    await this.worker.waitUntilReady();
    const queuedRuns = await db.select({ id: reportRuns.id }).from(reportRuns).where(eq(reportRuns.status, "queued"));
    for (const run of queuedRuns) await this.queueReportRun(run.id);
    this.initialized = true;
    this.logger.info("Agency report dispatcher and worker initialized");
  }

  async shutdown() {
    await this.worker?.close();
    await this.queue.close();
    this.initialized = false;
  }

  async queueReportRun(runId: string) {
    const jobId = `report-run-${runId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "failed" || state === "completed") await existing.remove();
      else return;
    }
    await this.queue.add(
      "generate",
      { type: "generate", runId },
      {
        jobId,
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { age: 86_400, count: 200 },
        removeOnFail: { age: 604_800, count: 200 },
      }
    );
  }

  async getDownloadUrl(artifactKey: string) {
    const { bucket } = requireStorageConfig();
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: bucket, Key: artifactKey }), {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
  }

  private async process(job: Job<ReportJob>) {
    if (job.data.type === "dispatch") return this.dispatchDueSchedules();
    return this.generateReport(job.data.runId);
  }

  private async dispatchDueSchedules() {
    const now = new Date().toISOString();
    const due = await db
      .select()
      .from(reportSchedules)
      .where(and(eq(reportSchedules.enabled, true), lte(reportSchedules.nextRunAt, now)));

    for (const schedule of due) {
      if (!schedule.nextRunAt) continue;
      const scheduledRunAt = schedule.nextRunAt;
      const window = reportWindow(schedule);
      const runId = crypto.randomUUID();
      const inserted = await db.transaction(async tx => {
        const rows = await tx
          .insert(reportRuns)
          .values({
            id: runId,
            scheduleId: schedule.id,
            windowStart: window.start.toISOString(),
            windowEnd: window.end.toISOString(),
            status: "queued",
          })
          .onConflictDoNothing()
          .returning({ id: reportRuns.id });
        await tx
          .update(reportSchedules)
          .set({ nextRunAt: nextRun(schedule, scheduledRunAt), updatedAt: now })
          .where(and(eq(reportSchedules.id, schedule.id), eq(reportSchedules.nextRunAt, scheduledRunAt)));
        return rows[0]?.id;
      });
      if (inserted) await this.queueReportRun(inserted);
    }
  }

  private async generateReport(runId: string) {
    const [row] = await db
      .select({
        run: reportRuns,
        schedule: reportSchedules,
        client: agencyClients,
      })
      .from(reportRuns)
      .innerJoin(reportSchedules, eq(reportSchedules.id, reportRuns.scheduleId))
      .innerJoin(agencyClients, eq(agencyClients.id, reportSchedules.clientId))
      .where(eq(reportRuns.id, runId))
      .limit(1);
    if (!row) throw new Error("Report run not found");
    if (row.run.status === "succeeded") return;

    await db
      .update(reportRuns)
      .set({
        status: "running",
        startedAt: new Date().toISOString(),
        attempts: row.run.attempts + 1,
        errorSummary: null,
      })
      .where(eq(reportRuns.id, runId));

    try {
      const summary = await buildSummary(row.client.id, new Date(row.run.windowStart), new Date(row.run.windowEnd));
      const browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });
      let pdf: Uint8Array;
      try {
        const page = await browser.newPage();
        await page.setContent(reportHtml(summary), { waitUntil: "networkidle0" });
        pdf = await page.pdf({ format: "A4", printBackground: true });
      } finally {
        await browser.close();
      }

      const { bucket, prefix } = requireStorageConfig();
      const artifactKey = `${prefix}/${row.client.organizationId}/${row.client.id}/${runId}.pdf`;
      await this.s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: artifactKey,
          Body: Buffer.from(pdf),
          ContentType: "application/pdf",
          ContentDisposition: `attachment; filename="${row.client.slug}-analytics-${runId.slice(0, 8)}.pdf"`,
          ServerSideEncryption: "AES256",
          Metadata: { retention: "90-days", client: row.client.id, run: runId },
        })
      );

      const downloadUrl = await this.getDownloadUrl(artifactKey);
      const recipients = await db
        .select()
        .from(reportRecipients)
        .where(and(eq(reportRecipients.scheduleId, row.schedule.id), eq(reportRecipients.enabled, true)));
      if (recipients.length) await this.sendEmails(recipients, summary, downloadUrl);

      await db
        .update(reportRuns)
        .set({
          status: "succeeded",
          summary,
          artifactKey,
          completedAt: new Date().toISOString(),
          errorSummary: null,
        })
        .where(eq(reportRuns.id, runId));
    } catch (error) {
      await db
        .update(reportRuns)
        .set({ status: "failed", completedAt: new Date().toISOString(), errorSummary: safeError(error) })
        .where(eq(reportRuns.id, runId));
      throw error;
    }
  }

  private async sendEmails(
    recipients: Array<typeof reportRecipients.$inferSelect>,
    summary: AgencyReportSummary,
    downloadUrl: string
  ) {
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is required for scheduled report delivery");
    const from = process.env.EMAIL_FROM;
    if (!from) throw new Error("EMAIL_FROM is required for scheduled report delivery");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const portalUrl = `${(process.env.BASE_URL || "").replace(/\/$/, "")}/reports`;
    const subject = `${summary.clientName} analytics report`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#171717"><h1>${escapeHtml(summary.clientName)} analytics</h1><p>${escapeHtml(new Date(summary.windowStart).toLocaleDateString())} – ${escapeHtml(new Date(summary.windowEnd).toLocaleDateString())}</p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:12px;border:1px solid #ddd">Visitors<br><strong>${formatNumber(summary.visitors)}</strong></td><td style="padding:12px;border:1px solid #ddd">Sessions<br><strong>${formatNumber(summary.sessions)}</strong></td><td style="padding:12px;border:1px solid #ddd">Conversions<br><strong>${formatNumber(summary.conversions)}</strong></td><td style="padding:12px;border:1px solid #ddd">Conversion rate<br><strong>${formatNumber(summary.conversionRate)}%</strong></td></tr></table><p style="margin-top:24px"><a href="${escapeHtml(downloadUrl)}">Download the private PDF report</a> · <a href="${escapeHtml(portalUrl)}">Open the analytics portal</a></p><p style="color:#666;font-size:12px">The PDF link expires in seven days. Detailed analytics requires an authorized account.</p></div>`;
    for (const recipient of recipients) {
      const result = await resend.emails.send({ from, to: recipient.email, subject, html });
      if (result.error) throw new Error(`Resend delivery failed: ${result.error.message}`);
    }
  }
}

export const agencyReportService = new AgencyReportService();
