import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { DateTime } from "luxon";
import { db } from "../../db/postgres/postgres.js";
import {
  agencyAuditEvents,
  agencyClientSites,
  reportRecipients,
  reportRuns,
  reportSchedules,
} from "../../db/postgres/schema.js";
import { canAccessClient, getAgencyPrincipal } from "./access.js";
import { reportScheduleSchema, updateReportScheduleSchema } from "./schemas.js";
import { agencyReportService } from "../../services/agencyReports/reportService.js";

type ClientParams = { organizationId: string; clientId: string };

function getNextRun(input: {
  cadence: "weekly" | "monthly";
  timezone: string;
  weekday?: number | null;
  dayOfMonth?: number | null;
  sendHour: number;
}) {
  const now = DateTime.now().setZone(input.timezone);
  let candidate: DateTime;
  if (input.cadence === "weekly") {
    const targetWeekday = input.weekday === 0 ? 7 : input.weekday!;
    candidate = now
      .startOf("day")
      .set({ hour: input.sendHour })
      .plus({ days: (targetWeekday - now.weekday + 7) % 7 });
    if (candidate <= now) candidate = candidate.plus({ weeks: 1 });
  } else {
    candidate = now.startOf("month").set({ day: input.dayOfMonth!, hour: input.sendHour });
    if (candidate <= now) candidate = candidate.plus({ months: 1 });
  }
  return candidate.toUTC().toISO();
}

async function validateSiteScope(clientId: string, siteScope: number[]) {
  if (siteScope.length === 0) return true;
  const rows = await db
    .select({ siteId: agencyClientSites.siteId })
    .from(agencyClientSites)
    .where(and(eq(agencyClientSites.clientId, clientId), inArray(agencyClientSites.siteId, siteScope)));
  return new Set(rows.map(row => row.siteId)).size === new Set(siteScope).size;
}

async function serializeSchedules(clientId: string) {
  const schedules = await db.select().from(reportSchedules).where(eq(reportSchedules.clientId, clientId));
  if (schedules.length === 0) return [];
  const recipients = await db
    .select()
    .from(reportRecipients)
    .where(
      inArray(
        reportRecipients.scheduleId,
        schedules.map(schedule => schedule.id)
      )
    );
  return schedules.map(schedule => ({
    ...schedule,
    recipients: recipients.filter(recipient => recipient.scheduleId === schedule.id),
  }));
}

export async function listReportSchedules(request: FastifyRequest<{ Params: ClientParams }>, reply: FastifyReply) {
  const { organizationId, clientId } = request.params;
  const access = await canAccessClient(request, organizationId, clientId);
  if (!access.allowed) return reply.status(404).send({ error: "Client not found" });
  return reply.send({ schedules: await serializeSchedules(clientId) });
}

