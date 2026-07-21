import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  selectLimit: vi.fn(),
  backfill: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("../../../db/postgres/postgres.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => ({ limit: mocks.selectLimit })),
        })),
      })),
    })),
    insert: mocks.insert,
  },
}));

vi.mock("../../../services/tracker/identifyService.js", () => ({
  backfillIdentifiedUserId: mocks.backfill,
}));

vi.mock("../../../services/identity/identityAuditService.js", () => ({
  auditSiteIdentityEvent: mocks.audit,
}));

import { identifyUser } from "./identifyUser.js";

function request() {
  return {
    params: { siteId: "1" },
    body: {
      anonymous_id: "anonymous-device",
      user_id: "opaque-user-id",
      traits: { name: "Test User", email: "test@example.com" },
    },
    user: { id: "agency-user" },
  } as any;
}

function replyStub() {
  const reply: any = { statusCode: 200 };
  reply.status = vi.fn((code: number) => {
    reply.statusCode = code;
    return reply;
  });
  reply.send = vi.fn((body: unknown) => {
    reply.body = body;
    return reply;
  });
  return reply;
}

describe("manual user identification policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects manual identification for a compliance-blocked site", async () => {
    mocks.selectLimit.mockResolvedValue([{ domain: "neuron-connect.com", identityEnabled: true }]);
    const reply = replyStub();

    await identifyUser(request(), reply);

    expect(reply.statusCode).toBe(423);
    expect(reply.body).toEqual({
      error: "Medical compliance approval is required before identity can be enabled",
      code: "COMPLIANCE_BLOCKED",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.backfill).not.toHaveBeenCalled();
  });

  it("rejects manual identification when the site kill switch is off", async () => {
    mocks.selectLimit.mockResolvedValue([{ domain: "palmsquad.com", identityEnabled: false }]);
    const reply = replyStub();

    await identifyUser(request(), reply);

    expect(reply.statusCode).toBe(409);
    expect(reply.body).toEqual({
      error: "Identity is disabled for this site",
      code: "IDENTITY_DISABLED",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.backfill).not.toHaveBeenCalled();
  });
});
