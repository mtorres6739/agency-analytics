import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST_PATH = path.join(ROOT, "site-manifest.json");
const WORKER_TEMPLATE_PATH = path.join(ROOT, "src", "worker-template.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function normalizeHostname(value) {
  assert(typeof value === "string" && value.trim(), "Every site needs a hostname");
  const input = value.trim().toLowerCase();
  assert(!input.includes("://") && !input.includes("/") && !input.includes(":"), `Invalid hostname: ${value}`);
  assert(!isIP(input), `IP addresses are not supported: ${value}`);
  assert(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(input),
    `Invalid hostname: ${value}`
  );
  return input;
}

export function validateManifest(input) {
  assert(input && typeof input === "object" && !Array.isArray(input), "Manifest must be a JSON object");
  assert(input.version === 1, "Manifest version must be 1");

  const analyticsOrigin = new URL(input.analyticsOrigin);
  assert(analyticsOrigin.protocol === "https:", "analyticsOrigin must use HTTPS");
  assert(analyticsOrigin.pathname === "/", "analyticsOrigin cannot include a path");
  assert(!analyticsOrigin.username && !analyticsOrigin.password, "analyticsOrigin cannot include credentials");

  assert(typeof input.pathPrefix === "string", "pathPrefix is required");
  assert(/^\/[a-z0-9_][a-z0-9/_-]*$/i.test(input.pathPrefix), "pathPrefix must be a simple absolute path");
  const pathPrefix = input.pathPrefix.replace(/\/+$/, "");
  assert(pathPrefix.length >= 8, "pathPrefix must be at least eight characters to avoid route collisions");

  assert(Array.isArray(input.sites) && input.sites.length > 0, "Manifest needs at least one site");
  const seen = new Set();
  const sites = input.sites
    .filter(site => site?.enabled !== false)
    .map(site => {
      const hostname = normalizeHostname(site.hostname);
      assert(!seen.has(hostname), `Duplicate hostname: ${hostname}`);
      seen.add(hostname);
      assert(Number.isSafeInteger(site.siteId) && site.siteId > 0, `Invalid siteId for ${hostname}`);
      assert(hostname !== analyticsOrigin.hostname, "The analytics origin cannot route through its own tracking worker");
      return { hostname, siteId: site.siteId };
    });
  assert(sites.length > 0, "Manifest needs at least one enabled site");

  return {
    version: 1,
    analyticsOrigin: analyticsOrigin.origin,
    pathPrefix,
    sites: sites.sort((a, b) => a.hostname.localeCompare(b.hostname)),
  };
}

export async function loadManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  const raw = await readFile(path.resolve(manifestPath), "utf8");
  return validateManifest(JSON.parse(raw));
}

export async function buildWorker(manifest) {
  const template = await readFile(WORKER_TEMPLATE_PATH, "utf8");
  const siteMap = Object.fromEntries(manifest.sites.map(site => [site.hostname, site.siteId]));
  return template
    .replace("__SITE_MAP_JSON__", JSON.stringify(siteMap))
    .replace("__ANALYTICS_ORIGIN_JSON__", JSON.stringify(manifest.analyticsOrigin))
    .replace("__PATH_PREFIX_JSON__", JSON.stringify(manifest.pathPrefix));
}

export class CloudflareClient {
  constructor({ token, accountId, fetchImpl = fetch }) {
    assert(token, "CLOUDFLARE_API_TOKEN or CLOUDFLARE_API is required");
    assert(accountId, "CF_ACCOUNT_ID is required");
    this.token = token;
    this.accountId = accountId;
    this.fetch = fetchImpl;
  }

  async request(pathname, init = {}) {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.token}`);
    const response = await this.fetch(`https://api.cloudflare.com/client/v4${pathname}`, { ...init, headers });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
      const message = payload?.errors?.map(error => error.message).join("; ") || `HTTP ${response.status}`;
      throw new Error(`Cloudflare API request failed: ${message}`);
    }
    return payload?.result ?? payload;
  }

  async findZone(hostname) {
    const labels = hostname.split(".");
    for (let index = 0; index < labels.length - 1; index += 1) {
      const candidate = labels.slice(index).join(".");
      const zones = await this.request(`/zones?name=${encodeURIComponent(candidate)}&status=active&per_page=1`);
      if (zones.length === 1) return zones[0];
    }
    throw new Error(`No active Cloudflare zone found for ${hostname}`);
  }

  async inspectSite(site, scriptName) {
    const zone = await this.findZone(site.hostname);
    const [records, routes] = await Promise.all([
      this.request(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(site.hostname)}&per_page=100`),
      this.request(`/zones/${zone.id}/workers/routes`),
    ]);
    const proxied = records.some(record => record.proxied === true && ["A", "AAAA", "CNAME"].includes(record.type));
    const pattern = `${site.hostname}/*`;
    const route = routes.find(item => item.pattern === pattern);
    const inheritedRoute = routes.find(
      item => item.script && item.pattern !== pattern && routePatternCoversHostname(item.pattern, site.hostname)
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
      conflict: Boolean((route?.script && route.script !== scriptName) || inheritedRoute),
    };
  }

  async uploadWorker(scriptName, source) {
    const form = new FormData();
    form.set(
      "metadata",
      new Blob([JSON.stringify({ main_module: "worker.js", compatibility_date: "2026-07-19" })], {
        type: "application/json",
      })
    );
    form.set("worker.js", new Blob([source], { type: "application/javascript+module" }), "worker.js");
    return this.request(`/accounts/${this.accountId}/workers/scripts/${scriptName}`, { method: "PUT", body: form });
  }

  async createRoute(site, scriptName) {
    return this.request(`/zones/${site.zoneId}/workers/routes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern: site.pattern, script: scriptName }),
    });
  }

  async deleteRoute(site) {
    return this.request(`/zones/${site.zoneId}/workers/routes/${site.routeId}`, { method: "DELETE" });
  }
}

export function parseArguments(argv) {
  const [command = "plan", ...rest] = argv;
  const options = { command, manifestPath: DEFAULT_MANIFEST_PATH, scriptName: "bold-analytics-tracker" };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--manifest") options.manifestPath = rest[++index];
    else if (flag === "--script-name") options.scriptName = rest[++index];
    else throw new Error(`Unknown argument: ${flag}`);
  }
  assert(["plan", "apply", "verify", "rollback"].includes(command), `Unknown command: ${command}`);
  assert(/^[a-z0-9][a-z0-9-]{0,47}$/.test(options.scriptName), "Invalid Worker script-name prefix");
  return options;
}

export function routePatternCoversHostname(pattern, hostname) {
  const withoutScheme = String(pattern).replace(/^https?:\/\//i, "");
  const slashIndex = withoutScheme.indexOf("/");
  const hostPattern = slashIndex === -1 ? withoutScheme : withoutScheme.slice(0, slashIndex);
  const pathPattern = slashIndex === -1 ? "" : withoutScheme.slice(slashIndex);
  if (pathPattern && pathPattern !== "/*") return false;
  const escaped = hostPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i").test(hostname);
}
