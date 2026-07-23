import type {
  EnrichmentResult,
  IdentityHints,
  IdentityProvider as IdentityProviderName,
  ResolutionCandidate,
  ResolutionContext,
} from "@rybbit/shared";

export interface IdentityResolver {
  provider: IdentityProviderName;
  mode: "consumer" | "business";
  resolve(context: ResolutionContext): Promise<ResolutionCandidate[]>;
  deleteSubject(providerSubjectId: string): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}

export interface EnrichmentProvider {
  provider: "pdl";
  enrich(hints: IdentityHints): Promise<EnrichmentResult | null>;
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}

export class ProviderConfigurationError extends Error {}
export class ProviderResponseError extends Error {}
