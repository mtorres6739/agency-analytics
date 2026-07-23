import { describe, expect, it } from "vitest";
import { ProviderResponseError } from "./types.js";
import { normalizeProviderResponse } from "./providerPayload.js";

describe("provider payload normalization", () => {
  it("normalizes only approved fields and records provenance", () => {
    const result = normalizeProviderResponse("customers_ai", {
      request_id: "req_1",
      candidates: [
        {
          id: "provider-person-1",
          confidence: 0.96,
          match_method: "deterministic",
          traits: { name: "Jane Doe", email: "JANE@EXAMPLE.COM", company: "Example Inc" },
        },
      ],
    });
    expect(result.requestId).toBe("req_1");
    expect(result.candidates[0].traits.email).toBe("jane@example.com");
    expect(result.candidates[0].provenance.map(item => item.field)).toEqual(["name", "email", "company"]);
  });

  it("rejects phone, birth date, home address, and unknown provider fields", () => {
    expect(() =>
      normalizeProviderResponse("rb2b", {
        id: "person-1",
        confidence: 1,
        match_method: "deterministic",
        traits: { email: "jane@example.com", phone: "555-0100", birthday: "1990-01-01" },
      })
    ).toThrow(ProviderResponseError);
  });
});
