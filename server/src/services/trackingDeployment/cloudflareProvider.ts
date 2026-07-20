type Fetch = typeof fetch;

export type TrackingSite = { hostname: string; siteId: number };

type CloudflareConfig = {
  token: string;
  accountId: string;
  analyticsOrigin: string;
  pathPrefix: string;
  workerPrefix: string;
};

type Inspection = TrackingSite & {
  zoneId: string;
  zoneName: string;
  proxied: boolean;
  pattern: string;
  routeId: string | null;
  currentScript: string | null;
  inheritedRoute: string | null;
  conflict: boolean;
  expectedScript: string;
};

const WORKER_TEMPLATE = `const SITE_MAP = __SITE_MAP_JSON__;
const ANALYTICS_ORIGIN = __ANALYTICS_ORIGIN_JSON__;
const PATH_PREFIX = __PATH_PREFIX_JSON__;
const EXCLUDED_PATHS = ["/wp-admin", "/wp-login.php", "/wp-json", "/xmlrpc.php", "/api", "/_next", "/cdn-cgi"];
function isExcludedPath(pathname) { return EXCLUDED_PATHS.some(prefix => pathname === prefix || pathname.startsWith(\`\${prefix}/\`)); }
function isHtmlResponse(response) { return response.headers.get("content-type")?.toLowerCase().includes("text/html") ?? false; }
function needsNonce(response) { return /(?:'nonce-[^']+'|'strict-dynamic')/i.test(response.headers.get("content-security-policy") ?? ""); }
function escapeAttribute(value) { return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
class InjectionState { constructor(siteId, requireNonce) { this.siteId = siteId; this.requireNonce = requireNonce; this.existingTracker = false; this.nonce = null; } }
class ScriptHandler { constructor(state) { this.state = state; } element(element) { const src = element.getAttribute("src") ?? ""; const configuredSiteId = element.getAttribute("data-site-id"); if (src.includes("/api/script.js") || src.includes(\`\${PATH_PREFIX}/script.js\`) || configuredSiteId === String(this.state.siteId)) this.state.existingTracker = true; if (!this.state.nonce && element.getAttribute("nonce")) this.state.nonce = element.getAttribute("nonce"); } }
class HeadHandler { constructor(state) { this.state = state; } element(element) { element.onEndTag(endTag => { if (this.state.existingTracker || (this.state.requireNonce && !this.state.nonce)) return; const nonce = this.state.nonce ? \` nonce="\${escapeAttribute(this.state.nonce)}"\` : ""; endTag.before(\`<script src="\${PATH_PREFIX}/script.js" data-site-id="\${this.state.siteId}" data-agency-analytics="managed" defer\${nonce}></script>\`, { html: true }); }); } }
async function proxyAnalytics(request, url) { const suffix = url.pathname.slice(PATH_PREFIX.length); const upstreamUrl = new URL(\`/api\${suffix}\`, ANALYTICS_ORIGIN); upstreamUrl.search = url.search; const response = await fetch(new Request(upstreamUrl, request)); const headers = new Headers(response.headers); headers.set("x-agency-analytics-proxy", "1"); headers.set("x-bold-analytics-proxy", "1"); return new Response(response.body, { status: response.status, statusText: response.statusText, headers }); }
export default { async fetch(request) { const url = new URL(request.url); const siteId = SITE_MAP[url.hostname.toLowerCase()]; if (!siteId) return fetch(request); if (url.pathname === PATH_PREFIX || url.pathname.startsWith(\`\${PATH_PREFIX}/\`)) return proxyAnalytics(request, url); const response = await fetch(request); if (request.method !== "GET" || isExcludedPath(url.pathname) || !isHtmlResponse(response)) return response; const state = new InjectionState(siteId, needsNonce(response)); return new HTMLRewriter().on("script", new ScriptHandler(state)).on("head", new HeadHandler(state)).transform(response); } };`;

