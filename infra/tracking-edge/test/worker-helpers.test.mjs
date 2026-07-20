import assert from "node:assert/strict";
import test from "node:test";

import { buildWorker, validateManifest } from "../scripts/lib.mjs";

const manifest = validateManifest({
  version: 1,
  analyticsOrigin: "https://analytics.myfusionadmin.com",
  pathPrefix: "/__bold-analytics",
  sites: [{ hostname: "www.example.com", siteId: 42 }],
});
const source = await buildWorker(manifest);
const worker = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("worker excludes private and application paths", () => {
  assert.equal(worker.isExcludedPath("/wp-admin"), true);
  assert.equal(worker.isExcludedPath("/wp-admin/edit.php"), true);
  assert.equal(worker.isExcludedPath("/_next/static/app.js"), true);
  assert.equal(worker.isExcludedPath("/services"), false);
});

test("worker detects HTML and nonce-based content security policies", () => {
  assert.equal(worker.isHtmlResponse(new Response("", { headers: { "content-type": "text/html; charset=utf-8" } })), true);
  assert.equal(worker.isHtmlResponse(new Response("", { headers: { "content-type": "application/json" } })), false);
  assert.equal(
    worker.needsNonce(new Response("", { headers: { "content-security-policy": "script-src 'nonce-abc123' 'self'" } })),
    true
  );
  assert.equal(worker.needsNonce(new Response("", { headers: { "content-security-policy": "script-src 'self'" } })), false);
});

test("worker proxies the reserved same-origin path to the analytics API", async () => {
  const originalFetch = globalThis.fetch;
  let upstream;
  globalThis.fetch = async request => {
    upstream = request;
    return new Response("tracker", { status: 200, headers: { "content-type": "application/javascript" } });
  };
  try {
    const response = await worker.default.fetch(
      new Request("https://www.example.com/__bold-analytics/script.js?cache=1")
    );
    assert.equal(upstream.url, "https://analytics.myfusionadmin.com/api/script.js?cache=1");
    assert.equal(response.headers.get("x-bold-analytics-proxy"), "1");
    assert.equal(await response.text(), "tracker");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("worker leaves unconfigured hostnames untouched", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("origin");
  };
  try {
    const response = await worker.default.fetch(new Request("https://other.example.com/"));
    assert.equal(calls, 1);
    assert.equal(await response.text(), "origin");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
