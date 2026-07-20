import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInstrumentation,
  cspAllowsOrigin,
  encodePath,
  parseNextMajor,
  supportsClientInstrumentation,
  trackerCspCompatible,
  validateManifest,
} from "../scripts/lib.mjs";

test("validates an explicit Vercel project mapping", () => {
  const manifest = validateManifest({
    version: 1,
    analyticsOrigin: "https://analytics.myfusionadmin.com",
    sites: [{ hostname: "Example.com", siteId: 12, vercelProject: "example-site" }],
  });
  assert.equal(manifest.sites[0].hostname, "example.com");
  assert.equal(manifest.sites[0].vercelProject, "example-site");
});

test("rejects duplicates and invalid mappings", () => {
  const site = { hostname: "example.com", siteId: 12, vercelProject: "example-site" };
  assert.throws(
    () => validateManifest({ version: 1, analyticsOrigin: "https://analytics.myfusionadmin.com", sites: [site, site] }),
    /Duplicate hostname/
  );
  assert.throws(
    () =>
      validateManifest({
        version: 1,
        analyticsOrigin: "https://analytics.myfusionadmin.com",
        sites: [{ ...site, siteId: 0 }],
      }),
    /Invalid siteId/
  );
});

test("recognizes Next.js client instrumentation support", () => {
  assert.deepEqual(parseNextMajor("^15.3.2"), { major: 15, minor: 3 });
  assert.equal(supportsClientInstrumentation("15.2.9"), false);
  assert.equal(supportsClientInstrumentation("^15.3.0"), true);
  assert.equal(supportsClientInstrumentation("16.1.0"), true);
  assert.equal(supportsClientInstrumentation("workspace:*"), false);
});

test("builds deterministic idempotent browser instrumentation", () => {
  const result = buildInstrumentation({ analyticsOrigin: "https://analytics.myfusionadmin.com", siteId: 88 });
  assert.match(result, /data-agency-analytics/);
  assert.match(result, /data-site-id", "88"/);
  assert.match(result, /https:\/\/analytics\.myfusionadmin\.com\/api\/script\.js/);
});

test("checks both script and connection CSP directives", () => {
  const origin = "https://analytics.myfusionadmin.com";
  assert.equal(cspAllowsOrigin("default-src 'self'; script-src 'self' https://analytics.myfusionadmin.com", "script-src", origin), true);
  assert.equal(trackerCspCompatible("script-src 'self'; connect-src 'self'", origin), false);
  assert.equal(trackerCspCompatible("script-src https:; connect-src https:", origin), true);
  assert.equal(trackerCspCompatible(null, origin), true);
});

test("encodes GitHub path segments without losing slashes", () => {
  assert.equal(encodePath("apps/site/src file.ts"), "apps/site/src%20file.ts");
});