export async function createReportSchedule(
  request: FastifyRequest<{ Params: ClientParams; Body: unknown }>,
  reply: FastifyReply
) {
  const parsed = reportScheduleSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid request", details: parsed.error.flatten() });
  const { organizationId, clientId } = request.params;
  const principal = await getAgencyPrincipal(request, organizationId);
  if (!principal?.canManage) return reply.status(403).send({ error: "Forbidden" });
  const access = await canAccessClient(request, organizationId, clientId);
  if (!access.allowed) return reply.status(404).send({ error: "Client not found" });
  if (!(await validateSiteScope(clientId, parsed.data.siteScope))) {
    return reply.status(400).send({ error: "Report scope contains a site outside this client" });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const nextRunAt = parsed.data.enabled ? getNextRun(parsed.data) : null;
  await db.transaction(async tx => {
    await tx.insert(reportSchedules).values({
      id,
      clientId,
      name: parsed.data.name,
      cadence: parsed.data.cadence,
      timezone: parsed.data.timezone,
      weekday: parsed.data.cadence === "weekly" ? parsed.data.weekday : null,
      dayOfMonth: parsed.data.cadence === "monthly" ? parsed.data.dayOfMonth : null,
      sendHour: parsed.data.sendHour,
      siteScope: parsed.data.siteScope,
      enabled: parsed.data.enabled,
      nextRunAt,
      createdAt: now,
      updatedAt: now,
    });
    if (parsed.data.recipients.length) {
      await tx.insert(reportRecipients).values(
        parsed.data.recipients.map(recipient => ({
          id: crypto.randomUUID(),
          scheduleId: id,
          ...recipient,
          createdAt: now,
          updatedAt: now,
        }))
      );
    }
    await tx.insert(agencyAuditEvents).values({
      organizationId,
      clientId,
      actorUserId: principal.userId,
      action: "report_schedule.created",
      targetType: "report_schedule",
      targetId: id,
      metadata: { cadence: parsed.data.cadence, recipientCount: parsed.data.recipients.length },
    });
  });
  const schedules = await serializeSchedules(clientId);
  return reply.status(201).send({ schedule: schedules.find(schedule => schedule.id === id) });
}

export async function updateReportSchedule(
  request: FastifyRequest<{ Params: ClientParams & { scheduleId: string }; Body: unknown }>,
  reply: FastifyReply
) {
  const parsed = updateReportScheduleSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid request", details: parsed.error.flatten() });
  const { organizationId, clientId, scheduleId } = request.params;
  const principal = await getAgencyPrincipal(request, organizationId);
  if (!principal?.canManage) return reply.status(403).send({ error: "Forbidden" });
  const [current] = await db
    .select()
    .from(reportSchedules)
    .where(and(eq(reportSchedules.id, scheduleId), eq(reportSchedules.clientId, clientId)))
    .limit(1);
  if (!current) return reply.status(404).send({ error: "Report schedule not found" });
  if (parsed.data.siteScope && !(await validateSiteScope(clientId, parsed.data.siteScope))) {
    return reply.status(400).send({ error: "Report scope contains a site outside this client" });
  }

  const merged = {
    cadence: (parsed.data.cadence ?? current.cadence) as "weekly" | "monthly",
    timezone: parsed.data.timezone ?? current.timezone,
    weekday: parsed.data.weekday === undefined ? current.weekday : parsed.data.weekday,
    dayOfMonth: parsed.data.dayOfMonth === undefined ? current.dayOfMonth : parsed.data.dayOfMonth,
    sendHour: parsed.data.sendHour ?? current.sendHour,
  };
  const enabled = parsed.data.enabled ?? current.enabled;
  if (merged.cadence === "weekly" && merged.weekday == null) {
    return reply.status(400).send({ error: "Weekday is required for weekly reports" });
  }
  if (merged.cadence === "monthly" && merged.dayOfMonth == null) {
    return reply.status(400).send({ error: "Day of month is required for monthly reports" });
  }
  const now = new Date().toISOString();
  await db.transaction(async tx => {
    await tx
      .update(reportSchedules)
      .set({
        name: parsed.data.name ?? current.name,
        cadence: merged.cadence,
        timezone: merged.timezone,
        weekday: merged.cadence === "weekly" ? merged.weekday : null,
        dayOfMonth: merged.cadence === "monthly" ? merged.dayOfMonth : null,
        sendHour: merged.sendHour,
        siteScope: parsed.data.siteScope ?? current.siteScope,
        enabled,
        nextRunAt: enabled ? getNextRun(merged) : null,
        updatedAt: now,
      })
      .where(eq(reportSchedules.id, scheduleId));
    if (parsed.data.recipients) {
      await tx.delete(reportRecipients).where(eq(reportRecipients.scheduleId, scheduleId));
      if (parsed.data.recipients.length) {
        await tx.insert(reportRecipients).values(
          parsed.data.recipients.map(recipient => ({
            id: crypto.randomUUID(),
            scheduleId,
            ...recipient,
            createdAt: now,
            updatedAt: now,
          }))
        );
      }
    }
    await tx.insert(agencyAuditEvents).values({
      organizationId,
      clientId,
      actorUserId: principal.userId,
      action: "report_schedule.updated",
      targetType: "report_schedule",
      targetId: scheduleId,
      metadata: { fields: Object.keys(parsed.data) },
    });
  });
  const schedules = await serializeSchedules(clientId);
  return reply.send({ schedule: schedules.find(schedule => schedule.id === scheduleId) });
}

export async function deleteReportSchedule(
  request: FastifyRequest<{ Params: ClientParams & { scheduleId: string } }>,
  reply: FastifyReply
) {
  const { organizationId, clientId, scheduleId } = request.params;
  const principal = await getAgencyPrincipal(request, organizationId);
  if (!principal?.canManage) return reply.status(403).send({ error: "Forbidden" });
  const deleted = await db
    .delete(reportSchedules)
    .where(and(eq(reportSchedules.id, scheduleId), eq(reportSchedules.clientId, clientId)))
    .returning({ id: reportSchedules.id });
  if (!deleted.length) return reply.status(404).send({ error: "Report schedule not found" });
  await db.insert(agencyAuditEvents).values({
    organizationId,
    clientId,
    actorUserId: principal.userId,
    action: "report_schedule.deleted",
    targetType: "report_schedule",
    targetId: scheduleId,
  });
  return reply.status(204).send();
}

export async function listReportRuns(request: FastifyRequest<{ Params: ClientParams }>, reply: FastifyReply) {
  const { organizationId, clientId } = request.params;
  const access = await canAccessClient(request, organizationId, clientId);
  if (!access.allowed) return reply.status(404).send({ error: "Client not found" });
  const runs = await db
    .select({
      id: reportRuns.id,
      scheduleId: reportRuns.scheduleId,
      windowStart: reportRuns.windowStart,
      windowEnd: reportRuns.windowEnd,
      status: reportRuns.status,
      summary: reportRuns.summary,
      artifactKey: reportRuns.artifactKey,
      attempts: reportRuns.attempts,
      errorSummary: reportRuns.errorSummary,
      createdAt: reportRuns.createdAt,
      startedAt: reportRuns.startedAt,
      completedAt: reportRuns.completedAt,
    })
    .from(reportRuns)
    .innerJoin(reportSchedules, eq(reportSchedules.id, reportRuns.scheduleId))
    .where(eq(reportSchedules.clientId, clientId))
    .orderBy(desc(reportRuns.createdAt));
  return reply.send({
    runs: runs.map(({ artifactKey, ...run }) => ({ ...run, artifactAvailable: Boolean(artifactKey) })),
  });
}

export async function getReportRunDownload(
  request: FastifyRequest<{ Params: ClientParams & { runId: string } }>,
  reply: FastifyReply
) {
  const { organizationId, clientId, runId } = request.params;
  const access = await canAccessClient(request, organizationId, clientId);
  if (!access.allowed) return reply.status(404).send({ error: "Report not found" });
  const [run] = await db
    .select({ artifactKey: reportRuns.artifactKey, status: reportRuns.status })
    .from(reportRuns)
    .innerJoin(reportSchedules, eq(reportSchedules.id, reportRuns.scheduleId))
    .where(and(eq(reportRuns.id, runId), eq(reportSchedules.clientId, clientId)))
    .limit(1);
  if (!run || run.status !== "succeeded" || !run.artifactKey) {
    return reply.status(404).send({ error: "Report artifact not found" });
  }
  const url = await agencyReportService.getDownloadUrl(run.artifactKey);
  return reply.send({ url, expiresIn: 7 * 24 * 60 * 60 });
}

export async function retryReportRun(
  request: FastifyRequest<{ Params: ClientParams & { runId: string } }>,
  reply: FastifyReply
) {
  const { organizationId, clientId, runId } = request.params;
  const principal = await getAgencyPrincipal(request, organizationId);
  if (!principal?.canManage) return reply.status(403).send({ error: "Forbidden" });
  const [run] = await db
    .select({ id: reportRuns.id, status: reportRuns.status })
    .from(reportRuns)
    .innerJoin(reportSchedules, eq(reportSchedules.id, reportRuns.scheduleId))
    .where(and(eq(reportRuns.id, runId), eq(reportSchedules.clientId, clientId)))
    .limit(1);
  if (!run) return reply.status(404).send({ error: "Report run not found" });
  if (run.status !== "failed") return reply.status(400).send({ error: "Only failed report runs can be retried" });
  await db.transaction(async tx => {
    await tx
      .update(reportRuns)
      .set({ status: "queued", errorSummary: null, startedAt: null, completedAt: null })
      .where(eq(reportRuns.id, runId));
    await tx.insert(agencyAuditEvents).values({
      organizationId,
      clientId,
      actorUserId: principal.userId,
      action: "report_run.retried",
      targetType: "report_run",
      targetId: runId,
    });
  });
  try {
    await agencyReportService.queueReportRun(runId);
  } catch (error) {
    request.log.error({ error, runId }, "Failed to enqueue agency report retry");
    await db
      .update(reportRuns)
      .set({ status: "failed", errorSummary: "The report queue is temporarily unavailable" })
      .where(eq(reportRuns.id, runId));
    return reply.status(500).send({ error: "Failed to enqueue report retry" });
  }
  return reply.status(202).send({ runId, status: "queued" });
}
