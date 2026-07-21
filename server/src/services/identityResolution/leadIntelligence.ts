import type { ResolutionCandidate } from "@rybbit/shared";
import { callOpenRouter } from "../../lib/openrouter.js";

export type IcpCriteria = {
  companyKeywords?: string[];
  titleKeywords?: string[];
  minimumConfidence?: number;
};

export function scoreIdentityCandidate(candidate: Pick<ResolutionCandidate, "confidence" | "traits">, criteria: IcpCriteria) {
  let score = Math.round(candidate.confidence * 60);
  const reasons = [`Identity confidence contributes ${Math.round(candidate.confidence * 60)} points`];
  const company = candidate.traits.company?.toLowerCase() || "";
  const title = candidate.traits.title?.toLowerCase() || "";
  const companyMatch = (criteria.companyKeywords || []).find(keyword => company.includes(keyword.toLowerCase()));
  const titleMatch = (criteria.titleKeywords || []).find(keyword => title.includes(keyword.toLowerCase()));
  if (companyMatch) {
    score += 15;
    reasons.push(`Company matches ICP keyword: ${companyMatch}`);
  }
  if (titleMatch) {
    score += 20;
    reasons.push(`Title matches ICP keyword: ${titleMatch}`);
  }
  if (candidate.traits.company && candidate.traits.title) {
    score += 5;
    reasons.push("Company and title are both available");
  }
  return { score: Math.min(100, score), reasons };
}

export async function generateLeadBrief(input: {
  candidate: Pick<ResolutionCandidate, "confidence" | "matchMethod" | "traits">;
  score: number;
  reasons: string[];
}) {
  const safeContext = {
    company: input.candidate.traits.company,
    title: input.candidate.traits.title,
    coarseLocation: input.candidate.traits.location,
    matchMethod: input.candidate.matchMethod,
    confidence: input.candidate.confidence,
    icpScore: input.score,
    scoringReasons: input.reasons,
  };
  return callOpenRouter(
    [
      {
        role: "system",
        content:
          "Write a factual two-to-four sentence lead research brief for an agency analyst. Use only the supplied fields. Do not infer identity, protected traits, health, legal needs, personal circumstances, intent, or contact details. State uncertainty plainly. Never recommend automatic outreach.",
      },
      { role: "user", content: JSON.stringify(safeContext) },
    ],
    { temperature: 0.1, maxTokens: 220 }
  );
}
