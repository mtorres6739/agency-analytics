import type { EnrichmentResult, FieldProvenance, IdentityHints } from "@rybbit/shared";
import { z } from "zod";
import { ProviderConfigurationError, ProviderResponseError, type EnrichmentProvider } from "./types.js";

const resultSchema = z.object({
  name: z.string().max(255).optional(),
  email: z.string().email().max(320).optional(),
  company: z.string().max(255).optional(),
  title: z.string().max(255).optional(),
  linkedin_url: z.string().url().max(500).optional(),
  location: z.string().max(255).optional(),
});

export class PdlEnrichmentProvider implements EnrichmentProvider {
  readonly provider = "pdl" as const;

  async enrich(hints: IdentityHints): Promise<EnrichmentResult | null> {
    const apiKey = process.env.PDL_API_KEY?.trim();
    const url = process.env.PDL_ENRICH_URL?.trim();
    if (!apiKey || !url) throw new ProviderConfigurationError("pdl is not configured");
    const response = await fetch(url, {
      method: "POST",
      headers: { "X-Api-Key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(hints),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new ProviderResponseError(`pdl request failed with status ${response.status}`);
    const parsed = resultSchema.safeParse(await response.json());
    if (!parsed.success) throw new ProviderResponseError("pdl returned an unsupported response");
    const traits = {
      name: parsed.data.name,
      email: parsed.data.email?.toLowerCase(),
      company: parsed.data.company,
      title: parsed.data.title,
      linkedinUrl: parsed.data.linkedin_url,
      location: parsed.data.location,
    };
    const compactTraits = Object.fromEntries(Object.entries(traits).filter(([, value]) => value)) as EnrichmentResult["traits"];
    const observedAt = new Date().toISOString();
    const provenance = Object.keys(compactTraits).map(
      field => ({ field, provider: "pdl", confidence: 1, observedAt }) as FieldProvenance
    );
    return { traits: compactTraits, provenance };
  }

  async healthCheck() {
    return {
      ok: Boolean(process.env.PDL_API_KEY?.trim() && process.env.PDL_ENRICH_URL?.trim()),
      detail: process.env.PDL_API_KEY?.trim() && process.env.PDL_ENRICH_URL?.trim() ? "Configured" : "Not configured",
    };
  }
}

export const pdlEnrichmentProvider = new PdlEnrichmentProvider();
