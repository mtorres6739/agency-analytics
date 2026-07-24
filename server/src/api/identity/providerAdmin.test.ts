import type { FastifyReply, FastifyRequest } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAgencyPrincipal, select } = vi.hoisted(() => ({
  getAgencyPrincipal: vi.fn(),
  select: vi.fn(),
}));

vi.mock("../agency/access.js", () => ({ getAgencyPrincipal }));
vi.mock("../../db/postgres/postgres.js", () => ({
  db: {
    select,
  },
}));

import { listIdentityProviderConnections } from "./providerAdmin.js";

function replyStub() {
  const reply = {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
  return reply as typeof reply & FastifyReply;
}

describe("listIdentityProviderConnections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-administrators before reading provider account metadata", async () => {
    getAgencyPrincipal.mockResolvedValue({
      userId: "user-1",
      organizationId: "org-1",
      role: "member",
      canManage: false,
    });
    const reply = replyStub();

    await listIdentityProviderConnections(
      { params: { organizationId: "org-1" } } as FastifyRequest<{ Params: { organizationId: string } }>,
      reply
    );

    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toEqual({ error: "Organization administrator access is required" });
    expect(select).not.toHaveBeenCalled();
  });
});
