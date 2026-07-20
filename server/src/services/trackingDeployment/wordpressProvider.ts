import type { TrackingSite } from "./cloudflareProvider.js";

export async function detectWordPress(site: TrackingSite, fetchImpl: typeof fetch = fetch) {
  try {
    const response = await fetchImpl(`https://${site.hostname}/wp-json/`, {
      headers: { accept: "application/json", "user-agent": "AgencyAnalyticsInstaller/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.toLowerCase().includes("json")) return null;
    const payload = (await response.json().catch(() => null)) as any;
    if (!payload?.namespaces && !payload?.name) return null;
    return {
      hostname: site.hostname,
      provider: "wordpress" as const,
      supported: false,
      installed: false,
      blocked: true,
      reason:
        "WordPress was detected, but this hostname is not on a supported Cloudflare route. Connect WP-CLI/SFTP or install the managed connector before one-click deployment.",
    };
  } catch {
    return null;
  }
}

export function manualPlan(site: TrackingSite, reason?: string) {
  return {
    hostname: site.hostname,
    provider: "manual" as const,
    supported: false,
    installed: false,
    blocked: true,
    reason: reason ?? "No supported Cloudflare or Vercel installation path was detected for this hostname.",
  };
}
