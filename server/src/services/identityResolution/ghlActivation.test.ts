import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendCandidateToGhl } from "./ghlActivation.js";

const candidate = {
  siteId: 7,
  traits: {
    name: "Jane Doe",
    email: "jane@example.com",
    company: "Example Inc",
  },
};

describe("GoHighLevel candidate activation", () => {
  beforeEach(() => {
    process.env.GHL_SITE_7_ACCESS_TOKEN = "test-token";
    process.env.GHL_SITE_7_LOCATION_ID = "location-7";
  });

  afterEach(() => {
    delete process.env.GHL_SITE_7_ACCESS_TOKEN;
    delete process.env.GHL_SITE_7_LOCATION_ID;
    vi.unstubAllGlobals();
  });

  it("returns a failed result when the request rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    await expect(sendCandidateToGhl(candidate)).resolves.toEqual({
      status: "failed",
      contactId: null,
    });
  });

  it("returns a failed result when the provider response is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(new SyntaxError("invalid JSON")),
      })
    );
    await expect(sendCandidateToGhl(candidate)).resolves.toEqual({
      status: "failed",
      contactId: null,
    });
  });

  it("returns the created contact ID for a valid response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ contact: { id: "contact-7" } }),
      })
    );
    await expect(sendCandidateToGhl(candidate)).resolves.toEqual({
      status: "sent",
      contactId: "contact-7",
    });
  });
});
