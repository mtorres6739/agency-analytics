"use client";

import type { AgencyClientSite, TrackingDeployment } from "@rybbit/shared";
import { ArrowUpRight, CheckCircle2, Cloud, Loader2, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  useApplyTrackingDeployment,
  usePlanTrackingDeployment,
  useRefreshTrackingDeployment,
  useRollbackTrackingDeployment,
  useTrackingDeployments,
  useVerifyAgencyClientSite,
} from "../../api/agency/hooks/useAgencyClients";

type ProviderChoice = "auto" | "cloudflare" | "vercel";

const deploymentTone: Record<TrackingDeployment["status"], string> = {
  queued: "bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200",
  running: "bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200",
  succeeded: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  blocked: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  failed: "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200",
};

function DeploymentStatus({ deployment }: { deployment: TrackingDeployment }) {
  const label = deployment.status === "running" ? "Working" : deployment.status;
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium capitalize ${deploymentTone[deployment.status]}`}
    >
      {label}
    </span>
  );
}

export function TrackingInstaller({
  organizationId,
  clientId,
  site,
}: {
  organizationId: string;
  clientId: string;
  site: AgencyClientSite;
}) {
  const deploymentsQuery = useTrackingDeployments(organizationId, clientId, site.siteId);
  const plan = usePlanTrackingDeployment();
  const apply = useApplyTrackingDeployment();
  const refresh = useRefreshTrackingDeployment();
  const rollback = useRollbackTrackingDeployment();
  const verify = useVerifyAgencyClientSite();
  const [provider, setProvider] = useState<ProviderChoice>("auto");
  const [vercelProject, setVercelProject] = useState("");
  const [confirmRollback, setConfirmRollback] = useState(false);
  const autoPlanRequested = useRef(false);

  const deployments = deploymentsQuery.data?.deployments ?? [];
  const latest = deployments[0];
  const latestPlan = deployments.find(deployment => deployment.action === "plan");
  const latestSuccessfulChange = deployments.find(
    deployment => ["apply", "rollback"].includes(deployment.action) && deployment.status === "succeeded"
  );
  const latestApply = latestSuccessfulChange?.action === "apply" ? latestSuccessfulChange : undefined;
  const active = deployments.some(deployment => ["queued", "running"].includes(deployment.status));
  const busy = active || plan.isPending || apply.isPending || refresh.isPending || rollback.isPending;
  const error = plan.error ?? apply.error ?? refresh.error ?? rollback.error ?? verify.error ?? deploymentsQuery.error;

  const mutationInput = (deploymentId: string) => ({ organizationId, clientId, siteId: site.siteId, deploymentId });

  useEffect(() => {
    if (deploymentsQuery.isLoading || deployments.length > 0 || autoPlanRequested.current) return;
    autoPlanRequested.current = true;
    plan.mutate({
      organizationId,
      clientId,
      siteId: site.siteId,
      data: { preferredProvider: "auto" },
    });
  }, [clientId, deployments.length, deploymentsQuery.isLoading, organizationId, plan, site.siteId]);

  return (
    <section className="border-t border-neutral-100 bg-neutral-50/70 px-5 py-4 dark:border-neutral-800 dark:bg-neutral-950/40">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-accent-700 dark:text-accent-300" aria-hidden="true" />
            <h3 className="text-sm font-semibold">Managed tracking installation</h3>
            {latest ? <DeploymentStatus deployment={latest} /> : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            Detects the safest supported installation path before making any website changes. Credentials stay on the
            analytics server.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            aria-label="Installation provider"
            value={provider}
            disabled={busy}
            onChange={event => setProvider(event.target.value as ProviderChoice)}
            className="rounded-lg border-neutral-300 bg-white text-sm focus:border-accent-500 focus:ring-accent-500 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="auto">Detect automatically</option>
            <option value="cloudflare">Cloudflare Worker</option>
            <option value="vercel">Vercel preview PR</option>
          </select>
          {provider === "vercel" ? (
            <input
              value={vercelProject}
              disabled={busy}
              onChange={event => setVercelProject(event.target.value)}
              placeholder="Vercel project (optional)"
              aria-label="Vercel project"
              className="rounded-lg border-neutral-300 bg-white text-sm focus:border-accent-500 focus:ring-accent-500 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900"
            />
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              plan.mutate({
                organizationId,
                clientId,
                siteId: site.siteId,
                data: { preferredProvider: provider, ...(vercelProject ? { vercelProject } : {}) },
              })
            }
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <Cloud className="size-4" />
            )}
            Detect and plan
          </button>
        </div>
      </div>

      {latestPlan && !["queued", "running"].includes(latestPlan.status) ? (
        <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold capitalize">
                {latestPlan.result.provider ?? latestPlan.provider} installation
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                {latestPlan.result.route
                  ? `Worker route: ${latestPlan.result.route}`
                  : latestPlan.result.repository
                    ? `${latestPlan.result.repository} · ${latestPlan.result.filePath}`
                    : site.domain}
              </p>
            </div>
            {latestPlan.status === "succeeded" && !latestPlan.result.blocked && latestPlan.result.installed ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                  <CheckCircle2 className="size-3.5" aria-hidden="true" /> Already installed
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => verify.mutate({ organizationId, clientId, siteId: site.siteId })}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  <CheckCircle2 className="size-4" /> Verify event
                </button>
              </div>
            ) : latestPlan.status === "succeeded" && !latestPlan.result.blocked ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => apply.mutate(mutationInput(latestPlan.id))}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-60 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
              >
                <ShieldCheck className="size-4" />
                {latestPlan.result.provider === "vercel" ? "Create preview PR" : "Install tracking"}
              </button>
            ) : null}
          </div>
          {latestPlan.result.reason ? (
            <p
              className={`mt-3 text-sm ${latestPlan.result.blocked ? "text-amber-800 dark:text-amber-200" : "text-neutral-600 dark:text-neutral-300"}`}
            >
              {latestPlan.result.reason}
            </p>
          ) : null}
        </div>
      ) : null}

      {latestApply ? (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900/60 dark:bg-emerald-950/25 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-2 font-semibold text-emerald-900 dark:text-emerald-100">
              <CheckCircle2 className="size-4" />
              {latestApply.provider === "cloudflare"
                ? "Tracking installed and reachable"
                : "Preview pull request created"}
            </p>
            <p className="mt-1 text-xs text-emerald-800/80 dark:text-emerald-200/80">
              {latestApply.provider === "vercel"
                ? "Review the Vercel preview, verify an event, then merge the pull request."
                : "Open the live website once, then verify the first analytics event."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {latestApply.result.pullRequestUrl ? (
              <a
                href={latestApply.result.pullRequestUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-200 hover:bg-emerald-50 dark:bg-neutral-900 dark:text-emerald-100 dark:ring-emerald-900"
              >
                Open PR <ArrowUpRight className="size-4" />
              </a>
            ) : null}
            {latestApply.provider === "vercel" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => refresh.mutate(mutationInput(latestApply.id))}
                className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-200 hover:bg-emerald-50 disabled:opacity-60 dark:bg-neutral-900 dark:text-emerald-100 dark:ring-emerald-900"
              >
                <RefreshCw className="size-4" /> Refresh preview
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => verify.mutate({ organizationId, clientId, siteId: site.siteId })}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-800 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              <CheckCircle2 className="size-4" /> Verify event
            </button>
            {!confirmRollback ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmRollback(true)}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-neutral-600 hover:bg-white disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-900"
              >
                <RotateCcw className="size-4" /> Roll back
              </button>
            ) : (
              <div className="flex gap-2" role="group" aria-label="Confirm tracking rollback">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    rollback.mutate(mutationInput(latestApply.id), { onSuccess: () => setConfirmRollback(false) })
                  }
                  className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
                >
                  Confirm rollback
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRollback(false)}
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-neutral-600 dark:text-neutral-300"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {latest?.action === "status" && latest.status === "succeeded" && latest.result.previewUrl ? (
        <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-300">
          Preview: {latest.result.previewState ?? "unknown"} ·{" "}
          <a
            className="font-semibold text-accent-700 hover:underline dark:text-accent-300"
            href={latest.result.previewUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open preview
          </a>
        </p>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-700 dark:text-red-300">{error.message}</p> : null}
      {latest?.errorSummary ? (
        <p className="mt-3 text-sm text-red-700 dark:text-red-300">{latest.errorSummary}</p>
      ) : null}
    </section>
  );
}
