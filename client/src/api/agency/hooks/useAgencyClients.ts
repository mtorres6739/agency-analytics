import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  applyTrackingDeployment,
  assignAgencyClientSite,
  createAgencyClient,
  fetchAgencyClient,
  fetchAgencyClientOnboarding,
  fetchAgencyClientSummary,
  fetchAgencyClients,
  fetchLatestSiteTrackingDeployment,
  fetchTrackingDeployments,
  planTrackingDeployment,
  refreshTrackingDeployment,
  rollbackTrackingDeployment,
  verifyAgencyClientSite,
  type CreateAgencyClientInput,
} from "../endpoints/clients";

export const AGENCY_CLIENTS_QUERY_KEY = "agency-clients";

export function useAgencyClients(organizationId?: string) {
  return useQuery({
    queryKey: [AGENCY_CLIENTS_QUERY_KEY, organizationId],
    queryFn: () => fetchAgencyClients(organizationId!),
    enabled: !!organizationId,
  });
}

export function useAgencyClient(organizationId?: string, clientId?: string) {
  return useQuery({
    queryKey: [AGENCY_CLIENTS_QUERY_KEY, organizationId, clientId],
    queryFn: () => fetchAgencyClient(organizationId!, clientId!),
    enabled: !!organizationId && !!clientId,
  });
}

export function useCreateAgencyClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ organizationId, data }: { organizationId: string; data: CreateAgencyClientInput }) =>
      createAgencyClient(organizationId, data),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: [AGENCY_CLIENTS_QUERY_KEY, variables.organizationId] }),
  });
}

export function useAssignAgencyClientSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      organizationId,
      clientId,
      data,
    }: {
      organizationId: string;
      clientId: string;
      data: { siteId: number; isPrimary: boolean; trackingMethod: "script" | "gtm" | "cms" | "proxy" };
    }) => assignAgencyClientSite(organizationId, clientId, data),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: [AGENCY_CLIENTS_QUERY_KEY, variables.organizationId] }),
  });
}

export function useAgencyClientOnboarding(organizationId?: string, clientId?: string) {
  return useQuery({
    queryKey: ["agency-client-onboarding", organizationId, clientId],
    queryFn: () => fetchAgencyClientOnboarding(organizationId!, clientId!),
    enabled: !!organizationId && !!clientId,
  });
}

export function useAgencyClientSummary(organizationId?: string, clientId?: string) {
  return useQuery({
    queryKey: ["agency-client-summary", organizationId, clientId],
    queryFn: () => fetchAgencyClientSummary(organizationId!, clientId!),
    enabled: !!organizationId && !!clientId,
  });
}

export function useVerifyAgencyClientSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ organizationId, clientId, siteId }: { organizationId: string; clientId: string; siteId: number }) =>
      verifyAgencyClientSite(organizationId, clientId, siteId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [AGENCY_CLIENTS_QUERY_KEY, variables.organizationId] });
      queryClient.invalidateQueries({
        queryKey: ["agency-client-onboarding", variables.organizationId, variables.clientId],
      });
    },
  });
}

const trackingDeploymentQueryKey = (organizationId?: string, clientId?: string, siteId?: number) => [
  "tracking-deployments",
  organizationId,
  clientId,
  siteId,
];

export function useTrackingDeployments(organizationId?: string, clientId?: string, siteId?: number) {
  return useQuery({
    queryKey: trackingDeploymentQueryKey(organizationId, clientId, siteId),
    queryFn: () => fetchTrackingDeployments(organizationId!, clientId!, siteId!),
    enabled: !!organizationId && !!clientId && !!siteId,
    refetchInterval: query =>
      query.state.data?.deployments.some(deployment => ["queued", "running"].includes(deployment.status))
        ? 1_500
        : false,
  });
}

export function useLatestSiteTrackingDeployment(organizationId?: string, siteId?: number) {
  return useQuery({
    queryKey: ["site-tracking-deployment", organizationId, siteId],
    queryFn: () => fetchLatestSiteTrackingDeployment(organizationId!, siteId!),
    enabled: !!organizationId && !!siteId,
    refetchInterval: query =>
      query.state.data?.deployment && ["queued", "running"].includes(query.state.data.deployment.status)
        ? 1_500
        : false,
  });
}

function useTrackingDeploymentMutation(
  action: (organizationId: string, clientId: string, siteId: number, deploymentId: string) => Promise<unknown>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      organizationId,
      clientId,
      siteId,
      deploymentId,
    }: {
      organizationId: string;
      clientId: string;
      siteId: number;
      deploymentId: string;
    }) => action(organizationId, clientId, siteId, deploymentId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: trackingDeploymentQueryKey(variables.organizationId, variables.clientId, variables.siteId),
      });
      queryClient.invalidateQueries({
        queryKey: [AGENCY_CLIENTS_QUERY_KEY, variables.organizationId, variables.clientId],
      });
    },
  });
}

export function usePlanTrackingDeployment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      organizationId,
      clientId,
      siteId,
      data,
    }: {
      organizationId: string;
      clientId: string;
      siteId: number;
      data: { preferredProvider: "auto" | "cloudflare" | "vercel" | "wordpress" | "manual"; vercelProject?: string };
    }) => planTrackingDeployment(organizationId, clientId, siteId, data),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({
        queryKey: trackingDeploymentQueryKey(variables.organizationId, variables.clientId, variables.siteId),
      }),
  });
}

export const useApplyTrackingDeployment = () => useTrackingDeploymentMutation(applyTrackingDeployment);
export const useRefreshTrackingDeployment = () => useTrackingDeploymentMutation(refreshTrackingDeployment);
export const useRollbackTrackingDeployment = () => useTrackingDeploymentMutation(rollbackTrackingDeployment);
