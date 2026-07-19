"use client";

import { Search } from "lucide-react";
import { useExtracted } from "next-intl";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAgencyClients } from "../../../api/agency/hooks/useAgencyClients";
import { useUserOrganizations } from "../../../api/admin/hooks/useOrganizations";
import { AgencyHeader, StatusBadge } from "../../../components/agency/AgencyHeader";
import { AgencyEmpty, AgencyError, AgencyLoading } from "../../../components/agency/AgencyStates";
import { CreateClientModal } from "../../../components/agency/CreateClientModal";
import { authClient } from "../../../lib/auth";

export default function ClientsPage() {
  const t = useExtracted();
  const [query, setQuery] = useState("");
  const { data: organization, isPending: organizationPending } = authClient.useActiveOrganization();
  const { data, isLoading, error, refetch } = useAgencyClients(organization?.id);
  const { data: organizations } = useUserOrganizations();
  const membership = organizations?.find(item => item.id === organization?.id);
  const canManage = membership?.role === "owner" || membership?.role === "admin";
  const clients = data?.clients ?? [];
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return clients;
    return clients.filter(
      client =>
        client.name.toLowerCase().includes(value) ||
        client.sites.some(site => site.domain.toLowerCase().includes(value))
    );
  }, [clients, query]);

  if (organizationPending || isLoading) return <AgencyLoading />;
  if (!organization)
    return (
      <AgencyEmpty
        title={t("Choose an organization")}
        description={t("Select your agency organization to manage clients.")}
      />
    );
  if (error) return <AgencyError message={error.message} retry={() => refetch()} />;

  return (
    <>
      <AgencyHeader
        title={t("Clients")}
        description={t("Manage client identity, websites, access teams, and onboarding progress.")}
        actions={canManage ? <CreateClientModal organizationId={organization.id} /> : undefined}
      />
      {clients.length === 0 ? (
        <AgencyEmpty
          title={t("No clients yet")}
          description={t("Create a client to start assigning websites and restricted users.")}
          action={canManage ? <CreateClientModal organizationId={organization.id} /> : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <div className="border-b border-neutral-200 p-4 dark:border-neutral-800">
            <label className="relative block max-w-md">
              <span className="sr-only">{t("Search clients")}</span>
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={t("Search clients or domains")}
                className="block w-full rounded-lg border-neutral-300 bg-white py-2.5 pe-3 ps-9 text-sm focus:border-accent-500 focus:ring-accent-500 dark:border-neutral-700 dark:bg-neutral-950"
              />
            </label>
          </div>
          {filtered.length === 0 ? (
            <div className="p-5">
              <AgencyEmpty title={t("No matching clients")} description={t("Try a different client name or domain.")} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-800">
                <thead className="bg-neutral-50 dark:bg-neutral-950/50">
                  <tr>
                    {[t("Client"), t("Primary website"), t("Websites"), t("Tracking health"), t("Status")].map(
                      label => (
                        <th
                          key={label}
                          className="px-5 py-3 text-start text-xs font-semibold uppercase tracking-wide text-neutral-500"
                        >
                          {label}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {filtered.map(client => {
                    const primary = client.sites.find(site => site.isPrimary) ?? client.sites[0];
                    const healthy = client.sites.filter(site => site.trackingStatus === "verified").length;
                    return (
                      <tr key={client.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-850/60">
                        <td className="px-5 py-4">
                          <Link href={`/clients/${client.id}`} className="font-medium hover:underline">
                            {client.name}
                          </Link>
                          <p className="mt-1 text-xs text-neutral-500">{client.slug}</p>
                        </td>
                        <td className="px-5 py-4 text-sm">{primary?.domain ?? t("Not assigned")}</td>
                        <td className="px-5 py-4 text-sm tabular-nums">{client.sites.length}</td>
                        <td className="px-5 py-4 text-sm">
                          <span
                            className={
                              healthy === client.sites.length && healthy > 0
                                ? "text-emerald-700 dark:text-emerald-300"
                                : "text-amber-700 dark:text-amber-300"
                            }
                          >
                            {healthy}/{client.sites.length} {t("verified")}
                          </span>
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
          )}
        </div>
      )}
    </>
  );
}
