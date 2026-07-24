import type {
  IdentityProviderConnection,
  IdentityProviderConnectionProvider,
  UpdateIdentityProviderConnection,
} from "@rybbit/shared";
import { authedFetch } from "../../utils";

export function fetchIdentityProviderConnections(organizationId: string) {
  return authedFetch<{ data: IdentityProviderConnection[] }>(`/organizations/${organizationId}/providers`);
}

export function updateIdentityProviderConnection(
  organizationId: string,
  provider: IdentityProviderConnectionProvider,
  data: UpdateIdentityProviderConnection
) {
  return authedFetch<{ success: true; connection: { id: string; status: string } }>(
    `/organizations/${organizationId}/providers/${provider}`,
    undefined,
    { method: "PUT", data }
  );
}

export function testIdentityProviderConnection(organizationId: string, provider: IdentityProviderConnectionProvider) {
  return authedFetch<{ provider: string; ok: boolean; detail: string; checkedAt: string }>(
    `/organizations/${organizationId}/providers/${provider}/test`,
    undefined,
    { method: "POST" }
  );
}
