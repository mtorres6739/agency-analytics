import { describe, expect, it } from "vitest";
import { buildInstrumentation, hasManagedInstrumentation, supportsClientInstrumentation } from "./vercelProvider.js";

describe("Vercel tracking source", () => {
  it("requires the Next.js client instrumentation lifecycle", () => {
    expect(supportsClientInstrumentation("^15.2.4")).toBe(false);
    expect(supportsClientInstrumentation("15.3.0")).toBe(true);
    expect(supportsClientInstrumentation("^16.0.1")).toBe(true);
  });

  it("generates an idempotent public tracker without credentials", () => {
    const source = buildInstrumentation("https://analytics.example.com", "public-42");
    expect(source).toContain('script.src = "https://analytics.example.com/api/script.js"');
    expect(source).toContain('script.setAttribute("data-site-id", "public-42")');
    expect(source).toContain('data-agency-analytics="managed"');
    expect(source).not.toMatch(/token|password|secret/i);
  });

  it("recognizes an existing managed tracker with equivalent source formatting", () => {
    const source = `const TRACKER_URL = "https://analytics.example.com/api/script.js";\nconst SITE_ID = "public-42";\nconst tracker = document.createElement("script");\ntracker.src = TRACKER_URL;\ntracker.dataset.siteId = SITE_ID;\ntracker.dataset.agencyAnalytics = "managed";`;
    expect(hasManagedInstrumentation(source, "https://analytics.example.com", "public-42")).toBe(true);
    expect(hasManagedInstrumentation(source, "https://analytics.example.com", "another-site")).toBe(false);
  });
});
