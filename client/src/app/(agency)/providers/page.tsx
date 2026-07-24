"use client";

import {
  identityProviderAttestationKeys,
  identityProviderEvidenceKeys,
  type IdentityProviderAttestationKey,
  type IdentityProviderCapability,
  type IdentityProviderConnection,
  type IdentityProviderEvidenceKey,
  type IdentityProviderPolicyAttestations,
} from "@rybbit/shared";
import { CheckCircle2, CircleAlert, FlaskConical, LockKeyhole, Save, ShieldCheck, XCircle } from "lucide-react";
import { useExtracted } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useUserOrganizations } from "../../../api/admin/hooks/useOrganizations";
import {
  useIdentityProviderConnections,
  useTestIdentityProviderConnection,
  useUpdateIdentityProviderConnection,
} from "../../../api/admin/hooks/useIdentityProviders";
import { AgencyHeader, StatusBadge } from "../../../components/agency/AgencyHeader";
import { AgencyEmpty, AgencyError, AgencyLoading } from "../../../components/agency/AgencyStates";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { toast } from "../../../components/ui/sonner";
import { authClient } from "../../../lib/auth";

const providerDetails = {
  customers_ai: {
    name: "CustomersAI",
    description: "Consumer and local-service visitor resolution",
    defaultCapabilities: ["resolve", "delete"] as IdentityProviderCapability[],
  },
  rb2b: {
    name: "RB2B",
    description: "Business visitor and company resolution",
    defaultCapabilities: ["resolve", "delete"] as IdentityProviderCapability[],
  },
  pdl: {
    name: "People Data Labs",
    description: "Selective person and company enrichment",
    defaultCapabilities: ["enrich"] as IdentityProviderCapability[],
  },
} as const;

