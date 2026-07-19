"use client";

import { CalendarClock, Download, Loader2, Mail, RotateCcw } from "lucide-react";
import { useExtracted } from "next-intl";
import { FormEvent, useEffect, useState } from "react";
import { useAgencyClients } from "../../../api/agency/hooks/useAgencyClients";
import { useUserOrganizations } from "../../../api/admin/hooks/useOrganizations";
import {
  useCreateReportSchedule,
  useReportRuns,
  useReportSchedules,
  useRetryReportRun,
} from "../../../api/agency/hooks/useAgencyReports";
import { AgencyHeader, StatusBadge } from "../../../components/agency/AgencyHeader";
import { AgencyEmpty, AgencyError, AgencyLoading } from "../../../components/agency/AgencyStates";
import { authClient } from "../../../lib/auth";
import { fetchReportDownload } from "../../../api/agency/endpoints/reports";

export default function ReportsPage() {
  const t = useExtracted();
  const { data: organization } = authClient.useActiveOrganization();
  const { data: organizations } = useUserOrganizations();
  const membership = organizations?.find(item => item.id === organization?.id);
  const canManage = membership?.role === "owner" || membership?.role === "admin";
  const clientsQuery = useAgencyClients(organization?.id);
  const clients = clientsQuery.data?.clients ?? [];
  const [clientId, setClientId] = useState("");
  const selectedClientId = clientId || clients[0]?.id || "";
  const schedulesQuery = useReportSchedules(organization?.id, selectedClientId);
  const runsQuery = useReportRuns(organization?.id, selectedClientId);
  const createSchedule = useCreateReportSchedule();
  const retryRun = useRetryReportRun();
  const [name, setName] = useState("Monthly analytics summary");
  const [cadence, setCadence] = useState<"weekly" | "monthly">("monthly");
  const [email, setEmail] = useState("");
  const [downloadError, setDownloadError] = useState<string>();

  async function downloadReport(runId: string) {
    if (!organization) return;
    setDownloadError(undefined);
    try {
      const result = await fetchReportDownload(organization.id, selectedClientId, runId);
      window.location.assign(result.url);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : t("Unable to open the report download."));
    }
  }

  useEffect(() => {
    if (clientId && !clients.some(client => client.id === clientId)) setClientId("");
  }, [clientId, clients]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!organization || !selectedClientId) return;
    await createSchedule.mutateAsync({
      organizationId: organization.id,
      clientId: selectedClientId,
      data: {
        name,
        cadence,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        ...(cadence === "weekly" ? { weekday: 1 } : { dayOfMonth: 1 }),
        sendHour: 8,
        siteScope: [],
        enabled: true,
        recipients: email ? [{ name: "Client", email, locale: "en", enabled: true }] : [],
      },
    });
    setEmail("");
  }

  if (clientsQuery.isLoading) return <AgencyLoading />;
  if (clientsQuery.error)
    return <AgencyError message={clientsQuery.error.message} retry={() => clientsQuery.refetch()} />;

  return (
    <>
      <AgencyHeader
        title={t("Reports")}
        description={t("Branded schedules, delivery history, retries, and private downloads.")}
      />
      {clients.length === 0 ? (
        <AgencyEmpty
          title={t("No clients available")}
          description={t("Create a client before configuring scheduled reports.")}
        />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-2 sm:max-w-sm">
            <label htmlFor="report-client" className="text-sm font-medium">
              {t("Client")}
            </label>
            <select
              id="report-client"
              value={selectedClientId}
              onChange={event => setClientId(event.target.value)}
              className="rounded-lg border-neutral-300 bg-white text-sm focus:border-accent-500 focus:ring-accent-500 dark:border-neutral-700 dark:bg-neutral-900"
            >
              {clients.map(client => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
                <h2 className="font-semibold">{t("Schedules")}</h2>
                <p className="mt-1 text-xs text-neutral-500">
                  {t("Weekly and monthly delivery in the client's reporting timezone.")}
                </p>
              </div>
              {schedulesQuery.isLoading ? (
                <div className="p-5">
                  <div className="h-20 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
                </div>
              ) : schedulesQuery.data?.schedules.length ? (
                <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {schedulesQuery.data.schedules.map(schedule => (
                    <div
                      key={schedule.id}
                      className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center"
                    >
                      <div className="flex items-center gap-3">
                        <span className="grid size-10 place-items-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
                          <CalendarClock className="size-5" />
                        </span>
                        <div>
                          <p className="font-medium">{schedule.name}</p>
                          <p className="text-xs capitalize text-neutral-500">
                            {schedule.cadence} · {schedule.sendHour}:00 · {schedule.timezone}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-neutral-500">
                          {schedule.recipients.length} {t("recipients")}
                        </span>
                        <StatusBadge status={schedule.enabled ? "active" : "paused"} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-5">
                  <AgencyEmpty
                    title={t("No report schedules")}
                    description={t("Create the first delivery schedule for this client.")}
                  />
                </div>
              )}
            </section>

            {canManage ? (
              <form
                onSubmit={submit}
                className="h-fit rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="flex items-center gap-2">
                  <Mail className="size-5 text-neutral-500" />
                  <h2 className="font-semibold">{t("New schedule")}</h2>
                </div>
                <div className="mt-5 space-y-4">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium">{t("Schedule name")}</span>
                    <input
                      required
                      value={name}
                      onChange={event => setName(event.target.value)}
                      className="w-full rounded-lg border-neutral-300 bg-white text-sm focus:border-accent-500 focus:ring-accent-500 dark:border-neutral-700 dark:bg-neutral-950"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium">{t("Cadence")}</span>
                    <select
                      value={cadence}
                      onChange={event => setCadence(event.target.value as "weekly" | "monthly")}
                      className="w-full rounded-lg border-neutral-300 bg-white text-sm focus:border-accent-500 focus:ring-accent-500 dark:border-neutral-700 dark:bg-neutral-950"
                    >
                      <option value="monthly">{t("Monthly")}</option>
                      <option value="weekly">{t("Weekly")}</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium">{t("Recipient email")}</span>
                    <input
                      type="email"
                      value={email}
                      onChange={event => setEmail(event.target.value)}
                      placeholder="client@example.com"
                      className="w-full rounded-lg border-neutral-300 bg-white text-sm focus:border-accent-500 focus:ring-accent-500 dark:border-neutral-700 dark:bg-neutral-950"
                    />
                  </label>
                  {createSchedule.error ? (
                    <p role="alert" className="text-sm text-red-600">
                      {createSchedule.error.message}
                    </p>
                  ) : null}
                  <button
                    disabled={createSchedule.isPending}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-neutral-950"
                  >
                    {createSchedule.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                    {t("Create schedule")}
                  </button>
                </div>
              </form>
            ) : (
              <aside className="h-fit rounded-xl border border-neutral-200 bg-white p-5 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
                {t("Report schedules are managed by agency owners and admins.")}
              </aside>
            )}
          </div>

          <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
              <h2 className="font-semibold">{t("Delivery history")}</h2>
              {downloadError ? (
                <p role="alert" className="mt-2 text-sm text-red-600">
                  {downloadError}
                </p>
              ) : null}
            </div>
            {runsQuery.data?.runs.length ? (
              <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {runsQuery.data.runs.map(run => (
                  <div key={run.id} className="flex items-center justify-between gap-4 px-5 py-4">
                    <div>
                      <p className="text-sm font-medium">
                        {new Date(run.windowStart).toLocaleDateString()} –{" "}
                        {new Date(run.windowEnd).toLocaleDateString()}
                      </p>
                      <p className="mt-1 text-xs text-neutral-500">
                        {t("Attempt {count}", { count: String(run.attempts) })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={run.status} />
                      {run.artifactAvailable ? (
                        <button
                          type="button"
                          onClick={() => downloadReport(run.id)}
                          className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-neutral-300 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-neutral-700 dark:hover:bg-neutral-800"
                          aria-label={t("Download private PDF report")}
                        >
                          <Download className="size-4" aria-hidden="true" />
                        </button>
                      ) : null}
                      {run.status === "failed" && canManage ? (
                        <button
                          onClick={() =>
                            organization &&
                            retryRun.mutate({
                              organizationId: organization.id,
                              clientId: selectedClientId,
                              runId: run.id,
                            })
                          }
                          className="rounded-lg border border-neutral-300 p-2 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-neutral-700 dark:hover:bg-neutral-800"
                          aria-label={t("Retry report")}
                        >
                          <RotateCcw className="size-4" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 py-8 text-center text-sm text-neutral-500">{t("No report runs yet.")}</div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
