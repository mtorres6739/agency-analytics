import assert from "node:assert/strict";
import test from "node:test";

import { buildWorker, normalizeHostname, routePatternCoversHostname, validateManifest } from "../scripts/lib.mjs";

const VALID_MANIFEST = {
  version: 1,
  analyticsOrigin: "https://analytics.myfusionadmin.com",
  pathPrefix: "/__bold-analytics",
  sites: [{ hostname: "WWW.Example.com", siteId: 42, enabled: true }],
};

test("normalizes and validates explicit site mappings", () => {
  const manifest = validateManifest(VALID_MANIFEST);
  assert.equal(manifest.sites[0].hostname, "www.example.com");
  assert.equal(manifest.sites[0].siteId, 42);
});

test("rejects duplicate hosts and unsafe analytics recursion", () => {
  assert.throws(
    () => validateManifest({ ...VALID_MANIFEST, sites: [...VALID_MANIFEST.sites, ...VALID_MANIFEST.sites] }),
    /Duplicate hostname/
  );
  assert.throws(
    () => validateManifest({ ...VALID_MANIFEST, sites: [{ hostname: "analytics.myfusionadmin.com", siteId: 1 }] }),
    /cannot route through its own/
  );
});

test("rejects URLs, IPs, invalid IDs, and short proxy paths", () => {
  assert.throws(() => normalizeHostname("https://example.com"), /Invalid hostname/);
  assert.throws(() => normalizeHostname("127.0.0.1"), /IP addresses/);
  assert.throws(() => validateManifest({ ...VALID_MANIFEST, pathPrefix: "/track" }), /at least eight/);
  assert.throws(
    () => validateManifest({ ...VALID_MANIFEST, sites: [{ hostname: "example.com", siteId: 0 }] }),
    /Invalid siteId/
  );
});

test("builds a Worker with no unresolved configuration placeholders", async () => {
  const source = await buildWorker(validateManifest(VALID_MANIFEST));
  assert.match(source, /"www\.example\.com":42/);
  assert.match(source, /https:\/\/analytics\.myfusionadmin\.com/);
  assert.doesNotMatch(source, /__[A-Z_]+__/);
});

test("detects inherited all-path Worker routes without blocking path-specific routes", () => {
  assert.equal(routePatternCoversHostname("*.example.com/*", "www.example.com"), true);
  assert.equal(routePatternCoversHostname("*example.com/*", "www.example.com"), true);
  assert.equal(routePatternCoversHostname("https://www.example.com/*", "www.example.com"), true);
  assert.equal(routePatternCoversHostname("www.example.com/api/*", "www.example.com"), false);
  assert.equal(routePatternCoversHostname("other.example.com/*", "www.example.com"), false);
});
