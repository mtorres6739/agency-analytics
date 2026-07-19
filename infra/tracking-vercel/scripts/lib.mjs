import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST_PATH = path.join(ROOT, "site-manifest.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateManifest(input) {
  assert(input && typeof input === "object" && !Array.isArray(input), "Manifest must be a JSON object");
  assert(input.version === 1, "Manifest version must be 1");
  const analyticsOrigin = new URL(input.analyticsOrigin);
  assert(analyticsOrigin.protocol === "https:" && analyticsOrigin.pathname === "/", "analyticsOrigin must be an HTTPS origin");
  assert(Array.isArray(input.sites) && input.sites.length > 0, "Manifest needs at least one site");
  const seenProjects = new Set();
  const seenHosts = new Set();
  const sites = input.sites
    .filter(site => site?.enabled !== false)
    .map(site => {
      const hostname = String(site.hostname ?? "").trim().toLowerCase();
      assert(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname), `Invalid hostname: ${site.hostname}`);
      assert(Number.isSafeInteger(site.siteId) && site.siteId > 0, `Invalid siteId for ${hostname}`);
      const vercelProject = String(site.vercelProject ?? "").trim();
      assert(/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(vercelProject), `Invalid Vercel project for ${hostname}`);
      assert(!seenHosts.has(hostname), `Duplicate hostname: ${hostname}`);
      assert(!seenProjects.has(vercelProject), `Duplicate Vercel project: ${vercelProject}`);
      seenHosts.add(hostname);
      seenProjects.add(vercelProject);
      return { hostname, siteId: site.siteId, vercelProject };
    });
  assert(sites.length > 0, "Manifest needs at least one enabled site");
  return { version: 1, analyticsOrigin: analyticsOrigin.origin, sites };
}

export async function loadManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  return validateManifest(JSON.parse(await readFile(path.resolve(manifestPath), "utf8")));
}

export function parseNextMajor(version) {
  const match = String(version ?? "").match(/(?:^|[^\d])(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2] ?? 0) };
}

export function supportsClientInstrumentation(version) {
  const parsed = parseNextMajor(version);
  return Boolean(parsed && (parsed.major > 15 || (parsed.major === 15 && parsed.minor >= 3)));
}

export function buildInstrumentation({ analyticsOrigin, siteId }) {
  return `// Agency Analytics managed tracker. Changes are overwritten by the installer.\nconst existing = document.querySelector('script[data-agency-analytics="managed"]');\n\nif (!existing) {\n  const script = document.createElement("script");\n  script.src = "${analyticsOrigin}/api/script.js";\n  script.setAttribute("data-site-id", "${siteId}");\n  script.setAttribute("data-agency-analytics", "managed");\n  script.defer = true;\n  document.head.appendChild(script);\n}\n`;
}

export function cspAllowsOrigin(policy, directiveName, origin) {
  if (!policy) return true;
  const directives = Object.fromEntries(
    policy
      .split(";")
      .map(value => value.trim().split(/\s+/))
      .filter(parts => parts[0])
      .map(([name, ...values]) => [name.toLowerCase(), values])
  );
  const sources = directives[directiveName] ?? directives["default-src"];
  if (!sources) return true;
  if (sources.includes("*") || sources.includes("https:")) return true;
  return sources.some(source => source === origin || source === new URL(origin).hostname);
}

export function trackerCspCompatible(policy, analyticsOrigin) {
  return cspAllowsOrigin(policy, "script-src", analyticsOrigin) && cspAllowsOrigin(policy, "connect-src", analyticsOrigin);
}

export function parseArguments(argv) {
  const [command = "plan", ...rest] = argv;
  const options = { command, manifestPath: DEFAULT_MANIFEST_PATH };
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--manifest") options.manifestPath = rest[++index];
    else throw new Error(`Unknown argument: ${rest[index]}`);
  }
  assert(["plan", "apply", "status", "rollback"].includes(command), `Unknown command: ${command}`);
  return options;
}

class ApiClient {
  constructor(baseUrl, token, fetchImpl = fetch) {
    assert(token, `Missing API token for ${baseUrl}`);
    this.baseUrl = baseUrl;
    this.token = token;
    this.fetch = fetchImpl;
  }

  async request(pathname, init = {}) {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.token}`);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await this.fetch(`${this.baseUrl}${pathname}`, { ...init, headers });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
    return payload;
  }
}

export class VercelClient extends ApiClient {
  constructor(token, fetchImpl) {
    super("https://api.vercel.com", token, fetchImpl);
  }

  getProject(name) {
    return this.request(`/v9/projects/${encodeURIComponent(name)}`);
  }

  async findBranchDeployment(projectId, branch) {
    const query = new URLSearchParams({ projectId, limit: "20" });
    const payload = await this.request(`/v6/deployments?${query}`);
    return payload.deployments?.find(deployment => deployment.meta?.githubCommitRef === branch) ?? null;
  }
}

export class GitHubClient extends ApiClient {
  constructor(token, fetchImpl) {
    super("https://api.github.com", token, fetchImpl);
  }

  getRepo(owner, repo) {
    return this.request(`/repos/${owner}/${repo}`);
  }

  async getContent(owner, repo, filePath, ref) {
    try {
      return await this.request(`/repos/${owner}/${repo}/contents/${encodePath(filePath)}?ref=${encodeURIComponent(ref)}`);
    } catch (error) {
      if (error.message === "Not Found") return null;
      throw error;
    }
  }

  getBranch(owner, repo, branch) {
    return this.request(`/repos/${owner}/${repo}/git/ref/heads/${encodePath(branch)}`);
  }

  createBranch(owner, repo, branch, sha) {
    return this.request(`/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    });
  }

  putFile(owner, repo, filePath, branch, content) {
    return this.request(`/repos/${owner}/${repo}/contents/${encodePath(filePath)}`, {
      method: "PUT",
      body: JSON.stringify({
        message: "feat: add Agency Analytics tracking",
        content: Buffer.from(content).toString("base64"),
        branch,
      }),
    });
  }

  listPullRequests(owner, repo, branch) {
    const query = new URLSearchParams({ state: "open", head: `${owner}:${branch}` });
    return this.request(`/repos/${owner}/${repo}/pulls?${query}`);
  }

  createPullRequest(owner, repo, { branch, base, hostname, siteId }) {
    return this.request(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: "Add Agency Analytics tracking",
        head: branch,
        base,
        body: `Installs the managed Agency Analytics tracker for **${hostname}** (site ID \`${siteId}\`).\n\nVercel will create a preview deployment. Verify a browser event in https://analytics.boldmedia.cc before merging.`,
      }),
    });
  }

  updatePullRequest(owner, repo, number, state) {
    return this.request(`/repos/${owner}/${repo}/pulls/${number}`, {
      method: "PATCH",
      body: JSON.stringify({ state }),
    });
  }

  deleteBranch(owner, repo, branch) {
    return this.request(`/repos/${owner}/${repo}/git/refs/heads/${encodePath(branch)}`, { method: "DELETE" });
  }
}

export function encodePath(value) {
  return value
    .split("/")
    .map(part => encodeURIComponent(part))
    .join("/");
}

export function decodeContent(item) {
  return Buffer.from(item.content.replaceAll("\n", ""), "base64").toString("utf8");
}
