import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { IdentityProviderConnectionProvider, UpdateIdentityProviderConnection } from "@rybbit/shared";
import {
  fetchIdentityProviderConnections,
  testIdentityProviderConnection,
  updateIdentityProviderConnection,
} from "../endpoints/identityProviders";

const queryKey = (organizationId: string | undefined) => ["identity-provider-connections", organizationId];

export function useIdentityProviderConnections(organizationId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKey(organizationId),
    queryFn: () => fetchIdentityProviderConnections(organizationId!),
    enabled: Boolean(organizationId) && enabled,
  });
}

export function useUpdateIdentityProviderConnection(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      provider,
      data,
    }: {
      provider: IdentityProviderConnectionProvider;
      data: UpdateIdentityProviderConnection;
    }) => updateIdentityProviderConnection(organizationId, provider, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKey(organizationId) }),
  });
}

export function useTestIdentityProviderConnection(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: IdentityProviderConnectionProvider) =>
      testIdentityProviderConnection(organizationId, provider),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKey(organizationId) }),
  });
}