function ProviderCard({
  connection,
  canManage,
  organizationId,
}: {
  connection: IdentityProviderConnection;
  canManage: boolean;
  organizationId: string;
}) {
  const t = useExtracted();
  const details = providerDetails[connection.provider];
  const updateMutation = useUpdateIdentityProviderConnection(organizationId);
  const testMutation = useTestIdentityProviderConnection(organizationId);
  const [externalAccountId, setExternalAccountId] = useState(connection.externalAccountId ?? "");
  const [capabilities, setCapabilities] = useState<IdentityProviderCapability[]>(
    connection.capabilities.length ? connection.capabilities : details.defaultCapabilities
  );
  const [attestations, setAttestations] = useState<IdentityProviderPolicyAttestations>(connection.policyAttestations);
  const [dirty, setDirty] = useState(!connection.configured);

  useEffect(() => {
    setExternalAccountId(connection.externalAccountId ?? "");
    setCapabilities(connection.capabilities.length ? connection.capabilities : details.defaultCapabilities);
    setAttestations(connection.policyAttestations);
    setDirty(!connection.configured);
  }, [connection, details.defaultCapabilities]);

  const requiredAttestations = useMemo(
    () =>
      identityProviderAttestationKeys.filter(key => connection.provider !== "pdl" || key !== "webhookSigningValidated"),
    [connection.provider]
  );
  const requiredEvidence = useMemo(
    () => identityProviderEvidenceKeys.filter(key => connection.provider !== "pdl" || key !== "deletionReference"),
    [connection.provider]
  );
  const policyComplete =
    requiredAttestations.every(key => attestations[key] === true) &&
    requiredEvidence.every(key => Boolean(attestations.evidence?.[key]?.trim()));
  const busy = updateMutation.isPending || testMutation.isPending;
  const attestationLabel = (key: IdentityProviderAttestationKey) => {
    switch (key) {
      case "dpaReviewed":
        return t("DPA reviewed");
      case "subprocessorsReviewed":
        return t("Subprocessors reviewed");
      case "sandboxSchemaValidated":
        return t("Sandbox schema validated");
      case "webhookSigningValidated":
        return t("Webhook signing validated");
      case "exportRights":
        return t("Export rights confirmed");
      case "normalizedStorageRights":
        return t("Normalized storage rights confirmed");
      case "clientDisplayRights":
        return t("Client display rights confirmed");
      case "deletionRights":
        return t("Deletion rights confirmed");
      case "replacementRights":
        return t("Provider replacement rights confirmed");
      case "monthlyCommitmentUnder750":
        return t("Monthly commitment is below $750");
    }
  };
  const evidenceLabel = (key: IdentityProviderEvidenceKey) => {
    switch (key) {
      case "dpaReference":
        return t("DPA reference");
      case "subprocessorsReference":
        return t("Subprocessor reference");
      case "schemaReference":
        return t("Sandbox schema reference");
      case "deletionReference":
        return t("Deletion API reference");
      case "dataRightsReference":
        return t("Data-rights approval reference");
      case "pricingReference":
        return t("Pricing quote reference");
    }
  };

  const payload = (status: "pending" | "approved" | "disabled") => ({
    externalAccountId: externalAccountId.trim() || null,
    capabilities,
    status,
    credentialRef: connection.credentialRef,
    attestations,
  });

  const save = async (status: "pending" | "approved" | "disabled") => {
    try {
      await updateMutation.mutateAsync({ provider: connection.provider, data: payload(status) });
      setDirty(false);
      toast.success(
        status === "approved"
          ? t("Provider approved")
          : status === "disabled"
            ? t("Provider disabled")
            : t("Provider configuration saved")
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Provider update failed"));
    }
  };

  const testConnection = async () => {
    try {
      const result = await testMutation.mutateAsync(connection.provider);
      toast.success(t("Provider health check passed: {detail}", { detail: result.detail }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Provider health check failed"));
    }
  };

  const toggleCapability = (capability: IdentityProviderCapability, checked: boolean) => {
    setCapabilities(current =>
      checked ? [...new Set([...current, capability])] : current.filter(value => value !== capability)
    );
    setDirty(true);
  };

  return (
    <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-col justify-between gap-4 border-b border-neutral-200 p-5 sm:flex-row sm:items-start dark:border-neutral-800">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{details.name}</h2>
            <StatusBadge status={connection.status} />
            {connection.lastHealthStatus ? <StatusBadge status={connection.lastHealthStatus} /> : null}
          </div>
          <p className="mt-1 text-sm text-neutral-500">{details.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!canManage || busy || !connection.configured || dirty}
            onClick={() => void testConnection()}
          >
            <FlaskConical className="mr-2 size-4" />
            {t("Test connection")}
          </Button>
          <Button variant="outline" disabled={!canManage || busy} onClick={() => void save("pending")}>
            <Save className="mr-2 size-4" />
            {t("Save pending")}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.42fr)]">
        <div className="space-y-6">
          <div>
            <label className="text-sm font-medium" htmlFor={`${connection.provider}-account`}>
              {t("External account ID")}
            </label>
            <input
              id={`${connection.provider}-account`}
              value={externalAccountId}
              disabled={!canManage || busy}
              onChange={event => {
                setExternalAccountId(event.target.value);
                setDirty(true);
              }}
              placeholder={t("Optional provider account reference")}
              className="mt-2 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:border-neutral-700 dark:bg-neutral-950"
            />
          </div>

          <fieldset>
            <legend className="text-sm font-medium">{t("Approved capabilities")}</legend>
            <div className="mt-3 flex flex-wrap gap-4">
              {(connection.provider === "pdl"
                ? (["enrich"] as IdentityProviderCapability[])
                : (["resolve", "webhook", "delete"] as IdentityProviderCapability[])
              ).map(capability => (
                <label key={capability} className="flex items-center gap-2 text-sm capitalize">
                  <Checkbox
                    checked={capabilities.includes(capability)}
                    disabled={!canManage || busy}
                    onCheckedChange={checked => toggleCapability(capability, checked === true)}
                  />
                  {capability}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">{t("Contract and data-rights review")}</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {requiredAttestations.map(key => (
                <label
                  key={key}
                  className="flex items-start gap-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={attestations[key] === true}
                    disabled={!canManage || busy}
                    onCheckedChange={checked => {
                      setAttestations(current => ({ ...current, [key]: checked === true }));
                      setDirty(true);
                    }}
                  />
                  {attestationLabel(key)}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">{t("Evidence references")}</legend>
            <p className="mt-1 text-xs text-neutral-500">
              {t("Store document IDs or approved URLs only. Never paste credentials or contract contents.")}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {requiredEvidence.map(key => (
                <label key={key} className="text-sm">
                  {evidenceLabel(key)}
                  <input
                    value={attestations.evidence?.[key] ?? ""}
                    disabled={!canManage || busy}
                    onChange={event => {
                      setAttestations(current => ({
                        ...current,
                        evidence: { ...current.evidence, [key]: event.target.value },
                      }));
                      setDirty(true);
                    }}
                    className="mt-1.5 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:border-neutral-700 dark:bg-neutral-950"
                  />
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl bg-neutral-50 p-4 dark:bg-neutral-950/60">
            <h3 className="text-sm font-semibold">{t("Runtime readiness")}</h3>
            <div className="mt-3 space-y-2 text-sm">
              {[
                [t("Server credential"), connection.readiness.credentialConfigured],
                [t("Per-request pricing"), connection.readiness.pricingConfigured],
                [t("Pilot budget"), connection.readiness.pilotBudgetConfigured],
                [t("Provider transport"), connection.readiness.transportConfigured],
                [t("Deletion support"), connection.readiness.deletionConfigured],
              ].map(([label, ready]) => (
                <div key={String(label)} className="flex items-center justify-between gap-3">
                  <span className="text-neutral-600 dark:text-neutral-300">{label}</span>
                  {ready ? (
                    <CheckCircle2 className="size-4 text-emerald-600" aria-label={t("Ready")} />
                  ) : (
                    <XCircle className="size-4 text-amber-600" aria-label={t("Not ready")} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {connection.readiness.blockers.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              <div className="flex gap-2 font-medium">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {t("Activation blocked")}
              </div>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                {connection.readiness.blockers.map(blocker => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-2">
            <Button
              className="w-full"
              disabled={
                !canManage ||
                busy ||
                dirty ||
                !policyComplete ||
                connection.readiness.blockers.length > 0 ||
                connection.lastHealthStatus !== "healthy"
              }
              onClick={() => void save("approved")}
            >
              <ShieldCheck className="mr-2 size-4" />
              {t("Approve provider")}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              disabled={!canManage || busy || !connection.configured || connection.status === "disabled"}
              onClick={() => void save("disabled")}
            >
              {t("Disable provider")}
            </Button>
          </div>
        </aside>
      </div>
    </section>
  );
}

export default function DataProvidersPage() {
  const t = useExtracted();
  const { data: organization, isPending: organizationPending } = authClient.useActiveOrganization();
  const { data: organizations, isPending: organizationsPending } = useUserOrganizations();
  const membership = organizations?.find(item => item.id === organization?.id);
  const canManage = membership?.role === "owner" || membership?.role === "admin";
  const providersQuery = useIdentityProviderConnections(organization?.id, Boolean(canManage));

  if (organizationPending || organizationsPending || (canManage && providersQuery.isLoading)) return <AgencyLoading />;
  if (!organization) {
    return (
      <AgencyEmpty title={t("Choose an organization")} description={t("Select your agency organization first.")} />
    );
  }
  if (!canManage) {
    return (
      <AgencyEmpty
        title={t("Administrator access required")}
        description={t("Only agency owners and administrators can view or configure data providers.")}
      />
    );
  }
  if (providersQuery.error) {
    return <AgencyError message={providersQuery.error.message} retry={() => providersQuery.refetch()} />;
  }

  return (
    <>
      <AgencyHeader
        eyebrow={t("Identity infrastructure")}
        title={t("Data providers")}
        description={t(
          "Connect replaceable identity signals without exposing vendor credentials to websites, staff, or clients."
        )}
      />
      <div className="mb-6 flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
        <LockKeyhole className="mt-0.5 size-5 shrink-0" />
        <p>
          {t(
            "Credentials and provider endpoints are installed only on the analytics server. Saving this screen never starts resolution; each site still requires its own compliance approval, budget, consent, and kill-switch activation."
          )}
        </p>
      </div>
      <div className="space-y-6">
        {(providersQuery.data?.data ?? []).map(connection => (
          <ProviderCard key={connection.provider} connection={connection} canManage organizationId={organization.id} />
        ))}
      </div>
    </>
  );
}
