import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assignAgencyClientSite,
  createAgencyClient,
  fetchAgencyClient,
  fetchAgencyClientOnboarding,
  fetchAgencyClientSummary,
  fetchAgencyClients,
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
