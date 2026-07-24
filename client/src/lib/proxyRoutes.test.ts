import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 22's strip-types loader intentionally imports the TypeScript source directly.
import { getCanonicalSitePath } from "./proxyRoutes.ts";

test("keeps authentication and agency routes out of site routing", () => {
  for (const route of ["/login", "/two-factor", "/portfolio", "/clients", "/reports", "/providers", "/settings"]) {
    assert.equal(getCanonicalSitePath(route), null, `${route} must remain a first-class application route`);
  }
});

test("canonicalizes only a single-segment site route", () => {
  assert.equal(getCanonicalSitePath("/123"), "/123/main");
  assert.equal(getCanonicalSitePath("/example-site"), "/example-site/main");
  assert.equal(getCanonicalSitePath("/123/main"), null);
});
