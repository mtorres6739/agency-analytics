import { describe, expect, it } from "vitest";
import {
  buildAppLayoutInstrumentation,
  buildInstrumentation,
  buildNextConfigCspAllowance,
  buildStaticHtmlInstrumentation,
  buildVercelJsonCspAllowance,
  hasManagedInstrumentation,
  supportsClientInstrumentation,
} from "./vercelProvider.js";

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

  it("injects an idempotent tracker into older Next.js App Router layouts", () => {
    const layout = `import type { Metadata } from 'next';\n\nexport default function Layout({ children }) {\n  return <html><body className="app">{children}</body></html>;\n}\n`;
    const source = buildAppLayoutInstrumentation(layout, "https://analytics.example.com", "public-42");

    expect(source).toContain("import Script from 'next/script';");
    expect(source).toContain("src='https://analytics.example.com/api/script.js'");
    expect(source).toContain("data-site-id='public-42'");
    expect(source).toContain("data-agency-analytics='managed'");
    expect(buildAppLayoutInstrumentation(source, "https://analytics.example.com", "public-42")).toBe(source);
  });

  it("refuses to replace a different managed tracker in an app layout", () => {
    const layout = `<html><body><Script data-agency-analytics="managed" data-site-id="other" /></body></html>`;
    expect(() => buildAppLayoutInstrumentation(layout, "https://analytics.example.com", "public-42")).toThrow(
      "different managed analytics tracker"
    );
  });

  it("adds the analytics origin to restrictive Next.js CSP directives", () => {
    const config = `const CSP = [\n  "default-src 'self'",\n  "script-src 'self' 'unsafe-inline'",\n  "connect-src 'self'",\n].join('; ');\n`;
    const source = buildNextConfigCspAllowance(config, "https://analytics.example.com");

    expect(source).toContain(`script-src 'self' 'unsafe-inline' https://analytics.example.com`);
    expect(source).toContain(`connect-src 'self' https://analytics.example.com`);
    expect(buildNextConfigCspAllowance(source, "https://analytics.example.com")).toBe(source);
  });

  it("adds the analytics origin to every Vercel CSP without broadening other sources", () => {
    const config = `{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self' https://js.stripe.com; connect-src 'self' https://api.stripe.com; object-src 'none'" }
      ]
    },
    {
      "source": "/private/(.*)",
      "headers": [
        { "key": "content-security-policy", "value": "default-src 'self'; object-src 'none'" }
      ]
    }
  ]
}\n`;
    const source = buildVercelJsonCspAllowance(config, "https://analytics.example.com");
    const parsed = JSON.parse(source);
    const policies = parsed.headers.map((rule: any) => rule.headers[0].value);

    expect(policies[0]).toContain("script-src 'self' https://js.stripe.com https://analytics.example.com");
    expect(policies[0]).toContain("connect-src 'self' https://api.stripe.com https://analytics.example.com");
    expect(policies[0]).toContain("object-src 'none'");
    expect(policies[0]).not.toContain("*");
    expect(policies[1]).toContain("script-src 'self' https://analytics.example.com");
    expect(policies[1]).toContain("connect-src 'self' https://analytics.example.com");
    expect(buildVercelJsonCspAllowance(source, "https://analytics.example.com")).toBe(source);
  });

  it("leaves Vercel configuration without a CSP unchanged", () => {
    const config = `{"framework":"vite","headers":[]}\n`;
    expect(buildVercelJsonCspAllowance(config, "https://analytics.example.com")).toBe(config);
  });

  it("rejects malformed Vercel configuration instead of silently weakening it", () => {
    expect(() => buildVercelJsonCspAllowance("{", "https://analytics.example.com")).toThrow();
  });

  it("injects an idempotent tracker into a Vite HTML entrypoint", () => {
    const html = `<!doctype html>\n<html>\n  <head>\n    <meta charset="UTF-8" />\n  </head>\n  <body></body>\n</html>\n`;
    const source = buildStaticHtmlInstrumentation(html, "https://analytics.example.com", "public-42");

    expect(source).toContain('src="https://analytics.example.com/api/script.js"');
    expect(source).toContain('data-site-id="public-42"');
    expect(source).toContain('data-agency-analytics="managed"');
    expect(buildStaticHtmlInstrumentation(source, "https://analytics.example.com", "public-42")).toBe(source);
  });

  it("refuses to replace a different managed tracker in a Vite HTML entrypoint", () => {
    const html = `<html><head><script data-agency-analytics="managed" data-site-id="other"></script></head></html>`;
    expect(() => buildStaticHtmlInstrumentation(html, "https://analytics.example.com", "public-42")).toThrow(
      "different managed analytics tracker"
    );
  });
});
