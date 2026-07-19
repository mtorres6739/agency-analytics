"use client";

import { Activity, Building2, CheckCircle2, CircleAlert, Globe2 } from "lucide-react";
import { useExtracted } from "next-intl";
import Link from "next/link";
import { useAgencyClients } from "../../../api/agency/hooks/useAgencyClients";
import { useUserOrganizations } from "../../../api/admin/hooks/useOrganizations";
import { AgencyHeader, StatusBadge } from "../../../components/agency/AgencyHeader";
import { AgencyEmpty, AgencyError, AgencyLoading } from "../../../components/agency/AgencyStates";
import { CreateClientModal } from "../../../components/agency/CreateClientModal";
import { authClient } from "../../../lib/auth";

export default function PortfolioPage() {
  const t = useExtracted();
  const { data: organization, isPending: organizationPending } = authClient.useActiveOrganization();
  const { data, isLoading, error, refetch } = useAgencyClients(organization?.id);
  const { data: organizations } = useUserOrganizations();
  const membership = organizations?.find(item => item.id === organization?.id);
  const canManage = membership?.role === "owner" || membership?.role === "admin";
  const clients = data?.clients ?? [];
  const sites = clients.flatMap(client => client.sites);
  const verified = sites.filter(site => site.trackingStatus === "verified").length;
  const attention = clients.filter(
    client => client.sites.length === 0 || client.sites.some(site => site.trackingStatus !== "verified")
  );

  if (organizationPending || isLoading) return <AgencyLoading />;
  if (!organization)
    return (
      <AgencyEmpty
        title={t("Choose an organization")}
        description={t("Select your agency organization to open the portfolio.")}
      />
    );
  if (error) return <AgencyError message={error.message} retry={() => refetch()} />;

  return (
    <>
      <AgencyHeader
        eyebrow={t("Agency overview")}
        title={t("Portfolio")}
        description={t("Tracking health, onboarding progress, and client access across every managed website.")}
        actions={canManage ? <CreateClientModal organizationId={organization.id} /> : undefined}
      />
      {clients.length === 0 ? (
        <AgencyEmpty
          title={t("No clients yet")}
          description={t(
            "Create the first client, connect a website, and verify tracking to start the agency portfolio."
          )}
          action={canManage ? <CreateClientModal organizationId={organization.id} /> : undefined}
        />
      ) : (
        <div className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("Portfolio key metrics")}>
            {[
              {
                label: t("Active clients"),
                value: clients.filter(client => client.status === "active").length,
                sub: t("of {count} total", { count: String(clients.length) }),
                icon: Building2,
              },
              { label: t("Managed websites"), value: sites.length, sub: t("Across all clients"), icon: Globe2 },
              {
                label: t("Tracking verified"),
                value: verified,
                sub: t("{count} need review", { count: String(sites.length - verified) }),
                icon: CheckCircle2,
              },
              {
                label: t("Needs attention"),
                value: attention.length,
                sub: t("Setup or tracking issue"),
                icon: CircleAlert,
              },
            ].map(metric => (
              <article
                key={metric.label}
                className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="flex items-start justify-between">
                  <p className="text-sm font-medium text-neutral-550 dark:text-neutral-400">{metric.label}</p>
                  <metric.icon className="size-5 text-neutral-400" aria-hidden="true" />
                </div>
                <p className="mt-4 text-3xl font-semibold tabular-nums">{metric.value}</p>
                <p className="mt-1 text-xs text-neutral-500">{metric.sub}</p>
              </article>
            ))}
          </section>

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)]">
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
                <div>
                  <h2 className="font-semibold">{t("Client portfolio")}</h2>
                  <p className="mt-1 text-xs text-neutral-500">{t("Access and tracking status by client")}</p>
                </div>
                <Link
                  href="/clients"
                  className="text-sm font-medium text-accent-700 hover:underline dark:text-accent-300"
                >
                  {t("View all")}
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-800">
                  <thead className="bg-neutral-50 dark:bg-neutral-950/50">
                    <tr>
                      {[t("Client"), t("Websites"), t("Tracking"), t("Status")].map(label => (
                        <th
                          key={label}
                          scope="col"
                          className="px-5 py-3 text-start text-xs font-semibold uppercase tracking-wide text-neutral-500"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {clients.slice(0, 8).map(client => {
                      const verifiedCount = client.sites.filter(site => site.trackingStatus === "verified").length;
                      return (
                        <tr key={client.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-850/60">
                          <td className="px-5 py-4">
                            <Link href={`/clients/${client.id}`} className="font-medium hover:underline">
                              {client.name}
                            </Link>
                            <p className="mt-0.5 text-xs text-neutral-500">{client.timezone}</p>
                          </td>
                          <td className="px-5 py-4 text-sm tabular-nums">{client.sites.length}</td>
                          <td className="px-5 py-4 text-sm text-neutral-600 dark:text-neutral-300">
                            {verifiedCount}/{client.sites.length} {t("verified")}
                          </td>
                          <td className="px-5 py-4">
                            <StatusBadge status={client.status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-center gap-2">
                <Activity className="size-5 text-amber-600" />
                <h2 className="font-semibold">{t("Needs attention")}</h2>
              </div>
              <div className="mt-4 space-y-3">
                {attention.length === 0 ? (
                  <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                    {t("All client tracking is healthy.")}
                  </p>
                ) : (
                  attention.slice(0, 6).map(client => (
                    <Link
                      key={client.id}
                      href={`/clients/${client.id}`}
                      className="block rounded-lg border border-neutral-200 p-3 hover:border-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-neutral-800 dark:hover:border-neutral-600"
                    >
                      <p className="text-sm font-medium">{client.name}</p>
                      <p className="mt-1 text-xs text-neutral-500">
                        {client.sites.length === 0 ? t("No website assigned") : t("Tracking verification required")}
                      </p>
                    </Link>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
