import { describe, expect, it, vi } from "vitest";
import { CloudflareTrackingProvider } from "./cloudflareProvider.js";

function json(result: unknown) {
  return new Response(JSON.stringify({ success: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function provider(fetchImpl: typeof fetch) {
  return new CloudflareTrackingProvider(
    {
      token: "test-token",
      accountId: "account-1",
      analyticsOrigin: "https://analytics.example.com",
      pathPrefix: "/__agency-analytics",
      workerPrefix: "agency-analytics-tracker",
    },
    fetchImpl
  );
}

describe("CloudflareTrackingProvider", () => {
  it("plans, installs, verifies, and rolls back only its site-scoped route", async () => {
    let installed = false;
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/zones?name=www.example.com")) return json([]);
      if (url.includes("/zones?name=example.com")) return json([{ id: "zone-1", name: "example.com" }]);
      if (url.includes("/dns_records?")) return json([{ type: "A", proxied: true }]);
      if (url.endsWith("/workers/routes") && init?.method === "POST") {
        installed = true;
        return json({ id: "route-1" });
      }
      if (url.endsWith("/workers/routes")) {
        return json(
          installed ? [{ id: "route-1", pattern: "www.example.com/*", script: "agency-analytics-tracker-42" }] : []
        );
      }
      if (url.includes("/workers/scripts/agency-analytics-tracker-42")) return json({});
      if (url.endsWith("/workers/routes/route-1") && init?.method === "DELETE") {
        installed = false;
        return json({});
      }
      if (url === "https://www.example.com/") {
        return new Response(
          installed
            ? '<html><head><script src="/__agency-analytics/script.js" data-site-id="public-42"></script></head></html>'
            : "<html><head></head></html>",
          { status: 200, headers: { "content-type": "text/html" } }
        );
      }
      if (url === "https://www.example.com/__agency-analytics/script.js") {
        return new Response("script", {
          status: installed ? 200 : 404,
          headers: installed ? { "x-agency-analytics-proxy": "1" } : {},
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;
    const tracking = provider(fetchImpl);
    const site = { hostname: "www.example.com", siteId: 42, trackingId: "public-42" };

    await expect(tracking.plan(site)).resolves.toMatchObject({
      provider: "cloudflare",
      blocked: false,
      installed: false,
    });
    await expect(tracking.apply(site)).resolves.toMatchObject({
      installed: true,
      verification: { injected: true, proxied: true },
    });
    await expect(tracking.rollback(site)).resolves.toMatchObject({ installed: false, blocked: false });
  });

  it("blocks an inherited Worker route without changing it", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("/zones?name=www.example.com")) return json([]);
      if (url.includes("/zones?name=example.com")) return json([{ id: "zone-1", name: "example.com" }]);
      if (url.includes("/dns_records?")) return json([{ type: "CNAME", proxied: true }]);
      if (url.endsWith("/workers/routes")) {
        return json([{ id: "existing", pattern: "*.example.com/*", script: "existing-worker" }]);
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    await expect(
      provider(fetchImpl).plan({ hostname: "www.example.com", siteId: 42, trackingId: "public-42" })
    ).resolves.toMatchObject({
      blocked: true,
      reason: expect.stringContaining("existing Worker route"),
    });
  });
});
