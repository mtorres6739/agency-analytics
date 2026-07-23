import { describe, expect, it } from "vitest";
import { scoreIdentityCandidate } from "./leadIntelligence.js";

describe("identity candidate ICP score", () => {
  it("is deterministic and never changes identity confidence", () => {
    const candidate = {
      confidence: 0.9,
      traits: { company: "Acme Dental Group", title: "Practice Owner" },
    };
    const criteria = { companyKeywords: ["dental"], titleKeywords: ["owner"] };
    const first = scoreIdentityCandidate(candidate, criteria);
    const second = scoreIdentityCandidate(candidate, criteria);
    expect(first).toEqual(second);
    expect(first.score).toBe(94);
    expect(candidate.confidence).toBe(0.9);
  });
});
