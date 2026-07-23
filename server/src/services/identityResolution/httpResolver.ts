import type { IdentityProvider, ResolutionCandidate, ResolutionContext } from "@rybbit/shared";
import { normalizeProviderResponse } from "./providerPayload.js";
import { ProviderConfigurationError, ProviderResponseError, type IdentityResolver } from "./types.js";

type ResolverConfig = {
  provider: IdentityProvider;
  mode: "consumer" | "business";
  apiKeyEnv: string;
  resolveUrlEnv: string;
  healthUrlEnv: string;
  deleteUrlEnv: string;
  webhookSecretEnv: string;
};

export class HttpIdentityResolver implements IdentityResolver {
  readonly provider: IdentityProvider;
  readonly mode: "consumer" | "business";

  constructor(private readonly config: ResolverConfig) {
    this.provider = config.provider;
    this.mode = config.mode;
  }

  private credentials() {
    const apiKey = process.env[this.config.apiKeyEnv]?.trim();
    const resolveUrl = process.env[this.config.resolveUrlEnv]?.trim();
    if (!apiKey || !resolveUrl) {
      throw new ProviderConfigurationError(`${this.provider} is not configured`);
    }
    return { apiKey, resolveUrl };
  }

  async resolve(context: ResolutionContext): Promise<ResolutionCandidate[]> {
    const { apiKey, resolveUrl } = this.credentials();
    const response = await fetch(resolveUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        site_id: context.sitePublicId,
        correlation_token: context.correlationToken,
        ip_address: context.ipAddress,
        user_agent: context.userAgent,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new ProviderResponseError(`${this.provider} request failed with status ${response.status}`);
    const normalized = normalizeProviderResponse(this.provider, await response.json());
    return normalized.candidates;
  }

  async deleteSubject(providerSubjectId: string) {
    const apiKey = process.env[this.config.apiKeyEnv]?.trim();
    const deleteUrl = process.env[this.config.deleteUrlEnv]?.trim();
    if (!apiKey || !deleteUrl) throw new ProviderConfigurationError(`${this.provider} deletion is not configured`);
    const response = await fetch(deleteUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ subject_id: providerSubjectId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok && response.status !== 404) {
      throw new ProviderResponseError(`${this.provider} deletion failed with status ${response.status}`);
    }
  }

  async healthCheck() {
    const apiKey = process.env[this.config.apiKeyEnv]?.trim();
    const resolveUrl = process.env[this.config.resolveUrlEnv]?.trim();
    const webhookSecret = process.env[this.config.webhookSecretEnv]?.trim();
    if (!apiKey) return { ok: false, detail: "Provider credential is not configured" };
    if (!process.env[this.config.deleteUrlEnv]?.trim())
      return { ok: false, detail: "Deletion endpoint is not configured" };
    if (!resolveUrl && !webhookSecret)
      return { ok: false, detail: "Neither server nor signed-webhook transport is configured" };
    const healthUrl = process.env[this.config.healthUrlEnv]?.trim() || resolveUrl;
    if (!healthUrl) return { ok: true, detail: "Configured for signed-webhook transport" };
    try {
      const response = await fetch(healthUrl, {
        method: "HEAD",
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      return { ok: response.ok || response.status === 405, detail: `HTTP ${response.status}` };
    } catch {
      return { ok: false, detail: "Provider health check failed" };
    }
  }
}

export const customersAiResolver = new HttpIdentityResolver({
  provider: "customers_ai",
  mode: "consumer",
  apiKeyEnv: "CUSTOMERS_AI_API_KEY",
  resolveUrlEnv: "CUSTOMERS_AI_RESOLVE_URL",
  healthUrlEnv: "CUSTOMERS_AI_HEALTH_URL",
  deleteUrlEnv: "CUSTOMERS_AI_DELETE_URL",
  webhookSecretEnv: "CUSTOMERS_AI_WEBHOOK_SECRET",
});

export const rb2bResolver = new HttpIdentityResolver({
  provider: "rb2b",
  mode: "business",
  apiKeyEnv: "RB2B_API_KEY",
  resolveUrlEnv: "RB2B_RESOLVE_URL",
  healthUrlEnv: "RB2B_HEALTH_URL",
  deleteUrlEnv: "RB2B_DELETE_URL",
  webhookSecretEnv: "RB2B_WEBHOOK_SECRET",
});