function routePatternCoversHostname(pattern: string, hostname: string) {
  const withoutScheme = String(pattern).replace(/^https?:\/\//i, "");
  const slashIndex = withoutScheme.indexOf("/");
  const hostPattern = slashIndex === -1 ? withoutScheme : withoutScheme.slice(0, slashIndex);
  const pathPattern = slashIndex === -1 ? "" : withoutScheme.slice(slashIndex);
  if (pathPattern && pathPattern !== "/*") return false;
  const escaped = hostPattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .split("*")
    .join(".*");
  return new RegExp(`^${escaped}$`, "i").test(hostname);
}

function buildWorker(config: CloudflareConfig, site: TrackingSite) {
  return WORKER_TEMPLATE.replace("__SITE_MAP_JSON__", JSON.stringify({ [site.hostname]: site.siteId }))
    .replace("__ANALYTICS_ORIGIN_JSON__", JSON.stringify(config.analyticsOrigin))
    .replace("__PATH_PREFIX_JSON__", JSON.stringify(config.pathPrefix));
}

export class CloudflareTrackingProvider {
  constructor(
    private config: CloudflareConfig,
    private fetchImpl: Fetch = fetch
  ) {}

  private async request(pathname: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.config.token}`);
    const response = await this.fetchImpl(`https://api.cloudflare.com/client/v4${pathname}`, { ...init, headers });
    const payload = (await response.json().catch(() => null)) as any;
    if (!response.ok || payload?.success === false) {
      const message = payload?.errors?.map((error: any) => error.message).join("; ") || `HTTP ${response.status}`;
      throw new Error(`Cloudflare API request failed: ${message}`);
    }
    return payload?.result ?? payload;
  }

  private async findZone(hostname: string) {
    const labels = hostname.split(".");
    for (let index = 0; index < labels.length - 1; index += 1) {
      const candidate = labels.slice(index).join(".");
      const zones = await this.request(`/zones?name=${encodeURIComponent(candidate)}&status=active&per_page=1`);
      if (zones.length === 1) return zones[0];
    }
    throw new Error(`No active Cloudflare zone found for ${hostname}`);
  }

  private async inspect(site: TrackingSite): Promise<Inspection> {
    const zone = await this.findZone(site.hostname);
    const [records, routes] = await Promise.all([
      this.request(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(site.hostname)}&per_page=100`),
      this.request(`/zones/${zone.id}/workers/routes`),
    ]);
    const expectedScript = `${this.config.workerPrefix}-${site.siteId}`;
    const proxied = records.some(
      (record: any) => record.proxied === true && ["A", "AAAA", "CNAME"].includes(record.type)
    );
    const pattern = `${site.hostname}/*`;
    const route = routes.find((item: any) => item.pattern === pattern);
    const inheritedRoute = routes.find(
      (item: any) => item.script && item.pattern !== pattern && routePatternCoversHostname(item.pattern, site.hostname)
    );
    return {
      ...site,
      zoneId: zone.id,
      zoneName: zone.name,
      proxied,
      pattern,
      routeId: route?.id ?? null,
      currentScript: route?.script ?? null,
      inheritedRoute: inheritedRoute?.pattern ?? null,
      conflict: Boolean((route?.script && route.script !== expectedScript) || inheritedRoute),
      expectedScript,
    };
  }

  private publicPlan(inspection: Inspection) {
    const installed = inspection.currentScript === inspection.expectedScript;
    const reason = !inspection.proxied
      ? "This hostname is not proxied through Cloudflare"
      : inspection.conflict
        ? `An existing Worker route already controls ${inspection.pattern}`
        : undefined;
    return {
      hostname: inspection.hostname,
      provider: "cloudflare" as const,
      supported: inspection.proxied,
      installed,
      blocked: Boolean(reason),
      reason,
      route: inspection.pattern,
      workerScript: inspection.expectedScript,
      zone: inspection.zoneName,
    };
  }

  async plan(site: TrackingSite) {
    return this.publicPlan(await this.inspect(site));
  }

  private async uploadWorker(scriptName: string, source: string) {
    const form = new FormData();
    form.set(
      "metadata",
      new Blob([JSON.stringify({ main_module: "worker.js", compatibility_date: "2026-07-19" })], {
        type: "application/json",
      })
    );
    form.set("worker.js", new Blob([source], { type: "application/javascript+module" }), "worker.js");
    return this.request(`/accounts/${this.config.accountId}/workers/scripts/${scriptName}`, {
      method: "PUT",
      body: form,
    });
  }

  private createRoute(inspection: Inspection) {
    return this.request(`/zones/${inspection.zoneId}/workers/routes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern: inspection.pattern, script: inspection.expectedScript }),
    });
  }

  private deleteRoute(inspection: Inspection) {
    return this.request(`/zones/${inspection.zoneId}/workers/routes/${inspection.routeId}`, { method: "DELETE" });
  }

  async verify(site: TrackingSite) {
    const homepage = await this.fetchImpl(`https://${site.hostname}/`, {
      headers: { accept: "text/html", "user-agent": "AgencyAnalyticsInstaller/1.0" },
      redirect: "follow",
    });
    const html = await homepage.text();
    const script = await this.fetchImpl(`https://${site.hostname}${this.config.pathPrefix}/script.js`, {
      redirect: "follow",
    });
    const injected =
      html.includes(`${this.config.pathPrefix}/script.js`) && html.includes(`data-site-id="${site.siteId}"`);
    const proxied =
      script.ok &&
      ["1"].includes(
        script.headers.get("x-agency-analytics-proxy") ?? script.headers.get("x-bold-analytics-proxy") ?? ""
      );
    return {
      homepageStatus: homepage.status,
      scriptStatus: script.status,
      injected,
      proxied,
    };
  }

  async apply(site: TrackingSite) {
    const inspection = await this.inspect(site);
    const plan = this.publicPlan(inspection);
    if (plan.blocked) return plan;
    if (!plan.installed) {
      await this.uploadWorker(inspection.expectedScript, buildWorker(this.config, site));
      if (!inspection.routeId) await this.createRoute(inspection);
    }
    const verification = await this.verify(site);
    if (!verification.injected || !verification.proxied) {
      throw new Error("Cloudflare Worker was deployed but live tracking verification failed");
    }
    return { ...plan, installed: true, verification };
  }

  async rollback(site: TrackingSite) {
    const inspection = await this.inspect(site);
    const installed = inspection.currentScript === inspection.expectedScript;
    if (installed && inspection.routeId) await this.deleteRoute(inspection);
    return {
      hostname: site.hostname,
      provider: "cloudflare" as const,
      supported: true,
      installed: false,
      blocked: false,
      route: inspection.pattern,
      workerScript: inspection.expectedScript,
      reason: installed ? "Managed Worker route removed" : "No managed Worker route was present",
    };
  }
}
