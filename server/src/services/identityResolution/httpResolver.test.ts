import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpIdentityResolver } from "./httpResolver.js";

const resolver = new HttpIdentityResolver({
  provider: "customers_ai",
  mode: "consumer",
  apiKeyEnv: "TEST_PROVIDER_API_KEY",
  resolveUrlEnv: "TEST_PROVIDER_RESOLVE_URL",
  healthUrlEnv: "TEST_PROVIDER_HEALTH_URL",
  deleteUrlEnv: "TEST_PROVIDER_DELETE_URL",
  webhookSecretEnv: "TEST_PROVIDER_WEBHOOK_SECRET",
});

describe("HTTP identity resolver deletion", () => {
  beforeEach(() => {
    process.env.TEST_PROVIDER_API_KEY = "test-key";
    process.env.TEST_PROVIDER_DELETE_URL = "https://provider.example/delete";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const name of [
      "TEST_PROVIDER_API_KEY",
      "TEST_PROVIDER_RESOLVE_URL",
      "TEST_PROVIDER_HEALTH_URL",
      "TEST_PROVIDER_DELETE_URL",
      "TEST_PROVIDER_WEBHOOK_SECRET",
    ]) {
      delete process.env[name];
    }
  });

  it("sends only the provider subject to the configured deletion endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await resolver.deleteSubject("provider-subject-1");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://provider.example/delete",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: "Bearer test-key", "content-type": "application/json" },
        body: JSON.stringify({ subject_id: "provider-subject-1" }),
      })
    );
  });

  it("fails health checks when provider deletion is not configured", async () => {
    delete process.env.TEST_PROVIDER_DELETE_URL;
    process.env.TEST_PROVIDER_WEBHOOK_SECRET = "webhook-secret";

    await expect(resolver.healthCheck()).resolves.toEqual({
      ok: false,
      detail: "Deletion endpoint is not configured",
    });
  });

  it("supports a signed-webhook connection without a server resolve URL", async () => {
    process.env.TEST_PROVIDER_WEBHOOK_SECRET = "webhook-secret";

    await expect(resolver.healthCheck()).resolves.toEqual({
      ok: true,
      detail: "Configured for signed-webhook transport",
    });
  });
});
