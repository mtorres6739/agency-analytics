import { describe, expect, it } from "vitest";
import { buildInstrumentation, supportsClientInstrumentation } from "./vercelProvider.js";

describe("Vercel tracking source", () => {
  it("requires the Next.js client instrumentation lifecycle", () => {
    expect(supportsClientInstrumentation("^15.2.4")).toBe(false);
    expect(supportsClientInstrumentation("15.3.0")).toBe(true);
    expect(supportsClientInstrumentation("^16.0.1")).toBe(true);
  });

  it("generates an idempotent public tracker without credentials", () => {
    const source = buildInstrumentation("https://analytics.example.com", 42);
    expect(source).toContain('script.src = "https://analytics.example.com/api/script.js"');
    expect(source).toContain('script.setAttribute("data-site-id", "42")');
    expect(source).toContain('data-agency-analytics="managed"');
    expect(source).not.toMatch(/token|password|secret/i);
  });
});
