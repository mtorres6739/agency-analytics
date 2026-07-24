import {
  identityProviderAttestationKeys,
  identityProviderEvidenceKeys,
  type IdentityProviderCapability,
  type IdentityProviderConnectionProvider,
  type IdentityProviderPolicyAttestations,
  type IdentityProviderRuntimeReadiness,
} from "@rybbit/shared";
import { getPilotBudgetCents, getProviderCostMicros } from "./pricing.js";

const environmentByProvider: Record<
  IdentityProviderConnectionProvider,
  {
    credential: string;
    resolve?: string;
    webhook?: string;
    deletion?: string;
    enrichment?: string;
  }
> = {
  customers_ai: {
    credential: "CUSTOMERS_AI_API_KEY",
    resolve: "CUSTOMERS_AI_RESOLVE_URL",
    webhook: "CUSTOMERS_AI_WEBHOOK_SECRET",
    deletion: "CUSTOMERS_AI_DELETE_URL",
  },
  rb2b: {
    credential: "RB2B_API_KEY",
    resolve: "RB2B_RESOLVE_URL",
    webhook: "RB2B_WEBHOOK_SECRET",
    deletion: "RB2B_DELETE_URL",
  },
  pdl: {
    credential: "PDL_API_KEY",
    enrichment: "PDL_ENRICH_URL",
  },
};

export const providerCredentialRefs: Record<IdentityProviderConnectionProvider, string> = {
  customers_ai: "env:CUSTOMERS_AI_API_KEY",
  rb2b: "env:RB2B_API_KEY",
  pdl: "env:PDL_API_KEY",
};

function configured(name: string | undefined) {
  return Boolean(name && process.env[name]?.trim());
}

export function getProviderRuntimeReadiness(
  provider: IdentityProviderConnectionProvider,
  capabilities: IdentityProviderCapability[]
): IdentityProviderRuntimeReadiness {
  const environment = environmentByProvider[provider];
  const credentialConfigured = configured(environment.credential);
  const pricingConfigured = getProviderCostMicros(provider) !== null;
  const pilotBudgetConfigured = getPilotBudgetCents() !== null;
  const transportConfigured =
    provider === "pdl"
      ? capabilities.includes("enrich") && configured(environment.enrichment)
      : (capabilities.includes("resolve") || capabilities.includes("webhook")) &&
        (!capabilities.includes("resolve") || configured(environment.resolve)) &&
        (!capabilities.includes("webhook") || configured(environment.webhook));
  const deletionConfigured =
    provider === "pdl" ? true : capabilities.includes("delete") && configured(environment.deletion);
  const blockers: string[] = [];

  if (!credentialConfigured) blockers.push("Server credential is not configured");
  if (!pricingConfigured) blockers.push("Per-request pricing is not configured");
  if (!pilotBudgetConfigured) blockers.push("Organization pilot budget is invalid");
  if (!transportConfigured) {
    blockers.push(
      provider === "pdl" ? "Enrichment endpoint is not configured" : "Resolution transport is not configured"
    );
  }
  if (!deletionConfigured) blockers.push("Provider deletion endpoint is not configured");

  return {
    credentialConfigured,
    pricingConfigured,
    pilotBudgetConfigured,
    transportConfigured,
    deletionConfigured,
    blockers,
  };
}

export function getProviderPolicyBlockers(
  provider: IdentityProviderConnectionProvider,
  attestations: IdentityProviderPolicyAttestations | undefined
) {
  const blockers: string[] = [];
  const requiredAttestations = identityProviderAttestationKeys.filter(
    key => provider !== "pdl" || key !== "webhookSigningValidated"
  );
  for (const key of requiredAttestations) {
    if (attestations?.[key] !== true) blockers.push(`Missing policy attestation: ${key}`);
  }

  const requiredEvidence = identityProviderEvidenceKeys.filter(
    key => provider !== "pdl" || key !== "deletionReference"
  );
  for (const key of requiredEvidence) {
    if (!attestations?.evidence?.[key]?.trim()) blockers.push(`Missing contract evidence: ${key}`);
  }
  return blockers;
}

export function hasHealthySavedProviderConfiguration(
  existing:
    | {
        capabilities: string[];
        externalAccountId: string | null;
        credentialRef: string | null;
        lastHealthStatus: string | null;
      }
    | undefined,
  requested: {
    capabilities: string[];
    externalAccountId: string | null;
    credentialRef: string;
  }
) {
  if (!existing || existing.lastHealthStatus !== "healthy") return false;
  const sameCapabilities =
    JSON.stringify([...existing.capabilities].sort()) === JSON.stringify([...requested.capabilities].sort());
  return (
    sameCapabilities &&
    existing.externalAccountId === requested.externalAccountId &&
    (existing.credentialRef ?? requested.credentialRef) === requested.credentialRef
  );
}
