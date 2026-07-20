import type { AgencyClient, ClientSummary, OnboardingState, TrackingDeployment } from "@rybbit/shared";
import { authedFetch } from "../../utils";

export type CreateAgencyClientInput = {
  name: string;
  slug?: string;
  timezone: string;
  logoUrl?: string | null;
  externalRef?: string | null;
};

export function fetchAgencyClients(organizationId: string) {
  return authedFetch<{ clients: AgencyClient[] }>(`/organizations/${organizationId}/clients`);
}

export function fetchAgencyClient(organizationId: string, clientId: string) {
  return authedFetch<{ client: AgencyClient }>(`/organizations/${organizationId}/clients/${clientId}`);
}

export function createAgencyClient(organizationId: string, data: CreateAgencyClientInput) {
  return authedFetch<{ client: AgencyClient }>(`/organizations/${organizationId}/clients`, undefined, {
    method: "POST",
    data,
  });
}

export function assignAgencyClientSite(
  organizationId: string,
  clientId: string,
  data: { siteId: number; isPrimary: boolean; trackingMethod: "script" | "gtm" | "cms" | "proxy" }
) {
  return authedFetch<{ client: AgencyClient }>(
    `/organizations/${organizationId}/clients/${clientId}/sites`,
    undefined,
    { method: "POST", data }
  );
}

export function verifyAgencyClientSite(organizationId: string, clientId: string, siteId: number) {
  return authedFetch<{ status: "pending" | "verified" | "stale" | "error"; lastEventAt: string | null }>(
    `/organizations/${organizationId}/clients/${clientId}/sites/${siteId}/verify`,
    undefined,
    { method: "POST" }
  );
}

export function fetchAgencyClientOnboarding(organizationId: string, clientId: string) {
  return authedFetch<{ onboarding: OnboardingState }>(
    `/organizations/${organizationId}/clients/${clientId}/onboarding`
  );
}

export function fetchAgencyClientSummary(organizationId: string, clientId: string) {
  return authedFetch<{ summary: ClientSummary }>(`/organizations/${organizationId}/clients/${clientId}/summary`);
}

function trackingDeploymentPath(organizationId: string, clientId: string, siteId: number) {
  return `/organizations/${organizationId}/clients/${clientId}/sites/${siteId}/tracking-deployments`;
}

export function fetchTrackingDeployments(organizationId: string, clientId: string, siteId: number) {
  return authedFetch<{ deployments: TrackingDeployment[] }>(trackingDeploymentPath(organizationId, clientId, siteId));
}

export function fetchLatestSiteTrackingDeployment(organizationId: string, siteId: number) {
  return authedFetch<{ deployment: TrackingDeployment | null }>(
    `/organizations/${organizationId}/sites/${siteId}/tracking-deployment`
  );
}

export function planTrackingDeployment(
  organizationId: string,
  clientId: string,
  siteId: number,
  data: { preferredProvider: "auto" | "cloudflare" | "vercel" | "wordpress" | "manual"; vercelProject?: string }
) {
  return authedFetch<{ deployment: TrackingDeployment }>(
    `${trackingDeploymentPath(organizationId, clientId, siteId)}/plan`,
    undefined,
    { method: "POST", data }
  );
}

function runTrackingDeploymentAction(
  organizationId: string,
  clientId: string,
  siteId: number,
  deploymentId: string,
  action: "apply" | "status" | "rollback"
) {
  return authedFetch<{ deployment: TrackingDeployment }>(
    `${trackingDeploymentPath(organizationId, clientId, siteId)}/${deploymentId}/${action}`,
    undefined,
    { method: "POST" }
  );
}

export const applyTrackingDeployment = (
  organizationId: string,
  clientId: string,
  siteId: number,
  deploymentId: string
) => runTrackingDeploymentAction(organizationId, clientId, siteId, deploymentId, "apply");

export const refreshTrackingDeployment = (
  organizationId: string,
  clientId: string,
  siteId: number,
  deploymentId: string
) => runTrackingDeploymentAction(organizationId, clientId, siteId, deploymentId, "status");

export const rollbackTrackingDeployment = (
  organizationId: string,
  clientId: string,
  siteId: number,
  deploymentId: string
) => runTrackingDeploymentAction(organizationId, clientId, siteId, deploymentId, "rollback");
