"use client";

import { ArrowLeft, ArrowUpRight, Check, Circle, Globe2, Loader2, RefreshCw } from "lucide-react";
import { useExtracted } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import {
  useAgencyClient,
  useAgencyClientOnboarding,
  useAgencyClientSummary,
  useAssignAgencyClientSite,
  useVerifyAgencyClientSite,
} from "../../../../api/agency/hooks/useAgencyClients";
import { useGetSitesFromOrg } from "../../../../api/admin/hooks/useSites";
import { useUserOrganizations } from "../../../../api/admin/hooks/useOrganizations";
import { AgencyHeader, StatusBadge } from "../../../../components/agency/AgencyHeader";
import { AgencyEmpty, AgencyError, AgencyLoading } from "../../../../components/agency/AgencyStates";
import { authClient } from "../../../../lib/auth";

export default function ClientOverviewPage() {
  const t = useExtracted();
  const params = useParams<{ clientId: string }>();
  const { data: organization } = authClient.useActiveOrganization();
  const { data: organizations } = useUserOrganizations();
  const membership = organizations?.find(item => item.id === organization?.id);
  const canManage = membership?.role === "owner" || membership?.role === "admin";
  const clientQuery = useAgencyClient(organization?.id, params.clientId);
  const onboardingQuery = useAgencyClientOnboarding(organization?.id, params.clientId);
  const summaryQuery = useAgencyClientSummary(organization?.id, params.clientId);
  const { data: orgSites } = useGetSitesFromOrg(organization?.id);
  const assign = useAssignAgencyClientSite();
  const verify = useVerifyAgencyClientSite();
  const [siteId, setSiteId] = useState("");
  const client = clientQuery.data?.client;
  const availableSites = useMemo(
    () => (orgSites?.sites ?? []).filter(site => !client?.sites.some(assigned => assigned.siteId === site.siteId)),
    [orgSites?.sites, client?.sites]
  );

  async function assignSite(event: FormEvent) {
    event.preventDefault();
    if (!organization || !siteId) return;
    await assign.mutateAsync({
      organizationId: organization.id,
      clientId: params.clientId,
      data: { siteId: Number(siteId), isPrimary: !client?.sites.length, trackingMethod: "script" },
    });
    setSiteId("");
  }

  if (clientQuery.isLoading) return <AgencyLoading />;
  if (clientQuery.error) return <AgencyError message={clientQuery.error.message} retry={() => clientQuery.refetch()} />;
  if (!client)
    return (
      <AgencyEmpty
        title={t("Client not found")}
        description={t("You may not have access to this client, or it no longer exists.")}
      />
    );
  const onboarding = onboardingQuery.data?.onboarding;
  const summary = summaryQuery.data?.summary;

  return (
    <>
      <Link
        href="/clients"
        className="mb-4 inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-950 dark:hover:text-white"
      >
        <ArrowLeft className="size-4" />
        {t("Back to clients")}
      </Link>
      <AgencyHeader
        eyebrow={t("Client overview")}
        title={client.name}
        description={`${client.timezone} · ${client.sites.length} ${t("websites")}`}
        actions={<StatusBadge status={client.status} />}
      />
      {summary?.partialData?.length ? (
        <div
          role="status"
          className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {t("Some analytics data is temporarily unavailable. Setup and access data is current.")}
        </div>
      ) : null}
      <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("Client key metrics")}>
        {[
          { label: t("Visitors"), value: summary?.visitors },
          { label: t("Sessions"), value: summary?.sessions },
          { label: t("Conversions"), value: summary?.conversions },
          {
            label: t("Conversion rate"),
            value: summary ? `${summary.conversionRate.toFixed(1)}%` : undefined,
          },
        ].map(metric => (
          <article
            key={metric.label}
            className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <p className="text-sm text-neutral-500">{metric.label}</p>
            {summaryQuery.isLoading ? (
              <div className="mt-4 h-9 w-24 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
            ) : (
              <p className="mt-3 text-3xl font-semibold tabular-nums">
                {typeof metric.value === "number" ? metric.value.toLocaleString() : (metric.value ?? "—")}
              </p>
            )}
            <p className="mt-1 text-xs text-neutral-500">{t("Last 30 days")}</p>
          </article>
        ))}
      </section>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.8fr)]">
        <div className="space-y-6">
          <section className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
              <h2 className="font-semibold">{t("Websites")}</h2>
              <p className="mt-1 text-xs text-neutral-500">
                {t("Open the canonical site dashboard for detailed analytics.")}
              </p>
            </div>
            {client.sites.length === 0 ? (
              <div className="p-5">
                <AgencyEmpty
                  title={t("No website assigned")}
                  description={t("Assign an existing Rybbit website to continue onboarding.")}
                />
              </div>
            ) : (
              <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {client.sites.map(site => (
                  <div
                    key={site.siteId}
                    className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center"
                  >
                    <div className="flex items-center gap-3">
                      <span className="grid size-10 place-items-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
                        <Globe2 className="size-5" />
                      </span>
                      <div>
                        <p className="font-medium">{site.name}</p>
                        <p className="text-xs text-neutral-500">{site.domain}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={site.trackingStatus} />
                      {site.trackingStatus !== "verified" && organization && canManage ? (
                        <button
                          type="button"
                          disabled={verify.isPending}
                          onClick={() =>
                            verify.mutate({ organizationId: organization.id, clientId: client.id, siteId: site.siteId })
                          }
                          className="inline-flex items-center gap-1 text-sm font-medium text-neutral-600 hover:text-neutral-950 disabled:opacity-50 dark:text-neutral-300 dark:hover:text-white"
                        >
                          <RefreshCw className={`size-4 ${verify.isPending ? "animate-spin" : ""}`} />
                          {t("Verify")}
                        </button>
                      ) : null}
                      <Link
                        href={`/${site.siteId}/main`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-accent-700 hover:underline dark:text-accent-300"
                      >
                        {t("Open analytics")}
                        <ArrowUpRight className="size-4" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          {availableSites.length > 0 && canManage ? (
            <form
              onSubmit={assignSite}
              className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <h2 className="font-semibold">{t("Assign a website")}</h2>
              <p className="mt-1 text-sm text-neutral-500">
                {t("The site will also be added to this client's access team.")}
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <select
                  required
                  value={siteId}
                  onChange={event => setSiteId(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border-neutral-300 bg-white text-sm focus:border-accent-500 focus:ring-accent-500 dark:border-neutral-700 dark:bg-neutral-950"
                >
                  <option value="">{t("Choose a website")}</option>
                  {availableSites.map(site => (
                    <option key={site.siteId} value={site.siteId}>
                      {site.name} · {site.domain}
                    </option>
                  ))}
                </select>
                <button
                  disabled={assign.isPending}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-neutral-950"
                >
                  {assign.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t("Assign site")}
                </button>
              </div>
              {assign.error ? <p className="mt-3 text-sm text-red-600">{assign.error.message}</p> : null}
            </form>
          ) : null}
        </div>
        <aside className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{t("Onboarding")}</h2>
            {onboarding ? (
              <span className="text-sm font-semibold tabular-nums">{onboarding.percentComplete}%</span>
            ) : null}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            <div
              className="h-full rounded-full bg-accent-600 transition-[width] motion-reduce:transition-none"
              style={{ width: `${onboarding?.percentComplete ?? 0}%` }}
            />
          </div>
          {onboardingQuery.isLoading ? (
            <div className="mt-5 space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-8 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
              ))}
            </div>
          ) : (
            <ol className="mt-5 space-y-4">
              {onboarding?.steps.map(step => (
                <li key={step.key} className="flex gap-3 text-sm">
                  {step.complete ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-neutral-400" />
                  )}
                  <span className={step.complete ? "text-neutral-500 line-through" : "font-medium"}>{step.label}</span>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </>
  );
}
