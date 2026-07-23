import fastifyRawBody from "fastify-raw-body";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerAuthContentTypeParsers } from "./authContentTypeParsers.js";

describe("registerAuthContentTypeParsers", () => {
  const servers: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => server.close()));
  });

  it("coexists with exact raw-body parsing and keeps auth payloads unparsed", async () => {
    const server = Fastify();
    servers.push(server);

    await server.register(fastifyRawBody, {
      field: "rawBody",
      global: false,
      encoding: false,
      runFirst: true,
    });

    await server.register(async authScope => {
      registerAuthContentTypeParsers(authScope);
      authScope.post("/auth-test", request => ({ body: request.body }));
    });

    server.post("/webhook-test", { config: { rawBody: true } }, request => ({
      parsed: request.body,
      rawIsBuffer: Buffer.isBuffer(request.rawBody),
      raw: Buffer.isBuffer(request.rawBody) ? request.rawBody.toString("utf8") : null,
    }));

    await server.ready();

    const authResponse = await server.inject({
      method: "POST",
      url: "/auth-test",
      headers: { "content-type": "application/json" },
      payload: '{"email":"person@example.com"}',
    });
    expect(authResponse.statusCode).toBe(200);
    expect(authResponse.json()).toEqual({ body: null });

    const webhookResponse = await server.inject({
      method: "POST",
      url: "/webhook-test",
      headers: { "content-type": "application/json" },
      payload: '{"event_id":"evt_1"}',
    });
    expect(webhookResponse.statusCode).toBe(200);
    expect(webhookResponse.json()).toEqual({
      parsed: { event_id: "evt_1" },
      rawIsBuffer: true,
      raw: '{"event_id":"evt_1"}',
    });
  });
});
