import type { IdentityProviderPolicyAttestations } from "@rybbit/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  getProviderPolicyBlockers,
  getProviderRuntimeReadiness,
  hasHealthySavedProviderConfiguration,
} from "./providerReadiness.js";

const relevantEnvironment = [
  "CUSTOMERS_AI_API_KEY",
  "CUSTOMERS_AI_RESOLVE_URL",
  "CUSTOMERS_AI_WEBHOOK_SECRET",
  "CUSTOMERS_AI_DELETE_URL",
  "CUSTOMERS_AI_COST_MICROS",
  "PDL_API_KEY",
  "PDL_ENRICH_URL",
  "PDL_COST_MICROS",
  "IDENTITY_PILOT_MONTHLY_BUDGET_CENTS",
] as const;
const originalEnvironment = Object.fromEntries(relevantEnvironment.map(key => [key, process.env[key]]));

afterEach(() => {
  for (const key of relevantEnvironment) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("provider runtime readiness", () => {
  it("fails closed until every declared resolver capability is configured", () => {
    process.env.CUSTOMERS_AI_API_KEY = "configured";
    process.env.CUSTOMERS_AI_RESOLVE_URL = "https://provider.example/resolve";
    process.env.CUSTOMERS_AI_DELETE_URL = "https://provider.example/delete";
    process.env.CUSTOMERS_AI_COST_MICROS = "250000";
    process.env.IDENTITY_PILOT_MONTHLY_BUDGET_CENTS = "50000";

    const missingWebhook = getProviderRuntimeReadiness("customers_ai", ["resolve", "webhook", "delete"]);
    expect(missingWebhook.transportConfigured).toBe(false);
    expect(missingWebhook.blockers).toContain("Resolution transport is not configured");

    process.env.CUSTOMERS_AI_WEBHOOK_SECRET = "configured";
    expect(getProviderRuntimeReadiness("customers_ai", ["resolve", "webhook", "delete"]).blockers).toEqual([]);
  });

  it("requires PDL credentials, endpoint, and pricing without a deletion endpoint", () => {
    process.env.PDL_API_KEY = "configured";
    process.env.PDL_ENRICH_URL = "https://provider.example/enrich";
    process.env.PDL_COST_MICROS = "98000";

    expect(getProviderRuntimeReadiness("pdl", ["enrich"])).toMatchObject({
      credentialConfigured: true,
      pricingConfigured: true,
      transportConfigured: true,
      deletionConfigured: true,
      blockers: [],
    });
  });
});

describe("provider contract policy", () => {
  const completePolicy: IdentityProviderPolicyAttestations = {
    dpaReviewed: true,
    subprocessorsReviewed: true,
    sandboxSchemaValidated: true,
    webhookSigningValidated: true,
    exportRights: true,
    normalizedStorageRights: true,
    clientDisplayRights: true,
    deletionRights: true,
    replacementRights: true,
    monthlyCommitmentUnder750: true,
    evidence: {
      dpaReference: "DPA-2026-07",
      subprocessorsReference: "subprocessors-2026-07",
      schemaReference: "sandbox-v1",
      deletionReference: "deletion-v1",
      dataRightsReference: "rights-2026-07",
      pricingReference: "quote-2026-07",
    },
  };

  it("requires attestations and evidence before resolver approval", () => {
    expect(getProviderPolicyBlockers("customers_ai", completePolicy)).toEqual([]);
    expect(
      getProviderPolicyBlockers("customers_ai", {
        ...completePolicy,
        evidence: { ...completePolicy.evidence, pricingReference: "" },
      })
    ).toContain("Missing contract evidence: pricingReference");
  });

  it("does not require webhook or deletion evidence for PDL enrichment", () => {
    const pdlPolicy = {
      ...completePolicy,
      webhookSigningValidated: false,
      evidence: { ...completePolicy.evidence, deletionReference: "" },
    };
    expect(getProviderPolicyBlockers("pdl", pdlPolicy)).toEqual([]);
  });
});

describe("provider approval health binding", () => {
  const requested = {
    capabilities: ["resolve", "delete"],
    externalAccountId: "account-1",
    credentialRef: "env:CUSTOMERS_AI_API_KEY",
  };

  it("accepts only the exact configuration that passed its health check", () => {
    expect(
      hasHealthySavedProviderConfiguration(
        {
          capabilities: ["delete", "resolve"],
          externalAccountId: "account-1",
          credentialRef: "env:CUSTOMERS_AI_API_KEY",
          lastHealthStatus: "healthy",
        },
        requested
      )
    ).toBe(true);
    expect(
      hasHealthySavedProviderConfiguration(
        {
          capabilities: ["resolve", "webhook", "delete"],
          externalAccountId: "account-1",
          credentialRef: "env:CUSTOMERS_AI_API_KEY",
          lastHealthStatus: "healthy",
        },
        requested
      )
    ).toBe(false);
    expect(
      hasHealthySavedProviderConfiguration(
        {
          capabilities: ["resolve", "delete"],
          externalAccountId: "account-1",
          credentialRef: "env:CUSTOMERS_AI_API_KEY",
          lastHealthStatus: "failed",
        },
        requested
      )
    ).toBe(false);
  });
});
