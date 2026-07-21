import type { FieldProvenance, IdentityProvider, ResolutionCandidate } from "@rybbit/shared";
import { z } from "zod";
import { ProviderResponseError } from "./types.js";

const traitsSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    email: z.string().trim().toLowerCase().email().max(320).optional(),
    company: z.string().trim().min(1).max(255).optional(),
    title: z.string().trim().min(1).max(255).optional(),
    linkedinUrl: z.string().trim().url().max(500).optional(),
    location: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

const candidateSchema = z.object({
  id: z.string().min(1).max(512),
  confidence: z.number().min(0).max(1),
  match_method: z.enum(["deterministic", "probabilistic"]),
  traits: traitsSchema,
  request_id: z.string().max(255).optional(),
});

const responseSchema = z.union([
  z.object({ candidates: z.array(candidateSchema).max(10), request_id: z.string().max(255).optional() }),
  candidateSchema.transform(candidate => ({ candidates: [candidate], request_id: candidate.request_id })),
]);

export function normalizeProviderResponse(provider: IdentityProvider, payload: unknown): {
  candidates: ResolutionCandidate[];
  requestId?: string;
} {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw new ProviderResponseError(`${provider} returned an unsupported response`);
  const observedAt = new Date().toISOString();
  return {
    requestId: parsed.data.request_id,
    candidates: parsed.data.candidates.map(candidate => ({
      providerSubjectId: candidate.id,
      confidence: candidate.confidence,
      matchMethod: candidate.match_method,
      traits: candidate.traits,
      provenance: Object.keys(candidate.traits).map(
        field =>
          ({
            field,
            provider,
            confidence: candidate.confidence,
            observedAt,
          }) as FieldProvenance
      ),
    })),
  };
}
