import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  transaction: vi.fn(),
  persistIdentifiedUser: vi.fn(),
  backfillIdentifiedUserId: vi.fn(),
  sendCandidateToGhl: vi.fn(),
  queueProviderDeletions: vi.fn(),
}));

vi.mock("../../db/postgres/postgres.js", () => ({
  db: {
    select: vi.fn(() => {
      const rows = mocks.selectRows.shift() ?? [];
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => rows),
          })),
        })),
      };
    }),
    transaction: mocks.transaction,
    insert: vi.fn(),
  },
}));
vi.mock("../../services/tracker/identifyService.js", () => ({
  persistIdentifiedUser: mocks.persistIdentifiedUser,
  backfillIdentifiedUserId: mocks.backfillIdentifiedUserId,
}));
vi.mock("../../services/identityResolution/ghlActivation.js", () => ({
  sendCandidateToGhl: mocks.sendCandidateToGhl,
}));
vi.mock("../../services/identityResolution/resolutionService.js", () => ({
  identityResolutionService: {
    queueProviderDeletions: mocks.queueProviderDeletions,
  },
}));

import { approveIdentityCandidate, suppressIdentityCandidate } from "./resolutionIdentity.js";

const site = {
  siteId: 7,
  id: "site_public",
  organizationId: "org_1",
  domain: "example.com",
};
const candidate = {
  id: "f3a89dc2-d421-4cf8-b798-4b7cb2d0d090",
  siteId: 7,
  anonymousSubject: "anon_1",
  provider: "customers_ai",
  providerSubjectKey: "provider_key",
  providerSubjectRef: "encrypted",
  reviewStatus: "pending",
  traits: { name: "Jane Doe", email: "jane@example.com" },
};

function request(body: Record<string, unknown> = {}) {
  return {
    params: { siteId: "7", candidateId: candidate.id },
    body,
    user: { id: "reviewer_1" },
  } as any;
}

function replyStub() {
  return {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send: vi.fn(),
  } as any;
}

describe("identity candidate review transaction ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectRows = [[site], [candidate]];
    mocks.transaction.mockRejectedValue(new Error("commit failed"));
  });

  it("does not contact GHL when the approval transaction fails", async () => {
    await expect(approveIdentityCandidate(request({ sendToCrm: true }), replyStub())).rejects.toThrow("commit failed");
    expect(mocks.sendCandidateToGhl).not.toHaveBeenCalled();
    expect(mocks.backfillIdentifiedUserId).not.toHaveBeenCalled();
  });

  it("does not queue provider deletion when the suppression transaction fails", async () => {
    await expect(suppressIdentityCandidate(request(), replyStub())).rejects.toThrow("commit failed");
    expect(mocks.queueProviderDeletions).not.toHaveBeenCalled();
  });
});
