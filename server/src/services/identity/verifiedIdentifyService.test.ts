import type { FastifyReply, FastifyRequest } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createIdentityAssertion } from "./identityCrypto.js";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getVerificationSecrets: vi.fn(),
  generateUserId: vi.fn(),
  markResult: vi.fn(),
  persist: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  resolveClientIp: vi.fn(),
  touchKey: vi.fn(),
}));

vi.mock("../../lib/siteConfig.js", () => ({ siteConfig: { getConfig: mocks.getConfig } }));
vi.mock("../../db/redis/redis.js", () => ({
  redis: { get: mocks.redisGet, set: mocks.redisSet },
}));
vi.mock("../userId/userIdService.js", () => ({
  userIdService: { generateUserId: mocks.generateUserId },
}));
vi.mock("../tracker/resolveClientIp.js", () => ({ resolveClientIp: mocks.resolveClientIp }));
vi.mock("../tracker/identifyService.js", () => ({ persistIdentifiedUser: mocks.persist }));
vi.mock("./identitySettingsService.js", () => ({
  getIdentityVerificationSecrets: mocks.getVerificationSecrets,
  markIdentityResult: mocks.markResult,
  touchIdentityKey: mocks.touchKey,
}));

import { handleVerifiedIdentify } from "./verifiedIdentifyService.js";

const secret = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function replyStub() {
  const reply = {
    status: vi.fn(function (this: typeof reply) {
      return this;
    }),
    send: vi.fn(function (this: typeof reply) {
      return this;
    }),
  };
  return reply as unknown as FastifyReply;
}

function request(assertion: string) {
  return {
    body: { site_id: "site_public", assertion },
    headers: { "user-agent": "test-browser" },
  } as unknown as FastifyRequest;
}

describe("verified identity endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfig.mockResolvedValue({ siteId: 42 });
    mocks.getVerificationSecrets.mockResolvedValue({
      settings: { allowedTraits: ["name", "email"] },
      keys: [{ key: { id: "key_1" }, secret }],
    });
    mocks.resolveClientIp.mockReturnValue("198.51.100.20");
    mocks.generateUserId.mockResolvedValue("anonymous_1");
    mocks.redisSet.mockResolvedValue("OK");
    mocks.persist.mockResolvedValue(undefined);
    mocks.markResult.mockResolvedValue(undefined);
    mocks.touchKey.mockResolvedValue(undefined);
  });

  it("persists only allowlisted traits after signature verification", async () => {
    const assertion = createIdentityAssertion({
      secret,
      sitePublicId: "site_public",
      source: "ghl",
      externalId: "contact_1",
      traits: { name: "Jane Doe", email: "jane@example.com", company: "Excluded Co" },
    });
    const reply = replyStub();

    await handleVerifiedIdentify(request(assertion), reply);

    expect(mocks.persist).toHaveBeenCalledWith({
      siteId: 42,
      anonymousId: "anonymous_1",
      userId: expect.stringMatching(/^id_/),
      traits: { name: "Jane Doe", email: "jane@example.com" },
      identitySource: "verified",
    });
    expect(reply.send).toHaveBeenCalledWith({ success: true, user_id: expect.stringMatching(/^id_/) });
  });

  it("rejects replay by a different anonymous visitor", async () => {
    const assertion = createIdentityAssertion({
      secret,
      sitePublicId: "site_public",
      source: "ghl",
      externalId: "contact_2",
      traits: { name: "John Doe" },
    });
    mocks.redisSet.mockResolvedValue(null);
    mocks.redisGet.mockResolvedValue("anonymous_other");
    const reply = replyStub();

    await handleVerifiedIdentify(request(assertion), reply);

    expect(reply.status).toHaveBeenCalledWith(409);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: "ASSERTION_REPLAYED" }));
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("repeats the idempotent persistence step for a retry from the same visitor", async () => {
    const assertion = createIdentityAssertion({
      secret,
      sitePublicId: "site_public",
      source: "ghl",
      externalId: "contact_retry",
      traits: { name: "Retry User", email: "retry@example.com" },
    });
    mocks.redisSet.mockResolvedValue(null);
    mocks.redisGet.mockResolvedValue("anonymous_1");
    const reply = replyStub();

    await handleVerifiedIdentify(request(assertion), reply);

    expect(mocks.persist).toHaveBeenCalledOnce();
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      user_id: expect.stringMatching(/^id_/),
      idempotent: true,
    });
  });

  it("fails closed when the replay store is unavailable", async () => {
    const assertion = createIdentityAssertion({
      secret,
      sitePublicId: "site_public",
      source: "ghl",
      externalId: "contact_3",
      traits: { name: "Jamie Doe" },
    });
    mocks.redisSet.mockRejectedValue(new Error("redis unavailable"));
    const reply = replyStub();

    await handleVerifiedIdentify(request(assertion), reply);

    expect(reply.status).toHaveBeenCalledWith(503);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});
