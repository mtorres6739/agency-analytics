import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redisSet: vi.fn(),
  getConfig: vi.fn(),
  verifyCorrelationToken: vi.fn(),
  normalizeProviderResponse: vi.fn(),
  ingestWebhookCandidates: vi.fn(),
  consentRows: [] as Array<{ id: string }>,
}));

vi.mock("../../db/redis/redis.js", () => ({ redis: { set: mocks.redisSet } }));
vi.mock("../../lib/siteConfig.js", () => ({ siteConfig: { getConfig: mocks.getConfig } }));
vi.mock("../../services/identity/identityCrypto.js", () => ({
  verifyCorrelationToken: mocks.verifyCorrelationToken,
}));
vi.mock("../../services/identityResolution/providerPayload.js", () => ({
  normalizeProviderResponse: mocks.normalizeProviderResponse,
}));
vi.mock("../../services/identityResolution/resolutionService.js", () => ({
  identityResolutionService: { ingestWebhookCandidates: mocks.ingestWebhookCandidates },
}));
vi.mock("../../db/postgres/postgres.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => mocks.consentRows) })),
      })),
    })),
  },
}));

import { handleIdentityProviderWebhook } from "./providerWebhook.js";

function signedRequest(body: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = createHmac("sha256", "webhook-test-secret").update(timestamp).update(".").update(rawBody).digest("hex");
  return {
    params: { provider: "customers_ai" },
    headers: { "x-identity-timestamp": timestamp, "x-identity-signature": signature },
    body,
    rawBody,
    ...overrides,
  } as any;
}

function replyStub() {
  return {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      this.payload = payload;
      return payload;
    },
  } as any;
}

const payload = {
  event_id: "evt_1",
  site_id: "site_public",
  correlation_token: "correlation",
  result: { candidates: [] },
};

describe("identity provider webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CUSTOMERS_AI_WEBHOOK_SECRET = "webhook-test-secret";
    mocks.redisSet.mockResolvedValue("OK");
    mocks.getConfig.mockResolvedValue({ siteId: 7 });
    mocks.verifyCorrelationToken.mockReturnValue({ anonymousSubject: "anon_1", receiptId: "receipt_1" });
    mocks.normalizeProviderResponse.mockReturnValue({ requestId: "request_1", candidates: [] });
    mocks.ingestWebhookCandidates.mockResolvedValue({ accepted: true, count: 0 });
    mocks.consentRows = [{ id: "receipt_1" }];
  });

  it("rejects a forged signature before replay or provider processing", async () => {
    const request = signedRequest(payload);
    request.headers["x-identity-signature"] = "00";
    const reply = replyStub();
    await handleIdentityProviderWebhook(request, reply);
    expect(reply.statusCode).toBe(401);
    expect(mocks.redisSet).not.toHaveBeenCalled();
    expect(mocks.ingestWebhookCandidates).not.toHaveBeenCalled();
  });

  it("validates consent and site binding before accepting a signed delivery", async () => {
    const reply = replyStub();
    await handleIdentityProviderWebhook(signedRequest(payload), reply);
    expect(reply.statusCode).toBe(202);
    expect(mocks.verifyCorrelationToken).toHaveBeenCalledWith({
      token: "correlation",
      expectedSitePublicId: "site_public",
    });
    expect(mocks.ingestWebhookCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 7, sitePublicId: "site_public", anonymousSubject: "anon_1" })
    );
  });

  it("acknowledges duplicate signed events idempotently", async () => {
    mocks.redisSet.mockResolvedValue(null);
    const reply = replyStub();
    await handleIdentityProviderWebhook(signedRequest(payload), reply);
    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toEqual({ success: true, idempotent: true });
    expect(mocks.ingestWebhookCandidates).not.toHaveBeenCalled();
  });

  it("fails closed when replay protection is unavailable", async () => {
    mocks.redisSet.mockRejectedValue(new Error("redis down"));
    const reply = replyStub();
    await handleIdentityProviderWebhook(signedRequest(payload), reply);
    expect(reply.statusCode).toBe(503);
    expect(mocks.ingestWebhookCandidates).not.toHaveBeenCalled();
  });
});
