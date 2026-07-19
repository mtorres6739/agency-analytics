import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  removeSite: vi.fn(),
}));

vi.mock("../../db/clickhouse/clickhouse.js", () => ({
  clickhouse: { command: mocks.command },
}));

vi.mock("../../lib/siteConfig.js", () => ({
  siteConfig: { removeSite: mocks.removeSite },
}));

import { deleteSite } from "./deleteSite.js";

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.command.mockResolvedValue(undefined);
  mocks.removeSite.mockResolvedValue(undefined);
});

describe("deleteSite", () => {
  it("deletes raw and aggregate analytics before removing site configuration", async () => {
    const reply = replyStub();
    await deleteSite({ params: { siteId: "42" }, log: { error: vi.fn() } } as any, reply);

    expect(mocks.command).toHaveBeenCalledTimes(11);
    expect(mocks.command).toHaveBeenCalledWith({
      query: "ALTER TABLE IF EXISTS events DELETE WHERE site_id = {siteId:UInt32}",
      query_params: { siteId: 42 },
      clickhouse_settings: { mutations_sync: "2" },
    });
    expect(mocks.command).toHaveBeenCalledWith({
      query: "ALTER TABLE IF EXISTS bot_events DELETE WHERE site_id = {siteId:UInt32}",
      query_params: { siteId: 42 },
      clickhouse_settings: { mutations_sync: "2" },
    });
    expect(mocks.removeSite).toHaveBeenCalledWith(42);
    expect(reply.body).toEqual({ success: true });
  });

  it("does not claim success if analytics deletion fails", async () => {
    mocks.command.mockRejectedValueOnce(new Error("clickhouse unavailable"));
    const reply = replyStub();
    await deleteSite({ params: { siteId: "42" }, log: { error: vi.fn() } } as any, reply);

    expect(reply.statusCode).toBe(500);
    expect(reply.body).toEqual({ error: "Failed to delete site" });
    expect(mocks.removeSite).not.toHaveBeenCalled();
  });
});
