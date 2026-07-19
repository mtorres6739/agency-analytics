import type { ReportRun, ReportSchedule } from "@rybbit/shared";
import { authedFetch } from "../../utils";

export type CreateReportScheduleInput = {
  name: string;
  cadence: "weekly" | "monthly";
  timezone: string;
  weekday?: number;
  dayOfMonth?: number;
  sendHour: number;
  siteScope: number[];
  enabled: boolean;
  recipients: Array<{ name: string; email: string; locale: string; enabled: boolean }>;
};

const root = (organizationId: string, clientId: string) => `/organizations/${organizationId}/clients/${clientId}`;

export function fetchReportSchedules(organizationId: string, clientId: string) {
  return authedFetch<{ schedules: ReportSchedule[] }>(`${root(organizationId, clientId)}/report-schedules`);
}

export function createReportSchedule(organizationId: string, clientId: string, data: CreateReportScheduleInput) {
  return authedFetch<{ schedule: ReportSchedule }>(`${root(organizationId, clientId)}/report-schedules`, undefined, {
    method: "POST",
    data,
  });
}

export function fetchReportRuns(organizationId: string, clientId: string) {
  return authedFetch<{ runs: ReportRun[] }>(`${root(organizationId, clientId)}/report-runs`);
}

export function retryReportRun(organizationId: string, clientId: string, runId: string) {
  return authedFetch<{ runId: string; status: "queued" }>(
    `${root(organizationId, clientId)}/report-runs/${runId}/retry`,
    undefined,
    { method: "POST" }
  );
}

export function fetchReportDownload(organizationId: string, clientId: string, runId: string) {
  return authedFetch<{ url: string; expiresIn: number }>(
    `${root(organizationId, clientId)}/report-runs/${runId}/download`
  );
}
